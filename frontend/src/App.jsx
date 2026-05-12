import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api/apiClient";
import { useAuth } from "./context/AuthContext.jsx";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import PropertyDetails from "./pages/PropertyDetails";
import AdminPage from "./pages/AdminPage";
import SettingsPage from "./pages/SettingsPage";
import ReminderEmailHistoryPage from "./pages/ReminderEmailHistoryPage";
import LoginPage from "./pages/LoginPage.jsx";
import FinishSignInPage from "./pages/FinishSignInPage.jsx";
import PasswordActionPage from "./pages/PasswordActionPage.jsx";
import Spinner from "./components/Spinner";

function NoInvitationPage({ onSignOut }) {
  return (
    <div className="auth-shell">
      <div className="auth-shell__bg" aria-hidden />
      <div className="auth-shell__glow auth-shell__glow--1" aria-hidden />
      <div className="auth-shell__glow auth-shell__glow--2" aria-hidden />
      <div className="auth-glass auth-glass--narrow">
        <div className="auth-glass__brand">
          <span className="auth-glass__logo-wrap" aria-hidden>
            <Building2 size={22} strokeWidth={2.1} />
          </span>
          <span className="auth-glass__name">CollectEase</span>
        </div>
        <h1 className="auth-glass__title">No invitation</h1>
        <p className="auth-glass__lead">
          You signed in, but there is no access profile for this account yet. Ask your administrator to invite this exact email,
          then use the password link from the invitation email before signing in here.
        </p>
        <button type="button" className="btn btn-primary auth-glass__cta" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { firebaseConfigured, loading, firebaseUser, user, error, logout } = useAuth();

  if (!firebaseConfigured) {
    return (
      <div className="page">
        <p style={{ color: "var(--color-danger)" }}>Firebase is not configured. Set VITE_FIREBASE_* variables in .env.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  }
  if (!firebaseUser) {
    return <Navigate to="/login" replace />;
  }
  if (!user) {
    if (error === "no_invite") {
      return <NoInvitationPage onSignOut={logout} />;
    }
    return (
      <div className="page">
        <Spinner />
        {error ? (
          <p className="text-muted" style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap", maxWidth: "42rem" }}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  return children;
}

function AppLayout() {
  const location = useLocation();
  const { user, effectiveCompanyId, isSuperAdmin } = useAuth();

  const apiCompanyId = useMemo(() => {
    if (!user) return null;
    if (isSuperAdmin) return effectiveCompanyId ?? user.companyId ?? null;
    return user.companyId ?? null;
  }, [user, isSuperAdmin, effectiveCompanyId]);

  const [regions, setRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [loadingRegions, setLoadingRegions] = useState(true);
  const [navError, setNavError] = useState("");
  const [branding, setBranding] = useState({ logoDataUrl: null, companyDisplayName: null });

  const isSettingsRoute = location.pathname === "/settings";
  const showNavError =
    navError && location.pathname !== "/admin" && location.pathname !== "/settings";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isSettingsRoute) {
        setLoadingRegions(false);
        return;
      }
      if (apiCompanyId == null) {
        setLoadingRegions(false);
        return;
      }
      setLoadingRegions(true);
      setNavError("");
      try {
        const data = await api.getDashboardRegions();
        const list = data.regions || [];
        if (!cancelled) {
          setRegions(list);
          setSelectedRegion((prev) => (list.includes(prev) ? prev : list[0] || ""));
        }
      } catch (e) {
        if (!cancelled) setNavError(e.message || "Failed to load regions");
      } finally {
        if (!cancelled) setLoadingRegions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname, isSettingsRoute, apiCompanyId]);

  useEffect(() => {
    if (location.pathname === "/settings") return;
    if (apiCompanyId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getAdminCompanySettings();
        const s = data.settings;
        if (cancelled || !s) return;
        setBranding({
          logoDataUrl: s.logoDataUrl || null,
          companyDisplayName: s.companyDisplayName || null
        });
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname, apiCompanyId]);

  useEffect(() => {
    function onCompanySettingsUpdated(e) {
      const s = e.detail;
      if (!s) return;
      setBranding({
        logoDataUrl: s.logoDataUrl || null,
        companyDisplayName: s.companyDisplayName || null
      });
    }
    window.addEventListener("ct:company-settings-updated", onCompanySettingsUpdated);
    return () => window.removeEventListener("ct:company-settings-updated", onCompanySettingsUpdated);
  }, []);

  return (
    <div className="app-shell">
      {!isSettingsRoute && (
        <Navbar
          regions={regions}
          selectedRegion={selectedRegion}
          onSelectRegion={setSelectedRegion}
          loadingRegions={loadingRegions}
          branding={branding}
        />
      )}
      {showNavError && (
        <div
          className="page"
          style={{ paddingTop: "0.5rem", color: "var(--color-danger)", fontSize: "0.9rem" }}
        >
          {navError}
        </div>
      )}
      <Outlet
        context={{
          regions,
          selectedRegion,
          setSelectedRegion,
          loadingRegions,
          companyId: apiCompanyId
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<PasswordActionPage />} />
      <Route path="/finish-signin" element={<FinishSignInPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/property/:propertyName" element={<PropertyDetails />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/reminder-emails" element={<ReminderEmailHistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
