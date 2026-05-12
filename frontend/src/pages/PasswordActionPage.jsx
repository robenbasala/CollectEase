import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Eye, EyeOff, KeyRound, X } from "lucide-react";
import { confirmPasswordReset, signInWithEmailAndPassword, verifyPasswordResetCode } from "firebase/auth";
import { api } from "../api/apiClient";
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

  const checks = useMemo(
    () => ({
      length: password.length >= 8,
      letter: /[A-Za-z]/.test(password),
      digit: /\d/.test(password),
      match: confirm.length > 0 && password === confirm
    }),
    [password, confirm]
  );
  const allChecksPass = checks.length && checks.letter && checks.digit && checks.match;

  async function onSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (!checks.length) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (!checks.letter || !checks.digit) {
      setFormError("Password should include at least one letter and one number.");
      return;
    }
    if (!checks.match) {
      setFormError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const auth = getFirebaseAuth();
      await confirmPasswordReset(auth, oobCode, password);
      if (email) {
        await signInWithEmailAndPassword(auth, email, password);
        await api.getAuthMe();
      }
      setDone(true);
    } catch (err) {
      setFormError(err?.message || "Could not save your password. Try requesting a new link.");
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
              <div className="set-password__hero set-password__hero--success" aria-hidden>
                <Check size={26} strokeWidth={2.5} />
              </div>
              <h1 className="auth-login__title">You're all set</h1>
              <p className="auth-login__subtitle">
                Your password is saved. You can now sign in to CollectEase with{" "}
                {email ? <strong style={{ fontWeight: 700 }}>{email}</strong> : "your email"} and the password you
                just chose.
              </p>
              <Link
                to="/login"
                className="auth-login__btn auth-login__btn--primary"
                style={{ textAlign: "center", textDecoration: "none" }}
              >
                Continue to sign in
              </Link>
            </>
          ) : invalid && !email ? (
            <>
              <div className="set-password__hero set-password__hero--error" aria-hidden>
                <X size={26} strokeWidth={2.5} />
              </div>
              <h1 className="auth-login__title">Link not valid</h1>
              <p className="auth-login__subtitle">
                {verifyError || "Open the link from your invitation email, or ask your admin to send a new one."}
              </p>
              <Link
                to="/login"
                className="auth-login__forgot"
                style={{ display: "block", textAlign: "center", marginTop: "1rem" }}
              >
                Return to sign in
              </Link>
            </>
          ) : (
            <>
              <div className="set-password__hero" aria-hidden>
                <KeyRound size={24} strokeWidth={2} />
              </div>
              <span className="set-password__eyebrow">Welcome to CollectEase</span>
              <h1 className="auth-login__title">Set your password for the first time</h1>
              <p className="auth-login__subtitle">
                {email ? (
                  <>
                    Pick the password you'll use to sign in as{" "}
                    <strong style={{ fontWeight: 700 }}>{email}</strong>. You can change it later from your profile.
                  </>
                ) : (
                  "Pick the password you'll use to sign in. You can change it later from your profile."
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
                      placeholder="Create a password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      aria-describedby="set-password-rules"
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
                      placeholder="Type the password again"
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

                <ul id="set-password-rules" className="set-password__rules" aria-live="polite">
                  <li className={`set-password__rule${checks.length ? " is-met" : ""}`}>
                    <span className="set-password__rule-tick" aria-hidden>
                      {checks.length ? <Check size={12} strokeWidth={3} /> : null}
                    </span>
                    At least 8 characters
                  </li>
                  <li className={`set-password__rule${checks.letter ? " is-met" : ""}`}>
                    <span className="set-password__rule-tick" aria-hidden>
                      {checks.letter ? <Check size={12} strokeWidth={3} /> : null}
                    </span>
                    Includes a letter
                  </li>
                  <li className={`set-password__rule${checks.digit ? " is-met" : ""}`}>
                    <span className="set-password__rule-tick" aria-hidden>
                      {checks.digit ? <Check size={12} strokeWidth={3} /> : null}
                    </span>
                    Includes a number
                  </li>
                  <li className={`set-password__rule${checks.match ? " is-met" : ""}`}>
                    <span className="set-password__rule-tick" aria-hidden>
                      {checks.match ? <Check size={12} strokeWidth={3} /> : null}
                    </span>
                    Both passwords match
                  </li>
                </ul>

                {formError ? <p className="auth-login__error">{formError}</p> : null}
                <button
                  type="submit"
                  className="auth-login__btn auth-login__btn--primary set-password__submit"
                  disabled={busy || !allChecksPass}
                >
                  {busy ? "Saving…" : "Save password & sign in"}
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
