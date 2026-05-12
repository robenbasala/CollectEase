import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  FolderKanban,
  Layers,
  Mail,
  MapPinned,
  Pencil,
  Search,
  UserPlus
} from "lucide-react";
import { api } from "../api/apiClient";
import {
  getActiveMsAccount,
  isMicrosoftMailConfigured,
  loginMicrosoft,
  sendOutlookHtmlMail
} from "../microsoft/msGraphMail.js";
import { plainTextFromHtml } from "../utils/paymentReminderEmailHtml";
import Spinner from "./Spinner";

async function logInviteEmail(entry) {
  try {
    await api.postAdminReminderEmailLog(entry);
  } catch (e) {
    /* eslint-disable-next-line no-console */
    console.warn("Could not record invite email in log:", e?.message || e);
  }
}

function formatAuthInstant(iso) {
  if (iso == null || String(iso).trim() === "") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function PropertyAccessTree({ headingId, properties, selectedSet, onChange }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const regions = new Map();
    for (const p of properties) {
      const rid = p.regionId ?? `name:${p.regionName}`;
      const pid = p.portfolioId ?? `name:${p.portfolioName}`;
      if (!regions.has(rid)) {
        regions.set(rid, { id: rid, name: p.regionName || "—", portfolios: new Map() });
      }
      const r = regions.get(rid);
      if (!r.portfolios.has(pid)) {
        r.portfolios.set(pid, { id: pid, name: p.portfolioName || "—", properties: [] });
      }
      r.portfolios.get(pid).properties.push(p);
    }
    return [...regions.values()].map((r) => ({
      ...r,
      portfolios: [...r.portfolios.values()]
    }));
  }, [properties]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map((r) => ({
        ...r,
        portfolios: r.portfolios
          .map((pf) => {
            const rMatch = r.name.toLowerCase().includes(q);
            const pfMatch = pf.name.toLowerCase().includes(q);
            const items =
              rMatch || pfMatch
                ? pf.properties
                : pf.properties.filter((p) => p.name.toLowerCase().includes(q));
            return { ...pf, properties: items };
          })
          .filter((pf) => pf.properties.length > 0)
      }))
      .filter((r) => r.portfolios.length > 0);
  }, [grouped, search]);

  const totalCount = properties.length;
  const selCount = selectedSet.size;
  const searching = search.trim().length > 0;

  function commit(next) {
    onChange(next);
  }

  function toggleId(id) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    commit(next);
  }

  function setMany(ids, on) {
    const next = new Set(selectedSet);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    commit(next);
  }

  function selectAll() {
    commit(new Set(properties.map((p) => p.id)));
  }

  function clearAll() {
    commit(new Set());
  }

  function toggleExpanded(rid) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  }

  return (
    <div className="prop-tree" role="group" aria-labelledby={headingId}>
      <div className="prop-tree__head">
        <div className="prop-tree__head-text">
          <h3 id={headingId} className="prop-tree__title">
            <Layers size={20} strokeWidth={2} aria-hidden />
            Property access
          </h3>
          <p className="prop-tree__hint">
            Pick by region, portfolio, or individual property. The user can access whatever you select.
          </p>
        </div>
        <span className="prop-tree__badge" aria-live="polite">
          <strong>{selCount}</strong>
          <span className="prop-tree__badge-divider">/</span>
          {totalCount}
          <span className="prop-tree__badge-label">selected</span>
        </span>
      </div>

      {totalCount > 0 ? (
        <div className="prop-tree__toolbar">
          <label className="prop-tree__search">
            <Search size={15} strokeWidth={2.2} aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search properties, portfolios, regions"
              aria-label="Search property access"
            />
          </label>
          <div className="prop-tree__bulk">
            <button
              type="button"
              className="prop-tree__bulk-btn"
              onClick={selectAll}
              disabled={selCount === totalCount}
            >
              Select all
            </button>
            <button
              type="button"
              className="prop-tree__bulk-btn prop-tree__bulk-btn--ghost"
              onClick={clearAll}
              disabled={selCount === 0}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {totalCount === 0 ? (
        <div className="prop-tree__empty">
          <p className="prop-tree__empty-title">No properties for this company yet.</p>
          <p className="prop-tree__empty-sub">
            Add regions, portfolios, and properties in the Admin sections first, or pick another company above.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="prop-tree__empty">
          <p className="prop-tree__empty-title">No matches.</p>
          <p className="prop-tree__empty-sub">Try a different search term.</p>
        </div>
      ) : (
        <div className="prop-tree__regions">
          {filtered.map((r) => {
            const rIds = r.portfolios.flatMap((pf) => pf.properties.map((p) => p.id));
            const rSel = rIds.reduce((acc, id) => acc + (selectedSet.has(id) ? 1 : 0), 0);
            const rAll = rIds.length > 0 && rSel === rIds.length;
            const rSome = rSel > 0 && !rAll;
            const isOpen = searching || expanded.has(r.id);
            return (
              <section
                key={r.id}
                className={`prop-tree__region${isOpen ? " is-open" : ""}${rAll ? " is-all" : rSome ? " is-some" : ""}`}
              >
                <header className="prop-tree__region-head">
                  <button
                    type="button"
                    className="prop-tree__region-toggle"
                    onClick={() => toggleExpanded(r.id)}
                    aria-expanded={isOpen}
                    aria-controls={`region-${r.id}-body`}
                  >
                    <ChevronDown size={16} className="prop-tree__chev" aria-hidden />
                    <span className="prop-tree__region-ico" aria-hidden>
                      <MapPinned size={16} strokeWidth={2.2} />
                    </span>
                    <span className="prop-tree__region-name">{r.name}</span>
                    <span className="prop-tree__counter">
                      {rSel}/{rIds.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`prop-tree__pill${rAll ? " is-on" : rSome ? " is-some" : ""}`}
                    onClick={() => setMany(rIds, !rAll)}
                    aria-pressed={rAll}
                    title={rAll ? "Deselect all in region" : "Select all in region"}
                  >
                    {rAll ? <Check size={13} strokeWidth={2.5} aria-hidden /> : null}
                    {rAll ? "All in region" : rSome ? "Select rest" : "All in region"}
                  </button>
                </header>

                {isOpen ? (
                  <div className="prop-tree__portfolios" id={`region-${r.id}-body`}>
                    {r.portfolios.map((pf) => {
                      const pfIds = pf.properties.map((p) => p.id);
                      const pfSel = pfIds.reduce(
                        (acc, id) => acc + (selectedSet.has(id) ? 1 : 0),
                        0
                      );
                      const pfAll = pfIds.length > 0 && pfSel === pfIds.length;
                      const pfSome = pfSel > 0 && !pfAll;
                      return (
                        <div
                          key={pf.id}
                          className={`prop-tree__portfolio${pfAll ? " is-all" : pfSome ? " is-some" : ""}`}
                        >
                          <div className="prop-tree__portfolio-head">
                            <span className="prop-tree__portfolio-name">
                              <FolderKanban size={14} strokeWidth={2.2} aria-hidden />
                              <span>{pf.name}</span>
                              <span className="prop-tree__counter prop-tree__counter--sm">
                                {pfSel}/{pfIds.length}
                              </span>
                            </span>
                            <button
                              type="button"
                              className={`prop-tree__pill prop-tree__pill--sm${
                                pfAll ? " is-on" : pfSome ? " is-some" : ""
                              }`}
                              onClick={() => setMany(pfIds, !pfAll)}
                              aria-pressed={pfAll}
                            >
                              {pfAll ? (
                                <>
                                  <Check size={12} strokeWidth={2.5} aria-hidden />
                                  Selected
                                </>
                              ) : pfSome ? (
                                "Select rest"
                              ) : (
                                "Select all"
                              )}
                            </button>
                          </div>
                          <ul className="prop-tree__chips">
                            {pf.properties.map((p) => {
                              const on = selectedSet.has(p.id);
                              return (
                                <li key={p.id}>
                                  <button
                                    type="button"
                                    className={`prop-tree__chip${on ? " is-on" : ""}`}
                                    onClick={() => toggleId(p.id)}
                                    aria-pressed={on}
                                  >
                                    <span className="prop-tree__chip-tick" aria-hidden>
                                      {on ? <Check size={12} strokeWidth={2.8} /> : null}
                                    </span>
                                    <span className="prop-tree__chip-name">{p.name}</span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminUsersPanel({ isSuperAdmin, workspaceCompanyId, companies }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteCompanyId, setInviteCompanyId] = useState(workspaceCompanyId);
  const [inviteProps, setInviteProps] = useState([]);
  const [selProps, setSelProps] = useState(() => new Set());
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  /** Shown when API returns passwordResetLink (e.g. dev or INVITE_EXPOSE_LINK) because email was not sent. */
  const [inviteLinkUrl, setInviteLinkUrl] = useState("");

  const [editUser, setEditUser] = useState(null);
  const [editRole, setEditRole] = useState("member");
  const [editSel, setEditSel] = useState(() => new Set());
  const [editBusy, setEditBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAuthUsers(isSuperAdmin ? workspaceCompanyId : undefined);
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, workspaceCompanyId]);

  const loadProps = useCallback(async (cid) => {
    if (!cid) return;
    try {
      const data = await api.getAuthPropertyOptions(cid);
      setInviteProps(data.properties || []);
    } catch {
      setInviteProps([]);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (inviteOpen) {
      setInviteCompanyId(workspaceCompanyId);
      setSelProps(new Set());
      setInviteLinkUrl("");
      void loadProps(workspaceCompanyId);
    }
  }, [inviteOpen, workspaceCompanyId, loadProps]);

  useEffect(() => {
    if (!isSuperAdmin) setInviteCompanyId(workspaceCompanyId);
  }, [isSuperAdmin, workspaceCompanyId]);

  useEffect(() => {
    if (!editUser || editRole !== "member") return;
    const cid = editUser.companyId ?? workspaceCompanyId;
    if (!cid) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.getAuthPropertyOptions(cid);
        if (!cancelled) setInviteProps(data.properties || []);
      } catch {
        if (!cancelled) setInviteProps([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editUser, editRole, workspaceCompanyId]);

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email) {
      setInviteMsg("Email is required");
      return;
    }
    const cid = isSuperAdmin ? inviteCompanyId : workspaceCompanyId;
    if (!cid) {
      setInviteMsg("Select a company");
      return;
    }
    const propertyIds = inviteRole === "member" ? [...selProps] : [];
    if (inviteRole === "member" && propertyIds.length === 0) {
      setInviteMsg("Select at least one property for a member");
      return;
    }
    setInviteBusy(true);
    setInviteMsg("");
    setInviteLinkUrl("");
    try {
      let msAcc = await getActiveMsAccount();
      if (!msAcc && isMicrosoftMailConfigured()) {
        setInviteMsg("Please sign in with Microsoft to send the invitation from your mailbox...");
        try {
          await loginMicrosoft();
        } catch (e) {
          const msg = e?.message || "Microsoft sign-in was cancelled or failed.";
          throw new Error(`Microsoft sign-in required before sending invite email. ${msg}`);
        }
        msAcc = await getActiveMsAccount();
        if (!msAcc) {
          throw new Error("Microsoft sign-in did not complete. Please try Send invitation again.");
        }
      }
      const preferMailboxDelivery = Boolean(msAcc);

      const res = await api.postAuthInvite({
        email,
        role: inviteRole,
        companyId: cid,
        propertyIds,
        preferMailboxDelivery
      });

      let graphSent = false;
      let graphErr = "";
      const inviteSubject = res.graphInvite?.subject || "Invitation";
      const inviteHtml = res.graphInvite?.html || "";
      const previewText = inviteHtml ? plainTextFromHtml(inviteHtml, 1900) : null;
      if (preferMailboxDelivery && inviteHtml) {
        try {
          const meta = await sendOutlookHtmlMail({
            to: email,
            htmlDocument: inviteHtml,
            subject: inviteSubject
          });
          graphSent = true;
          await logInviteEmail({
            type: "invite",
            senderMailbox: msAcc?.username || "outlook",
            toEmail: email,
            subject: inviteSubject,
            graphMessageId: meta.graphMessageId,
            graphConversationId: meta.graphConversationId || "",
            sentAt: meta.sentAt,
            tenantLabel: null,
            propertyName: null,
            bodyPreview: previewText
          });
        } catch (e) {
          graphErr = e?.message || String(e);
        }
      }

      if (graphSent) {
        setInviteMsg(
          "Invitation sent from your Microsoft mailbox (same as payment reminders). They should open the email, set a password, then sign in here."
        );
        setInviteLinkUrl("");
      } else if (res.emailed) {
        await logInviteEmail({
          type: "invite",
          senderMailbox: res.smtpFrom || "smtp",
          toEmail: email,
          subject: inviteSubject,
          graphMessageId: "",
          graphConversationId: "",
          sentAt: new Date().toISOString(),
          tenantLabel: null,
          propertyName: null,
          bodyPreview: previewText
        });
        setInviteMsg(
          "Invitation sent from the server (SMTP). They should open the email, set a password, then sign in here."
        );
        setInviteLinkUrl("");
      } else {
        const notice = typeof res.emailNotice === "string" ? res.emailNotice : "";
        const link = typeof res.passwordResetLink === "string" ? res.passwordResetLink : "";
        let msg = "";
        if (graphErr) {
          msg = `Outlook send failed: ${graphErr}. `;
        } else if (preferMailboxDelivery) {
          msg = "Could not send from Outlook. ";
        } else if (!res.emailed) {
          msg = "Server did not send email (SMTP missing or failed). ";
        }
        if (!preferMailboxDelivery && isMicrosoftMailConfigured()) {
          msg += "Tip: sign in with Microsoft in the toolbar to send from your mailbox next time. ";
        } else if (!isMicrosoftMailConfigured()) {
          msg += "Tip: set VITE_MS_CLIENT_ID for Outlook sends, or configure SMTP on the server. ";
        }
        if (notice) msg += `${notice} `;
        if (link) msg += "Copy the password link below.";
        setInviteMsg(msg.trim());
        setInviteLinkUrl(link);
      }

      setInviteEmail("");
      setSelProps(new Set());
      await loadUsers();
      /** Close the modal only when an email actually went out; keep it open when the admin still
       * needs to copy the password link (no email path). */
      if (graphSent || res.emailed) {
        setInviteOpen(false);
      }
    } catch (e) {
      setInviteMsg(e.message || "Invite failed");
    } finally {
      setInviteBusy(false);
    }
  }

  function openEdit(u) {
    setEditUser(u);
    setEditRole(u.role);
    setEditSel(new Set(u.propertyIds || []));
  }

  async function saveEdit() {
    if (!editUser) return;
    setEditBusy(true);
    try {
      await api.patchAuthUser(editUser.id, {
        role: editRole,
        ...(editRole === "member" ? { propertyIds: [...editSel] } : {})
      });
      setEditUser(null);
      await loadUsers();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="admin-users-panel">
      <div className="admin-users-panel__head">
        <h2 className="admin-users-panel__title">Users &amp; access</h2>
        <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
          <UserPlus size={17} aria-hidden />
          Invite user
        </button>
      </div>
      <p className="text-muted admin-users-panel__hint">
        Invites use the same Outlook send as unit payment reminders when you are signed in with Microsoft; otherwise the
        server sends via SMTP if <code>SMTP_HOST</code> / <code>SMTP_FROM</code> are set in backend <code>.env</code>.
      </p>

      {loading && <Spinner />}
      {error ? <div className="admin-users-panel__alert admin-users-panel__alert--error">{error}</div> : null}

      {!loading && (
        <div className="table-wrap table-wrap--report">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                {isSuperAdmin ? <th>Company</th> : null}
                <th>Role</th>
                <th>Properties</th>
                <th>Last sign-in</th>
                <th>Active</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  {isSuperAdmin ? <td className="text-muted">{u.companyName ?? "—"}</td> : null}
                  <td>{u.role}</td>
                  <td className="text-muted">
                    {u.role === "member" ? (u.propertyIds?.length ? `${u.propertyIds.length} selected` : "—") : "All"}
                  </td>
                  <td className="text-muted" style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                    {formatAuthInstant(u.lastLoginAt)}
                  </td>
                  <td>
                    {u.invitationPending ? (
                      <span className="admin-users-panel__status admin-users-panel__status--pending">
                        Pending invite
                      </span>
                    ) : u.active ? (
                      <span className="admin-users-panel__status admin-users-panel__status--active">Yes</span>
                    ) : (
                      <span className="admin-users-panel__status admin-users-panel__status--inactive">No</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" title="Edit access" onClick={() => openEdit(u)}>
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen ? (
        <div className="auth-modal-backdrop auth-modal-backdrop--opaque" role="presentation" onMouseDown={() => setInviteOpen(false)}>
          <div
            className="auth-glass auth-glass--admin-panel auth-glass--modal auth-glass--modal-wide auth-dialog"
            role="dialog"
            aria-labelledby="admin-invite-title"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="auth-dialog__header">
              <h2 id="admin-invite-title" className="auth-modal__title">
                <Mail size={20} strokeWidth={2} aria-hidden />
                Invite user
              </h2>
              <p className="auth-modal__lead">
                They will receive a link to set a password, then can sign in from the login page.
              </p>
            </div>
            <div className="auth-dialog__body">
            <div className="auth-modal__stack">
              {isSuperAdmin ? (
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="inv-company">
                    Company
                  </label>
                  <select
                    id="inv-company"
                    className="auth-field__input"
                    value={inviteCompanyId ?? ""}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setInviteCompanyId(v);
                      void loadProps(v);
                      setSelProps(new Set());
                    }}
                  >
                    {(companies || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="auth-field">
                <label className="auth-field__label" htmlFor="inv-email">
                  Email
                </label>
                <input
                  id="inv-email"
                  className="auth-field__input"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  autoComplete="off"
                  placeholder="name@company.com"
                />
              </div>
              <div className="auth-field">
                <label className="auth-field__label" htmlFor="inv-role">
                  Role
                </label>
                <select
                  id="inv-role"
                  className="auth-field__input"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value="member">Member (property-scoped)</option>
                  <option value="company_admin">Company admin</option>
                </select>
              </div>
              {inviteRole === "member" ? (
                <PropertyAccessTree
                  headingId="admin-invite-prop-access"
                  properties={inviteProps}
                  selectedSet={selProps}
                  onChange={setSelProps}
                />
              ) : null}
              {inviteMsg ? <p className="auth-modal__msg text-muted">{inviteMsg}</p> : null}
              {inviteLinkUrl ? (
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="inv-reset-link">
                    Password link (if email did not send)
                  </label>
                  <div className="admin-users-panel__link-row">
                    <input id="inv-reset-link" className="auth-field__input" readOnly value={inviteLinkUrl} />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void navigator.clipboard.writeText(inviteLinkUrl)}
                    >
                      Copy
                    </button>
                  </div>
                  <p className="auth-modal__fine-print text-muted">
                    Anyone with this link can set the account password until it is used or expires.
                  </p>
                </div>
              ) : null}
            </div>
            </div>
            <div className="auth-dialog__footer auth-modal__actions">
              <button type="button" className="btn btn-ghost" onClick={() => setInviteOpen(false)}>
                Close
              </button>
              <button type="button" className="btn btn-primary" disabled={inviteBusy} onClick={() => void sendInvite()}>
                {inviteBusy ? "Sending…" : "Send invitation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editUser ? (
        <div className="auth-modal-backdrop auth-modal-backdrop--opaque" role="presentation" onMouseDown={() => setEditUser(null)}>
          <div
            className="auth-glass auth-glass--admin-panel auth-glass--modal auth-glass--modal-wide auth-dialog"
            role="dialog"
            aria-labelledby="admin-edit-user-title"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="auth-dialog__header">
              <h2 id="admin-edit-user-title" className="auth-modal__title">
                <Pencil size={20} strokeWidth={2} aria-hidden />
                Edit access
              </h2>
              <p className="auth-modal__lead admin-users-panel__edit-email">{editUser.email}</p>
            </div>
            <div className="auth-dialog__body">
            <div className="auth-modal__stack">
              <div className="auth-field">
                <label className="auth-field__label" htmlFor="edit-role">
                  Role
                </label>
                <select
                  id="edit-role"
                  className="auth-field__input"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                >
                  <option value="member">Member</option>
                  <option value="company_admin">Company admin</option>
                  {!isSuperAdmin ? null : <option value="super_admin">Super admin</option>}
                </select>
              </div>
              {editRole === "member" ? (
                <PropertyAccessTree
                  headingId="admin-edit-prop-access"
                  properties={inviteProps}
                  selectedSet={editSel}
                  onChange={setEditSel}
                />
              ) : null}
            </div>
            </div>
            <div className="auth-dialog__footer auth-modal__actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditUser(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={editBusy} onClick={() => void saveEdit()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
