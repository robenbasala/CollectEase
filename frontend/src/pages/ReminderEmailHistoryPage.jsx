import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Mail } from "lucide-react";
import { api } from "../api/apiClient";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import {
  fetchReminderRepliesInThread,
  getActiveMsAccount,
  isMicrosoftMailConfigured
} from "../microsoft/msGraphMail";

function formatWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export default function ReminderEmailHistoryPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [repliesById, setRepliesById] = useState(() => ({}));

  const loadList = useCallback(async () => {
    setListErr("");
    setLoading(true);
    try {
      const data = await api.getAdminReminderEmailLog();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (e) {
      setListErr(e.message || "Failed to load history");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function toggleReplies(entry) {
    const id = entry.id;
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
      setExpanded(next);
      return;
    }
    next.add(id);
    setExpanded(next);

    if (repliesById[id]?.status === "ok" || repliesById[id]?.status === "loading") return;

    if (!isMicrosoftMailConfigured()) {
      setRepliesById((prev) => ({
        ...prev,
        [id]: { status: "err", items: [], message: "Microsoft is not configured in .env." }
      }));
      return;
    }
    const acc = await getActiveMsAccount();
    if (!acc) {
      setRepliesById((prev) => ({
        ...prev,
        [id]: {
          status: "err",
          items: [],
          message: "Sign in with Microsoft (toolbar) to load replies from your mailbox."
        }
      }));
      return;
    }

    if (!entry.graphConversationId || !String(entry.graphConversationId).trim()) {
      setRepliesById((prev) => ({
        ...prev,
        [id]: {
          status: "err",
          items: [],
          message:
            "No conversation id was stored for this send, so inbox replies cannot be matched. New sends after the latest update will include it."
        }
      }));
      return;
    }

    setRepliesById((prev) => ({ ...prev, [id]: { status: "loading", items: [], message: "" } }));
    try {
      const items = await fetchReminderRepliesInThread({
        conversationId: entry.graphConversationId,
        sentMessageId: entry.graphMessageId,
        sentAtIso: entry.sentAt,
        reminderToEmail: entry.toEmail
      });
      setRepliesById((prev) => ({
        ...prev,
        [id]: { status: "ok", items, message: items.length ? "" : "No replies in Inbox for this thread yet." }
      }));
    } catch (e) {
      setRepliesById((prev) => ({
        ...prev,
        [id]: { status: "err", items: [], message: e?.message || "Could not load replies" }
      }));
    }
  }

  return (
    <div className="page reminder-email-history">
      <PageHeader title="Sent emails" icon={<Mail size={20} strokeWidth={2.2} />} backTo={-1} />
      <p className="text-muted reminder-email-history__intro">
        Logged sends from this app (per company). Includes payment reminders and user invitations. Expand a reminder
        row to load <strong>replies</strong> from your Outlook Inbox via Microsoft Graph — use the same account you
        signed in with in the toolbar.
      </p>

      {loading ? (
        <Spinner />
      ) : listErr ? (
        <div className="card reminder-email-history__card">
          <p className="text-danger" role="alert">
            {listErr}
          </p>
          {/missing/i.test(listErr) ? (
            <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
              Run <code>backend/scripts/migrate-reminder-email-log.sql</code> on SQL Server, then refresh.
            </p>
          ) : null}
        </div>
      ) : entries.length === 0 ? (
        <div className="card reminder-email-history__card">
          <p className="text-muted">No emails have been logged yet. Send a payment reminder from Property details, or invite a user from Admin.</p>
        </div>
      ) : (
        <div className="table-wrap table-wrap--report reminder-email-history__wrap">
          <table className="data-table reminder-email-history__table">
            <thead>
              <tr>
                <th className="reminder-email-history__col-toggle" aria-label="Expand" />
                <th>Type</th>
                <th>Sent</th>
                <th>To</th>
                <th>Tenant / unit</th>
                <th>Property</th>
                <th>From (mailbox)</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const open = expanded.has(e.id);
                const rs = repliesById[e.id];
                const isInvite = e.type === "invite";
                const canExpand = !isInvite;
                return (
                  <Fragment key={e.id}>
                    <tr className={open ? "reminder-email-history__row-open" : ""}>
                      <td>
                        {canExpand ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm reminder-email-history__expand"
                            aria-expanded={open}
                            onClick={() => void toggleReplies(e)}
                          >
                            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`email-type-badge email-type-badge--${isInvite ? "invite" : "reminder"}`}
                        >
                          {isInvite ? "Invite" : "Reminder"}
                        </span>
                      </td>
                      <td>{formatWhen(e.sentAt)}</td>
                      <td className="reminder-email-history__mono">{e.toEmail}</td>
                      <td>{e.tenantLabel || "—"}</td>
                      <td>{e.propertyName || "—"}</td>
                      <td className="reminder-email-history__mono">{e.senderMailbox}</td>
                      <td>{e.subject || "—"}</td>
                    </tr>
                    {open && canExpand ? (
                      <tr className="reminder-email-history__detail-row">
                        <td colSpan={8}>
                          <div className="reminder-email-history__detail">
                            <div className="reminder-email-history__preview">
                              <strong>Preview (sent)</strong>
                              <p>{e.bodyPreview || "—"}</p>
                            </div>
                            <div className="reminder-email-history__replies">
                              <strong>Replies (Inbox)</strong>
                              {!rs || rs.status === "loading" ? (
                                <p className="text-muted">Loading…</p>
                              ) : rs.status === "err" ? (
                                <p className="text-danger" role="alert">
                                  {rs.message}
                                </p>
                              ) : rs.items.length === 0 ? (
                                <p className="text-muted">{rs.message || "No replies yet."}</p>
                              ) : (
                                <ul className="reminder-email-history__reply-list">
                                  {rs.items.map((r) => (
                                    <li key={r.id}>
                                      <div className="reminder-email-history__reply-head">
                                        <span className="reminder-email-history__reply-from">
                                          {r.fromName ? `${r.fromName} ` : ""}
                                          <span className="reminder-email-history__mono">&lt;{r.from}&gt;</span>
                                        </span>
                                        <time className="text-muted">{formatWhen(r.receivedAt)}</time>
                                        {!r.isRead ? (
                                          <span className="reminder-email-history__unread">Unread</span>
                                        ) : null}
                                      </div>
                                      <p className="reminder-email-history__reply-preview">{r.preview || "—"}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
