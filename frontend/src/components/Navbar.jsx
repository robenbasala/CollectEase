import { NavLink, useLocation } from "react-router-dom";
import { Building2, LayoutDashboard, Settings, Shield } from "lucide-react";
import { getCompanyDisplayName } from "../config/company.js";

export default function Navbar({ regions, selectedRegion, onSelectRegion, loadingRegions, branding }) {
  const location = useLocation();
  const showRegionBar = location.pathname === "/";
  const envLabel = getCompanyDisplayName();
  const companyLabel = (branding?.companyDisplayName && String(branding.companyDisplayName).trim()) || envLabel;

  return (
    <header className="navbar">
      <div className="navbar-row navbar-row--main">
        <NavLink to="/" className="brand">
          {branding?.logoDataUrl ? (
            <img src={branding.logoDataUrl} alt="" className="brand-logo-img" width={28} height={28} />
          ) : (
            <Building2 size={22} strokeWidth={2.25} />
          )}
          Collection Tracker
        </NavLink>

        {companyLabel ? (
          <div className="company-bar">
            <span className="company-static-label">{companyLabel}</span>
          </div>
        ) : null}

        <nav className="nav-links">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} end>
            <LayoutDashboard size={18} />
            Dashboard
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <Settings size={18} />
            Settings
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
            <Shield size={18} />
            Admin
          </NavLink>
        </nav>
      </div>
      {showRegionBar ? (
        <div className="navbar-row navbar-row--regions" aria-label="Region selection">
          <div className="region-tabs">
            <span className="region-label">Regions</span>
            {loadingRegions && <span className="text-muted">Loading…</span>}
            {!loadingRegions &&
              regions.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip ${selectedRegion === r ? "selected" : ""}`}
                  onClick={() => onSelectRegion(r)}
                >
                  {r}
                </button>
              ))}
            {!loadingRegions && regions.length === 0 && (
              <span className="text-muted">No regions</span>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
