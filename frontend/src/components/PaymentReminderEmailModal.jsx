import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api/apiClient";
import { buildPaymentReminderEmailHtml, plainTextFromHtml } from "../utils/paymentReminderEmailHtml";
import {
  getActiveMsAccount,
  getMyOutlookContact,
  isMicrosoftMailConfigured,
  loginMicrosoft,
  sendReminderEmail
} from "../microsoft/msGraphMail";

function tenantCodeFromUnit(u) {
  if (!u || typeof u !== "object") return "";
  for (const k of Object.keys(u)) {
    if (k.toLowerCase() === "tenantcode") {
      const v = u[k];
      return v == null ? "" : String(v).trim();
    }
  }
  return "";
}

export default function PaymentReminderEmailModal({ open, unit, context, onClose }) {
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [msAccountLabel, setMsAccountLabel] = useState("");
  /** Sender contact card fetched from Microsoft Graph /me — overrides env-derived senderName / senderPhone. */
  const [outlookContact, setOutlookContact] = useState(null);
  useEffect(() => {
    if (open) {
      setComment("");
      setSendError("");
      setSending(false);
    }
  }, [open, unit]);

  useEffect(() => {
    if (!open || !isMicrosoftMailConfigured()) {
      setMsAccountLabel("");
      setOutlookContact(null);
      return;
    }
    let alive = true;
    void (async () => {
      const acc = await getActiveMsAccount();
      if (!alive) return;
      setMsAccountLabel(acc?.username || acc?.name || "");
      if (acc) {
        const card = await getMyOutlookContact();
        if (alive) setOutlookContact(card);
      } else if (alive) {
        setOutlookContact(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  /** Merge so signed-in Outlook user's name & phone win over the env-derived defaults. */
  const effectiveContext = useMemo(() => {
    const base = context || {};
    if (!outlookContact) return base;
    const senderName = outlookContact.displayName?.trim() || base.senderName || "";
    const senderPhone = outlookContact.phone?.trim() || base.senderPhone || "";
    const replyEmail = outlookContact.email?.trim() || base.replyEmail || "";
    return { ...base, senderName, senderPhone, replyEmail };
  }, [context, outlookContact]);

  const html = useMemo(() => {
    if (!unit) return "";
    return buildPaymentReminderEmailHtml(unit, effectiveContext);
  }, [unit, effectiveContext]);

  if (!open || !unit) return null;

  const tenantEmail = unit.email ? String(unit.email).trim() : "";
  const fallbackTo = effectiveContext?.replyEmail ? String(effectiveContext.replyEmail).trim() : "";
  const sendTarget = tenantEmail || fallbackTo;

  function handleCancel() {
    setComment("");
    setSendError("");
    onClose();
  }

  async function handleSend() {
    if (!sendTarget || sending) return;
    setSendError("");

    if (!isMicrosoftMailConfigured()) {
      setSendError("Microsoft send is not configured. Set VITE_MS_CLIENT_ID in frontend .env and restart the dev server.");
      return;
    }

    setSending(true);
    try {
      let acc = await getActiveMsAccount();
      let cardForSend = outlookContact;
      if (!acc) {
        await loginMicrosoft();
        acc = await getActiveMsAccount();
        setMsAccountLabel(acc?.username || acc?.name || "");
        cardForSend = await getMyOutlookContact();
        setOutlookContact(cardForSend);
      } else if (!cardForSend) {
        cardForSend = await getMyOutlookContact();
        if (cardForSend) setOutlookContact(cardForSend);
      }
      /** Rebuild HTML right before send so the just-fetched Outlook contact (name/phone) lands in the email. */
      const sendContext = cardForSend
        ? {
            ...(context || {}),
            senderName: cardForSend.displayName?.trim() || (context?.senderName ?? ""),
            senderPhone: cardForSend.phone?.trim() || (context?.senderPhone ?? ""),
            replyEmail: cardForSend.email?.trim() || (context?.replyEmail ?? "")
          }
        : context || {};
      const htmlForSend = buildPaymentReminderEmailHtml(unit, sendContext);
      const meta = await sendReminderEmail({
        to: sendTarget,
        htmlDocument: htmlForSend,
        subject: "Payment reminder",
        comment
      });
      const accForLog = (await getActiveMsAccount()) || acc;
      const sender =
        String(accForLog?.username || accForLog?.name || msAccountLabel || "")
          .trim()
          .slice(0, 320) || "unknown";
      try {
        await api.postAdminReminderEmailLog({
          senderMailbox: sender,
          toEmail: sendTarget,
          subject: "Payment reminder",
          graphMessageId: meta.graphMessageId,
          graphConversationId: meta.graphConversationId || "",
          sentAt: meta.sentAt,
          tenantLabel: String(unit?.name ?? unit?.TenantName ?? "").trim().slice(0, 500) || null,
          propertyName: String(unit?.property ?? "").trim().slice(0, 500) || null,
          bodyPreview: plainTextFromHtml(htmlForSend, 1900)
        });
      } catch (logErr) {
        console.warn("Reminder email log failed:", logErr);
      }
      try {
        const when = new Date();
        const dateStr = when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        const balanceAtSend = (() => {
          const n = Number(unit?.balance);
          if (!Number.isFinite(n)) return "";
          try {
            return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
          } catch {
            return `$${n.toFixed(2)}`;
          }
        })();
        const balancePart = balanceAtSend ? ` Balance at the time of sending: ${balanceAtSend}.` : "";
        const body = `On ${dateStr} a payment reminder email was sent to ${sendTarget}.${balancePart}`;
        await api.postDashboardUnitNote({
          property: String(unit?.property ?? "").trim(),
          unit: String(unit?.unit ?? "").trim(),
          name: String(unit?.name ?? "").trim(),
          tenantCode: tenantCodeFromUnit(unit) || undefined,
          body,
          noteSource: "auto",
          isPinned: false,
          isHighlighted: false,
          createdByName: "System"
        });
      } catch (noteErr) {
        console.warn("Automatic unit note failed:", noteErr);
      }
      setComment("");
      onClose();
    } catch (e) {
      setSendError(e?.message || "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="payment-reminder-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="payment-reminder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-reminder-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="payment-reminder-modal__head">
          <h2 id="payment-reminder-modal-title">Payment reminder preview</h2>
          <button type="button" className="btn-icon" aria-label="Close" onClick={handleCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="payment-reminder-modal__scroll">
          <iframe
            className="payment-reminder-modal__frame"
            title="Payment reminder email"
            srcDoc={html}
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
          />
          <div className="payment-reminder-modal__comment-wrap">
            <label className="payment-reminder-modal__comment-label" htmlFor="payment-reminder-comment">
              Comment
            </label>
            <textarea
              id="payment-reminder-comment"
              className="payment-reminder-modal__comment"
              rows={3}
              placeholder="Add a note to include in the email body…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={8000}
            />
          </div>
        </div>
        {sendError ? (
          <p className="payment-reminder-modal__err" role="alert">
            {sendError}
          </p>
        ) : null}
        <div className="payment-reminder-modal__actions">
          <button type="button" className="btn btn-ghost" onClick={handleCancel} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSend()}
            disabled={!sendTarget || sending || !isMicrosoftMailConfigured()}
            title={
              !sendTarget
                ? "No tenant email and no contact email configured"
                : !isMicrosoftMailConfigured()
                  ? "Set VITE_MS_CLIENT_ID in .env"
                  : sending
                    ? "Sending…"
                    : undefined
            }
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
