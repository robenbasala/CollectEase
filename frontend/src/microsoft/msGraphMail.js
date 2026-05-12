import { InteractionRequiredAuthError, PublicClientApplication } from "@azure/msal-browser";
import { escapeHtml } from "../utils/paymentReminderEmailHtml.js";

/** Mail.ReadWrite: create draft + send + read inbox replies in the same thread. */
const GRAPH_SCOPES = ["Mail.ReadWrite", "User.Read"];

let pca = null;
let initPromise = null;
let cachedSelfLowerSet = null;

/** Trim, strip wrapping quotes, collapse accidental spaces (common .env paste mistakes). */
function msClientIdFromEnv() {
  const raw = import.meta.env.VITE_MS_CLIENT_ID;
  if (raw == null) return "";
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\s+/g, "");
}

export function isMicrosoftMailConfigured() {
  return Boolean(msClientIdFromEnv());
}

export async function getMsalInstance() {
  if (!isMicrosoftMailConfigured()) return null;
  if (!pca) {
    pca = new PublicClientApplication({
      auth: {
        clientId: msClientIdFromEnv(),
        authority:
          (import.meta.env.VITE_MS_AUTHORITY && String(import.meta.env.VITE_MS_AUTHORITY).trim()) ||
          "https://login.microsoftonline.com/common",
        redirectUri:
          (import.meta.env.VITE_MS_REDIRECT_URI && String(import.meta.env.VITE_MS_REDIRECT_URI).trim()) ||
          window.location.origin
      },
      cache: {
        cacheLocation: "localStorage"
      }
    });
    initPromise = pca.initialize();
  }
  await initPromise;
  return pca;
}

export async function getActiveMsAccount() {
  const app = await getMsalInstance();
  if (!app) return null;
  return app.getActiveAccount() || app.getAllAccounts()[0] || null;
}

export async function loginMicrosoft() {
  const app = await getMsalInstance();
  if (!app) {
    throw new Error("Microsoft mail is not configured (set VITE_MS_CLIENT_ID in .env).");
  }
  await app.loginPopup({ scopes: GRAPH_SCOPES });
  const accounts = app.getAllAccounts();
  const acc = accounts[0];
  if (acc) app.setActiveAccount(acc);
  cachedSelfLowerSet = null;
}

export async function logoutMicrosoft() {
  const app = await getMsalInstance();
  if (!app) return;
  const acc = app.getActiveAccount() || app.getAllAccounts()[0];
  if (acc) await app.logoutPopup({ account: acc });
  cachedSelfLowerSet = null;
}

async function acquireGraphAccessToken() {
  const app = await getMsalInstance();
  if (!app) throw new Error("Microsoft mail is not configured.");
  const account = app.getActiveAccount() || app.getAllAccounts()[0];
  if (!account) throw new Error("Sign in with Microsoft first (toolbar).");

  const silentRequest = { scopes: GRAPH_SCOPES, account };
  try {
    const result = await app.acquireTokenSilent(silentRequest);
    return result.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      const result = await app.acquireTokenPopup({ scopes: GRAPH_SCOPES, account });
      return result.accessToken;
    }
    throw e;
  }
}

async function graphReadJson(url, token, extraHeaders = null) {
  const headers = { Authorization: `Bearer ${token}` };
  if (extraHeaders && typeof extraHeaders === "object") {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (v != null) headers[k] = String(v);
    }
  }
  const res = await fetch(url, { headers });
  const text = await res.text();
  let j = null;
  if (text) {
    try {
      j = JSON.parse(text);
    } catch {
      /* ignore */
    }
  }
  if (!res.ok) {
    const msg = j?.error?.message || text || res.statusText || `Graph ${res.status}`;
    throw new Error(msg);
  }
  return j;
}

/**
 * Returns the signed-in Microsoft user's contact card.
 * Used to fill the sender name / phone in tenant emails so each admin sends with their own signature.
 * Falls back to null when no MS account is signed in or Graph denies the call.
 * @returns {Promise<null | { displayName: string; email: string; phone: string }>}
 */
export async function getMyOutlookContact() {
  const app = await getMsalInstance();
  if (!app) return null;
  const account = app.getActiveAccount() || app.getAllAccounts()[0];
  if (!account) return null;
  let token;
  try {
    token = await acquireGraphAccessToken();
  } catch {
    return null;
  }
  try {
    const j = await graphReadJson(
      "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,mobilePhone,businessPhones",
      token
    );
    const displayName = String(j?.displayName ?? "").trim();
    const email = String(j?.mail ?? j?.userPrincipalName ?? "").trim();
    const mobile = String(j?.mobilePhone ?? "").trim();
    const business = Array.isArray(j?.businessPhones) && j.businessPhones.length > 0
      ? String(j.businessPhones[0] ?? "").trim()
      : "";
    const phone = mobile || business;
    return { displayName, email, phone };
  } catch {
    return null;
  }
}

/** Mail + UPN + smtp: proxy addresses — so we skip our own sent copies even when From uses an alias. */
async function getMyMailboxIdentitiesLowerSet(token) {
  if (cachedSelfLowerSet) return cachedSelfLowerSet;
  const j = await graphReadJson(
    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,proxyAddresses",
    token
  );
  const set = new Set();
  for (const key of ["mail", "userPrincipalName"]) {
    const v = String(j?.[key] || "")
      .trim()
      .toLowerCase();
    if (v) set.add(v);
  }
  const proxies = Array.isArray(j?.proxyAddresses) ? j.proxyAddresses : [];
  for (const p of proxies) {
    const s = String(p).trim().toLowerCase();
    if (s.startsWith("smtp:")) set.add(s.slice(5).trim());
  }
  cachedSelfLowerSet = set;
  return set;
}

function appendCommentToHtmlDocument(html, comment) {
  const c = comment != null ? String(comment).trim() : "";
  if (!c) return html;
  const safe = escapeHtml(c).replace(/\r\n|\n|\r/g, "<br/>");
  const block = `<div style="margin-top:22px;padding:16px 18px;border-top:1px solid #dee2e6;font-size:14px;color:#333;line-height:1.5"><strong>Comment</strong><br/>${safe}</div>`;
  if (html.includes("</body>")) return html.replace("</body>", `${block}</body>`);
  return `${html}${block}`;
}

/**
 * Sends HTML mail from the signed-in user's mailbox (Microsoft Graph).
 * Same pipeline as payment reminders (draft + send + sent-folder alignment).
 * @param {{ to: string; htmlDocument: string; subject: string; comment?: string }} params
 * @returns {Promise<{ graphMessageId: string; graphConversationId: string; sentAt: string }>}
 */
export async function sendOutlookHtmlMail({ to, htmlDocument, subject, comment }) {
  const toAddr = String(to || "").trim();
  if (!toAddr) throw new Error("Recipient email is missing.");

  const token = await acquireGraphAccessToken();
  const content = appendCommentToHtmlDocument(htmlDocument, comment);
  const subj = subject && String(subject).trim() ? String(subject).trim() : "Message";

  const createRes = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      subject: subj,
      body: { contentType: "HTML", content },
      toRecipients: [{ emailAddress: { address: toAddr } }]
    })
  });
  const createText = await createRes.text();
  let created = null;
  if (createText) {
    try {
      created = JSON.parse(createText);
    } catch {
      /* ignore */
    }
  }
  if (!createRes.ok) {
    const msg = created?.error?.message || createText || createRes.statusText;
    throw new Error(
      msg ||
        "Could not create message. Ensure the Azure app has delegated Mail.ReadWrite (and re-sign in to Microsoft)."
    );
  }

  const messageId = created?.id;
  const conversationId = created?.conversationId;
  if (!messageId) {
    throw new Error("Graph did not return a message id after create.");
  }

  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!sendRes.ok) {
    const t = await sendRes.text();
    let err = null;
    try {
      err = t ? JSON.parse(t) : null;
    } catch {
      /* ignore */
    }
    const msg = err?.error?.message || t || sendRes.statusText;
    throw new Error(msg || "Send failed after draft was created.");
  }

  let graphMessageId = messageId;
  let graphConversationId = conversationId != null ? String(conversationId) : "";
  let sentAt = new Date().toISOString();

  // Draft id often changes after send; conversationId from Sent copy is authoritative for threading.
  try {
    const sentList = await graphReadJson(
      "https://graph.microsoft.com/v1.0/me/mailFolders/sentItems/messages?$orderby=sentDateTime desc&$top=25&$select=id,conversationId,sentDateTime,toRecipients,subject",
      token
    );
    const now = Date.now();
    const addrLower = toAddr.toLowerCase();
    const match = (sentList.value || []).find((m) => {
      const tos = m.toRecipients || [];
      if (!tos.some((t) => String(t.emailAddress?.address || "").toLowerCase() === addrLower)) return false;
      if (String(m.subject || "") !== subj) return false;
      const st = new Date(m.sentDateTime).getTime();
      return !Number.isNaN(st) && Math.abs(now - st) < 3 * 60 * 1000;
    });
    if (match) {
      if (match.id) graphMessageId = match.id;
      if (match.conversationId) graphConversationId = String(match.conversationId);
      if (match.sentDateTime) sentAt = new Date(match.sentDateTime).toISOString();
    }
  } catch (e) {
    console.warn("Could not align sent item after send (reply tracking may be weaker):", e?.message || e);
  }

  return {
    graphMessageId,
    graphConversationId,
    sentAt
  };
}

/**
 * Payment reminder — thin wrapper with default subject.
 * @param {{ to: string; htmlDocument: string; subject?: string; comment?: string }} params
 */
export async function sendReminderEmail({ to, htmlDocument, subject, comment }) {
  return sendOutlookHtmlMail({
    to,
    htmlDocument,
    subject: subject && String(subject).trim() ? String(subject).trim() : "Payment reminder",
    comment
  });
}

/**
 * Load messages in a conversation. Try /me/messages first; Inbox-only + $filter is empty on some tenants.
 */
async function graphListMessagesByConversationId(token, conversationId) {
  const convEsc = String(conversationId).replace(/'/g, "''");
  const filt = `conversationId eq '${convEsc}'`;
  // `uniqueBody` returns only the parts of the body unique to this message — no quoted history.
  const select =
    "id,subject,from,receivedDateTime,sentDateTime,bodyPreview,uniqueBody,isRead,parentFolderId";
  // Ask Graph to return uniqueBody/body as plain text so we don't have to strip HTML.
  const preferTextHeader = { Prefer: 'outlook.body-content-type="text"' };
  const tries = [
    `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filt)}&$top=50&$select=${encodeURIComponent(select)}&$orderby=${encodeURIComponent("receivedDateTime asc")}`,
    `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filt)}&$top=50&$select=${encodeURIComponent(select)}`,
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filt)}&$top=50&$select=${encodeURIComponent(select)}&$orderby=${encodeURIComponent("receivedDateTime asc")}`,
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filt)}&$top=50&$select=${encodeURIComponent(select)}`
  ];
  for (const url of tries) {
    try {
      const data = await graphReadJson(url, token, preferTextHeader);
      if (Array.isArray(data?.value) && data.value.length > 0) return data.value;
    } catch (e) {
      console.warn("Graph conversation list attempt failed:", e?.message || e);
    }
  }
  return [];
}

function receivedOrSentTimeMs(m) {
  const r = m.receivedDateTime ? new Date(m.receivedDateTime).getTime() : NaN;
  if (!Number.isNaN(r)) return r;
  const s = m.sentDateTime ? new Date(m.sentDateTime).getTime() : NaN;
  if (!Number.isNaN(s)) return s;
  return NaN;
}

/**
 * Inbound replies in the same Graph conversation after the reminder was sent.
 * @returns {Promise<Array<{ id: string; subject: string; from: string; fromName: string; receivedAt: string; preview: string; isRead: boolean }>>}
 */
export async function fetchReminderRepliesInThread({
  conversationId,
  sentMessageId,
  sentAtIso,
  reminderToEmail: _reminderToEmail
}) {
  if (!conversationId || !String(conversationId).trim()) return [];

  const token = await acquireGraphAccessToken();
  const selfSet = await getMyMailboxIdentitiesLowerSet(token);
  const list = await graphListMessagesByConversationId(token, conversationId);

  const sentMs = new Date(sentAtIso).getTime() - 3 * 60 * 1000;

  const out = [];
  for (const m of list) {
    if (!m?.id) continue;
    if (sentMessageId && m.id === sentMessageId) continue;
    const from = String(m.from?.emailAddress?.address || "")
      .trim()
      .toLowerCase();
    if (!from || selfSet.has(from)) continue;

    const recvMs = m.receivedDateTime ? new Date(m.receivedDateTime).getTime() : NaN;
    if (Number.isNaN(recvMs) || recvMs < sentMs) continue;

    out.push(m);
  }

  return out
    .sort((a, b) => receivedOrSentTimeMs(a) - receivedOrSentTimeMs(b))
    .map((m) => ({
      id: m.id,
      subject: m.subject || "",
      from: m.from?.emailAddress?.address || "",
      fromName: m.from?.emailAddress?.name || "",
      receivedAt: m.receivedDateTime || m.sentDateTime || "",
      preview: extractReplyOnlyText(m),
      isRead: Boolean(m.isRead)
    }));
}

/**
 * Pull only the new content of a reply — drop the quoted body of the previous email(s).
 * Prefers Graph's `uniqueBody` (already stripped by the server when available),
 * then falls back to `bodyPreview` with a best-effort client-side trim.
 */
function extractReplyOnlyText(m) {
  const unique = String(m?.uniqueBody?.content ?? "").trim();
  if (unique) {
    const ct = String(m?.uniqueBody?.contentType ?? "").toLowerCase();
    const plain = ct === "html" ? htmlToPlainText(unique) : unique;
    const cleaned = sanitizeReplyText(plain);
    if (cleaned) return cleaned;
  }
  const preview = String(m?.bodyPreview ?? "").trim();
  return sanitizeReplyText(preview);
}

/** Trim quoted history, then strip inline-image cid tokens and bare email addresses. */
function sanitizeReplyText(text) {
  let s = trimQuotedHistory(text);
  if (!s) return "";
  // Remove inline-image references like `[cid:abc-123]` (case-insensitive).
  s = s.replace(/\[cid:[^\]]*\]/gi, " ");
  // Remove bare email addresses (typically auto-added signature lines).
  s = s.replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, " ");
  // Collapse any extra whitespace that the removals left behind.
  s = s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function htmlToPlainText(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    return (doc.body?.textContent || "").replace(/\u00a0/g, " ").trim();
  } catch {
    return String(html).replace(/<[^>]+>/g, " ").trim();
  }
}

/**
 * Best-effort removal of common "quoted original message" markers so the preview
 * shows just what the replier actually wrote.
 */
function trimQuotedHistory(text) {
  if (!text) return "";
  let s = String(text).replace(/\r\n/g, "\n");
  const cutPatterns = [
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nOn\s.+?wrote:\s*\n/i,
    /\nFrom:\s.+\nSent:\s.+/i,
    /\nFrom:\s.+\nDate:\s.+/i,
    /\n_{5,}\n/,
    /\n>{1}.*$/m
  ];
  for (const re of cutPatterns) {
    const m = s.match(re);
    if (m && typeof m.index === "number") {
      s = s.slice(0, m.index);
    }
  }
  return s.trim();
}
