import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Shield } from "lucide-react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "../auth/firebase.js";
import logoSvg from "../media/Logo.svg";

const base = import.meta.env.BASE_URL || "/";
const logoPngPublic = `${base}Logo.png`.replace(/([^:])\/{2,}/g, "$1/");

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  /** Try `public/Logo.png` first, then bundled SVG. */
  const [logoSrc, setLogoSrc] = useState(logoPngPublic);
  const [logoBroken, setLogoBroken] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  function onLogoError() {
    if (logoSrc !== logoSvg) setLogoSrc(logoSvg);
    else setLogoBroken(true);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setResetMsg("");
    if (!isFirebaseConfigured()) {
      setError("Firebase is not configured. Set VITE_FIREBASE_* in .env.");
      return;
    }
    const em = email.trim();
    if (!em || !password) {
      setError("Enter email and password.");
      return;
    }
    setBusy(true);
    try {
      const auth = getFirebaseAuth();
      await signInWithEmailAndPassword(auth, em, password);
      navigate("/", { replace: true });
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError("Invalid email or password.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Try again later.");
      } else {
        setError(err?.message || "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword() {
    setError("");
    setResetMsg("");
    if (!isFirebaseConfigured()) {
      setError("Firebase is not configured.");
      return;
    }
    const em = email.trim();
    if (!em) {
      setError("Enter your email above, then use Forgot your password.");
      return;
    }
    setBusy(true);
    try {
      const auth = getFirebaseAuth();
      const resetContinueUrl = new URL("reset-password", `${window.location.origin}${base}`).href;
      await sendPasswordResetEmail(auth, em, { url: resetContinueUrl });
      setResetMsg("If an account exists for this email, a reset link has been sent.");
    } catch (err) {
      setError(err?.message || "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell auth-shell--login">
      <div className="auth-shell__bg" aria-hidden />
      <div className="auth-shell__glow auth-shell__glow--1" aria-hidden />
      <div className="auth-shell__glow auth-shell__glow--2" aria-hidden />
      <div className="auth-shell__logo-watermark" aria-hidden>
        {!logoBroken ? (
          <img src={logoSrc} alt="" className="auth-shell__logo-watermark-img" onError={onLogoError} />
        ) : null}
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

          <h1 className="auth-login__title">Welcome Back</h1>
          <p className="auth-login__subtitle">Sign in to access your analytics dashboard</p>

          <form className="auth-login__form" onSubmit={(e) => void onSubmit(e)}>
            <div className="auth-field">
              <label className="auth-field__label" htmlFor="login-email">
                Email Address
              </label>
              <input
                id="login-email"
                className="auth-field__input"
                type="email"
                autoComplete="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="auth-field">
              <label className="auth-field__label" htmlFor="login-password">
                Password
              </label>
              <div className="auth-field__password-wrap">
                <input
                  id="login-password"
                  className="auth-field__input auth-field__input--password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="auth-field__toggle-visibility"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={busy}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff size={20} strokeWidth={2} /> : <Eye size={20} strokeWidth={2} />}
                </button>
              </div>
            </div>

            {error ? <p className="auth-login__error">{error}</p> : null}
            {resetMsg ? <p className="auth-login__success">{resetMsg}</p> : null}

            <button type="submit" className="auth-login__btn auth-login__btn--primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="auth-login__forgot-wrap">
            <button type="button" className="auth-login__forgot" disabled={busy} onClick={() => void onForgotPassword()}>
              Forgot your password?
            </button>
          </p>

          <div className="auth-login__or" role="presentation">
            <span className="auth-login__or-line" aria-hidden />
            <span className="auth-login__or-text">or</span>
            <span className="auth-login__or-line" aria-hidden />
          </div>

          <p className="auth-login__no-account">Don&apos;t have an account yet?</p>
          <button
            type="button"
            className="auth-login__btn auth-login__btn--request"
            disabled={busy}
            onClick={() => setRequestOpen(true)}
          >
            Request Account Access
          </button>
          <p className="auth-login__invite-hint">You&apos;ll need an invitation from your team administrator</p>

          <div className="auth-login__badge">
            <Shield size={16} strokeWidth={2.2} aria-hidden />
            <span>Secure authentication via Firebase</span>
          </div>
        </div>

        <p className="auth-shell__footer-line">Protected by enterprise-grade security</p>
      </div>

      {requestOpen ? (
        <div className="auth-modal-backdrop" role="presentation" onMouseDown={() => setRequestOpen(false)}>
          <div
            className="auth-glass auth-glass--modal"
            role="dialog"
            aria-labelledby="request-access-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="request-access-title" className="auth-login__title" style={{ fontSize: "1.2rem" }}>
              Request access
            </h2>
            <p className="auth-login__subtitle" style={{ marginBottom: "1rem" }}>
              CollectEase accounts are created by a company or super administrator. Ask your admin to invite this email
              address; you will receive a link to set your password, then return here to sign in.
            </p>
            <button type="button" className="btn btn-primary" style={{ width: "100%" }} onClick={() => setRequestOpen(false)}>
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
