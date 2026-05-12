import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import {
  getActiveMsAccount,
  isMicrosoftMailConfigured,
  loginMicrosoft,
  logoutMicrosoft
} from "../microsoft/msGraphMail";

const UNCONFIGURED_TITLE =
  "Add VITE_MS_CLIENT_ID (and optional VITE_MS_REDIRECT_URI) to frontend .env, restart the dev server, then sign in to send reminder emails from your Outlook mailbox.";

export default function MicrosoftAccountConnect({ menuMode = false }) {
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const configured = isMicrosoftMailConfigured();

  const refresh = useCallback(async () => {
    if (!configured) {
      setAccount(null);
      return;
    }
    const a = await getActiveMsAccount();
    setAccount(a);
  }, [configured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const label = account?.username || account?.name || "";

  async function onLogin() {
    if (!configured) return;
    setError("");
    setBusy(true);
    try {
      await loginMicrosoft();
      await refresh();
    } catch (e) {
      setError(e.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    if (!configured) return;
    setError("");
    setBusy(true);
    try {
      await logoutMicrosoft();
      setAccount(null);
    } catch (e) {
      setError(e.message || "Sign-out failed");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    if (menuMode) {
      return (
        <div className="nav-ms-menu nav-ms-menu--muted" title={UNCONFIGURED_TITLE}>
          <LogIn size={18} aria-hidden />
          <span>Outlook not configured (set VITE_MS_CLIENT_ID)</span>
        </div>
      );
    }
    return (
      <span className="nav-ms nav-ms--unconfigured" title={UNCONFIGURED_TITLE}>
        <LogIn size={18} aria-hidden />
        Microsoft
      </span>
    );
  }

  if (account) {
    if (menuMode) {
      return (
        <div className="nav-ms-menu nav-ms-menu--signed">
          <span className="nav-ms-menu__label" title={label}>
            Outlook: {label || "Connected"}
          </span>
          <button
            type="button"
            className="nav-ms-menu__btn"
            disabled={busy}
            onClick={onLogout}
            aria-label="Sign out of Microsoft"
          >
            <LogOut size={16} aria-hidden />
            Disconnect Outlook
          </button>
        </div>
      );
    }
    return (
      <div className="nav-ms nav-ms--signed" title={label}>
        <span className="nav-ms-label">{label}</span>
        <button
          type="button"
          className="nav-link nav-ms-logout"
          disabled={busy}
          onClick={onLogout}
          aria-label="Sign out of Microsoft"
          title="Sign out"
        >
          <LogOut size={18} aria-hidden />
        </button>
      </div>
    );
  }

  if (menuMode) {
    return (
      <button type="button" className="nav-ms-menu nav-ms-menu__connect" disabled={busy} onClick={onLogin} title={error || "Connect Outlook"}>
        <LogIn size={18} aria-hidden />
        {busy ? "Connecting…" : "Connect Outlook"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="nav-link"
      disabled={busy}
      onClick={onLogin}
      title={error || "Sign in with Microsoft to send reminder emails from your mailbox"}
    >
      <LogIn size={18} aria-hidden />
      {busy ? "Signing in…" : "Microsoft"}
    </button>
  );
}
