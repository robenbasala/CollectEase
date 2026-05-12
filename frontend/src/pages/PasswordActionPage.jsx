import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "../auth/firebase.js";
import logoSvg from "../media/Logo.svg";

const base = import.meta.env.BASE_URL || "/";
const logoPngPublic = `${base}Logo.png`.replace(/([^:])\/{2,}/g, "$1/");

/**
 * In-app password reset. Set Firebase Console → Authentication → Templates → Action URL
 * to https://YOUR_DOMAIN/reset-password (and add the same path for dev) so links include ?mode=resetPassword&oobCode=...
 */
export default function PasswordActionPage() {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode") || "";
  const oobCode = searchParams.get("oobCode") || "";

  const [logoSrc, setLogoSrc] = useState(logoPngPublic);
  const [logoBroken, setLogoBroken] = useState(false);
  const [email, setEmail] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState("");

  function onLogoError() {
    if (logoSrc !== logoSvg) setLogoSrc(logoSvg);
    else setLogoBroken(true);
  }

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setVerifyError("Firebase is not configured.");
      return;
    }
    if (mode !== "resetPassword" || !oobCode) {
      setVerifyError("This link is invalid or expired. Request a new reset email from the sign-in page.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const auth = getFirebaseAuth();
        const mail = await verifyPasswordResetCode(auth, oobCode);
        if (!cancelled) setEmail(mail);
      } catch (e) {
        if (!cancelled) {
          setVerifyError(e?.message || "This reset link is invalid or has expired.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  async function onSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const auth = getFirebaseAuth();
      await confirmPasswordReset(auth, oobCode, password);
      setDone(true);
    } catch (err) {
      setFormError(err?.message || "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  const invalid = verifyError || mode !== "resetPassword" || !oobCode;

  return (
    <div className="auth-shell auth-shell--login">
      <div className="auth-shell__bg" aria-hidden />
      <div className="auth-shell__glow auth-shell__glow--1" aria-hidden />
      <div className="auth-shell__glow auth-shell__glow--2" aria-hidden />
      <div className="auth-shell__logo-watermark" aria-hidden>
        {!logoBroken ? <img src={logoSrc} alt="" className="auth-shell__logo-watermark-img" onError={onLogoError} /> : null}
      </div>

      <div className="auth-shell__center">
        <div className="auth-glass auth-glass--login">
          <div className="auth-login__brand">
            {!logoBroken ? (
              <img src={logoSrc} alt="CollectEase" className="auth-login__logo" onError={onLogoError} />
            ) : (
              <span className="auth-login__logo-fallback">CollectEase</span>
            )}
          </div>

          {done ? (
            <>
              <h1 className="auth-login__title">Password updated</h1>
              <p className="auth-login__subtitle">You can sign in with your new password.</p>
              <Link to="/login" className="auth-login__btn auth-login__btn--primary" style={{ textAlign: "center", textDecoration: "none" }}>
                Back to sign in
              </Link>
            </>
          ) : invalid && !email ? (
            <>
              <h1 className="auth-login__title">Link not valid</h1>
              <p className="auth-login__subtitle">{verifyError || "Open the reset link from your email, or request a new one."}</p>
              <Link to="/login" className="auth-login__forgot" style={{ display: "block", textAlign: "center", marginTop: "1rem" }}>
                Return to sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="auth-login__title">Set new password</h1>
              <p className="auth-login__subtitle">
                {email ? (
                  <>
                    Choose a password for <strong style={{ fontWeight: 700 }}>{email}</strong>
                  </>
                ) : (
                  "Choose a new password for your account."
                )}
              </p>

              <form className="auth-login__form" onSubmit={(e) => void onSubmit(e)}>
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="npw">
                    New password
                  </label>
                  <div className="auth-field__password-wrap">
                    <input
                      id="npw"
                      className="auth-field__input auth-field__input--password"
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="At least 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="auth-field__toggle-visibility"
                      tabIndex={-1}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      onClick={() => setShowPw((v) => !v)}
                    >
                      {showPw ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="npw2">
                    Confirm password
                  </label>
                  <div className="auth-field__password-wrap">
                    <input
                      id="npw2"
                      className="auth-field__input auth-field__input--password"
                      type={showPw2 ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repeat password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="auth-field__toggle-visibility"
                      tabIndex={-1}
                      aria-label={showPw2 ? "Hide password" : "Show password"}
                      onClick={() => setShowPw2((v) => !v)}
                    >
                      {showPw2 ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
                {formError ? <p className="auth-login__error">{formError}</p> : null}
                <button type="submit" className="auth-login__btn auth-login__btn--primary" disabled={busy}>
                  {busy ? "Saving…" : "Update password"}
                </button>
              </form>
              <p className="auth-login__forgot-wrap">
                <Link to="/login" className="auth-login__forgot">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
        <p className="auth-shell__footer-line">Secure password update via Firebase</p>
      </div>
    </div>
  );
}
