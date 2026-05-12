import { useCallback, useEffect, useState } from "react";
import { Layers, Mail, Pencil, UserPlus } from "lucide-react";
import { api } from "../api/apiClient";
import { getActiveMsAccount, isMicrosoftMailConfigured, sendOutlookHtmlMail } from "../microsoft/msGraphMail.js";
import Spinner from "./Spinner";

function formatAuthInstant(iso) {
  if (iso == null || String(iso).trim() === "") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function PropertyAccessPicker({ headingId, properties, selectedSet, onToggleId }) {
  const n = properties.length;
  const sel = selectedSet.size;
  return (
    <div className="admin-prop-picker" role="group" aria-labelledby={headingId}>
      <div className="admin-prop-picker__head">
        <div className="admin-prop-picker__head-text">
          <h3 id={headingId} className="admin-prop-picker__title">
            <Layers size={22} strokeWidth={2} className="admin-prop-picker__title-icon" aria-hidden />
            Property access
          </h3>
          <p className="admin-prop-picker__hint">Choose at least one property. This controls which units and reports they can open.</p>
        </div>
        {n > 0 ? (
          <span className="admin-prop-picker__badge" aria-live="polite">
            {sel} selected
          </span>
        ) : null}
      </div>
      {n === 0 ? (
        <div className="admin-prop-picker__empty">
          <p className="admin-prop-picker__empty-title">No properties for this company yet.</p>
          <p className="admin-prop-picker__empty-sub">
            Add regions, portfolios, and properties in the Admin sections first, or pick another company above.
          </p>
        </div>
      ) : (
        <ul className="admin-prop-picker__list">
          {properties.map((p) => {
            const on = selectedSet.has(p.id);
            return (
              <li key={p.id}>
                <label className={`admin-prop-picker__row${on ? " admin-prop-picker__row--on" : ""}`}>
                  <input
                    type="checkbox"
                    className="admin-prop-picker__checkbox"
                    checked={on}
                    onChange={() => onToggleId(p.id)}
                  />
                  <span className="admin-prop-picker__text">
                    <span className="admin-prop-picker__name">{p.name}</span>
                    <span className="admin-prop-picker__sub">
                      {p.regionName} · {p.portfolioName}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
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
      const msAcc = await getActiveMsAccount();
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
      if (preferMailboxDelivery && res.graphInvite?.html) {
        try {
          await sendOutlookHtmlMail({
            to: email,
            htmlDocument: res.graphInvite.html,
            subject: res.graphInvite.subject || "Invitation"
          });
          graphSent = true;
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

  function toggleProp(id, setFn, cur) {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFn(next);
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
                  <td>{u.disabled ? <span style={{ color: "var(--color-danger)" }}>No</span> : "Yes"}</td>
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
                <PropertyAccessPicker
                  headingId="admin-invite-prop-access"
                  properties={inviteProps}
                  selectedSet={selProps}
                  onToggleId={(id) => toggleProp(id, setSelProps, selProps)}
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
                <PropertyAccessPicker
                  headingId="admin-edit-prop-access"
                  properties={inviteProps}
                  selectedSet={editSel}
                  onToggleId={(id) => toggleProp(id, setEditSel, editSel)}
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
