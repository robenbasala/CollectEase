import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api/apiClient";
import { getActiveCompanyId } from "./config/company.js";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import PropertyDetails from "./pages/PropertyDetails";
import AdminPage from "./pages/AdminPage";
import SettingsPage from "./pages/SettingsPage";

function AppLayout() {
  const location = useLocation();
  const companyId = useMemo(() => getActiveCompanyId(), []);

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
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/settings") return;
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
        /* optional: table or columns missing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

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
          companyId
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/property/:propertyName" element={<PropertyDetails />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
