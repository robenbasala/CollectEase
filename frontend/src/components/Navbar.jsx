import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Building2,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageCircle,
  Settings,
  Shield
} from "lucide-react";
import { getCompanyDisplayName } from "../config/company.js";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api/apiClient.js";
import MicrosoftAccountConnect from "./MicrosoftAccountConnect";

function initialsFromUser(displayName, email) {
  const n = String(displayName || "").trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    }
    return n.slice(0, 2).toUpperCase();
  }
  const e = String(email || "").trim();
  if (e) return e.slice(0, 2).toUpperCase();
  return "?";
}

function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "super_admin") return "Super Admin";
  if (r === "company_admin") return "Admin";
  if (r === "member") return "Member";
  return "User";
}

function displayNameFrom(user, firebaseUser) {
  const d = firebaseUser?.displayName?.trim();
  if (d) return d;
  const e = user?.email || firebaseUser?.email || "";
  if (e) return e.split("@")[0] || e;
  return "User";
}

export default function Navbar({ regions, selectedRegion, onSelectRegion, loadingRegions, branding }) {
  const location = useLocation();
  const {
    user,
    isSuperAdmin,
    canOpenAdmin,
    effectiveCompanyId,
    setEffectiveCompanyId,
    logout,
    firebaseUser
  } = useAuth();
  const showRegionBar = location.pathname === "/";
  const envLabel = getCompanyDisplayName();
  const companyLabel = (branding?.companyDisplayName && String(branding.companyDisplayName).trim()) || envLabel;

  const [companies, setCompanies] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isSuperAdmin) {
      setCompanies([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.listCompanies();
        if (!cancelled) setCompanies(data.companies || []);
      } catch {
        if (!cancelled) setCompanies([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const email = user?.email || firebaseUser?.email || "";
  const displayName = displayNameFrom(user, firebaseUser);
  const initials = initialsFromUser(displayName, email);
  const role = roleLabel(user?.role);

  return (
    <header className="navbar navbar--glass">
      <div className="navbar-row navbar-row--main">
        <NavLink to="/" className="brand brand--stack" end onClick={closeMenu}>
          {branding?.logoDataUrl ? (
            <img src={branding.logoDataUrl} alt="" className="brand-logo-img" width={28} height={28} />
          ) : (
            <Building2 size={22} strokeWidth={2.25} />
          )}
          <span className="brand-text">
            <span className="brand-title">Collection Tracker</span>
            <span className="brand-tagline">Portfolio &amp; collections</span>
          </span>
        </NavLink>

        {companyLabel ? (
          <div className="company-bar">
            <span className="company-static-label">{companyLabel}</span>
          </div>
        ) : null}

        {isSuperAdmin && companies.length > 0 ? (
          <div className="navbar-workspace-company field" style={{ margin: 0, minWidth: "12rem" }}>
            <label className="sr-only" htmlFor="nav-company">
              Workspace company
            </label>
            <select
              id="nav-company"
              className="navbar-workspace-select"
              value={effectiveCompanyId ?? user?.companyId ?? ""}
              onChange={(e) => setEffectiveCompanyId(Number(e.target.value))}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="navbar-spacer" aria-hidden />

        {firebaseUser ? (
          <div className="nav-user" ref={menuRef}>
            <button
              type="button"
              className="nav-user-trigger"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-controls="nav-user-menu"
              id="nav-user-trigger"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="nav-user-trigger__avatar" aria-hidden>
                {initials}
              </span>
              <span className="nav-user-trigger__text">
                <span className="nav-user-trigger__name">{displayName}</span>
                <span className="nav-user-trigger__role">{role}</span>
              </span>
              <ChevronDown size={18} strokeWidth={2} className={menuOpen ? "nav-user-trigger__chev nav-user-trigger__chev--open" : "nav-user-trigger__chev"} aria-hidden />
            </button>

            {menuOpen ? (
              <div id="nav-user-menu" className="nav-user-dropdown" role="menu" aria-labelledby="nav-user-trigger">
                <div className="nav-user-dropdown__header">
                  <span className="nav-user-dropdown__avatar-lg" aria-hidden>
                    {initials}
                  </span>
                  <div className="nav-user-dropdown__head-text">
                    <span className="nav-user-dropdown__head-name">{displayName}</span>
                    {email ? (
                      <span className="nav-user-dropdown__head-email" title={email}>
                        {email}
                      </span>
                    ) : null}
                    <span className="nav-user-dropdown__head-role">{role} account</span>
                  </div>
                </div>

                <NavLink
                  to="/"
                  end
                  role="menuitem"
                  className={({ isActive }) => `nav-user-dropdown__item ${isActive ? "active" : ""}`}
                  onClick={closeMenu}
                >
                  <LayoutDashboard size={18} strokeWidth={2} aria-hidden />
                  Home
                </NavLink>
                {canOpenAdmin ? (
                  <NavLink
                    to="/settings"
                    role="menuitem"
                    className={({ isActive }) => `nav-user-dropdown__item ${isActive ? "active" : ""}`}
                    onClick={closeMenu}
                  >
                    <Settings size={18} strokeWidth={2} aria-hidden />
                    Settings
                  </NavLink>
                ) : null}
                {canOpenAdmin ? (
                  <NavLink
                    to="/admin"
                    role="menuitem"
                    className={({ isActive }) => `nav-user-dropdown__item ${isActive ? "active" : ""}`}
                    onClick={closeMenu}
                  >
                    <Shield size={18} strokeWidth={2} aria-hidden />
                    Admin
                  </NavLink>
                ) : null}
                <NavLink
                  to="/reminder-emails"
                  role="menuitem"
                  className={({ isActive }) => `nav-user-dropdown__item ${isActive ? "active" : ""}`}
                  onClick={closeMenu}
                >
                  <Mail size={18} strokeWidth={2} aria-hidden />
                  Email log
                </NavLink>

                <div className="nav-user-dropdown__divider" role="presentation" />

                <a
                  className="nav-user-dropdown__item"
                  role="menuitem"
                  href="mailto:support@collectease360.com?subject=CollectEase%20support"
                  onClick={closeMenu}
                >
                  <MessageCircle size={18} strokeWidth={2} aria-hidden />
                  Support
                </a>

                <div className="nav-user-dropdown__outlook">
                  <MicrosoftAccountConnect menuMode />
                </div>

                <div className="nav-user-dropdown__divider nav-user-dropdown__divider--strong" role="presentation" />

                <button
                  type="button"
                  className="nav-user-dropdown__item nav-user-dropdown__item--danger"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void logout();
                  }}
                >
                  <LogOut size={18} strokeWidth={2} aria-hidden />
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
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
            {!loadingRegions && regions.length === 0 && <span className="text-muted">No regions</span>}
          </div>
        </div>
      ) : null}
    </header>
  );
}
