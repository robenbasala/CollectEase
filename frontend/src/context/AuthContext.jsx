import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "../auth/firebase.js";
import { registerAuthSession } from "../auth/session.js";
import { api } from "../api/apiClient.js";

const AuthContext = createContext(null);

function readStoredEffectiveCompanyId() {
  try {
    const s = sessionStorage.getItem("ct-effective-company-id");
    if (s == null || s === "") return null;
    const n = Number(s);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [apiUser, setApiUser] = useState(null);
  const [effectiveCompanyId, setEffectiveCompanyIdState] = useState(() => readStoredEffectiveCompanyId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshMe = useCallback(async () => {
    if (!firebaseUser) {
      setApiUser(null);
      return;
    }
    try {
      const data = await api.getAuthMe();
      setApiUser(data.user || null);
      setError("");
    } catch (e) {
      const msg = e.message || "Failed to load profile";
      const extra = e.details ? `\n\n${e.details}` : "";
      setApiUser(null);
      if (e.code === "NEEDS_INVITATION" || /No active invitation/i.test(msg)) {
        setError("no_invite");
      } else {
        setError(msg + extra);
      }
    }
  }, [firebaseUser]);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      setError("Firebase is not configured (VITE_FIREBASE_* in .env).");
      return;
    }
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setFirebaseUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (!apiUser) return;
    if (apiUser.role === "super_admin") {
      const stored = readStoredEffectiveCompanyId();
      if (stored != null) {
        setEffectiveCompanyIdState(stored);
        return;
      }
      const fallback = apiUser.companyId;
      if (fallback != null) {
        sessionStorage.setItem("ct-effective-company-id", String(fallback));
        setEffectiveCompanyIdState(fallback);
      }
    } else {
      sessionStorage.removeItem("ct-effective-company-id");
      setEffectiveCompanyIdState(null);
    }
  }, [apiUser]);

  const setEffectiveCompanyId = useCallback((id) => {
    if (id == null) {
      sessionStorage.removeItem("ct-effective-company-id");
      setEffectiveCompanyIdState(null);
      return;
    }
    sessionStorage.setItem("ct-effective-company-id", String(id));
    setEffectiveCompanyIdState(id);
  }, []);

  const getIdToken = useCallback(async () => {
    if (!firebaseUser) return null;
    return firebaseUser.getIdToken(true);
  }, [firebaseUser]);

  const getApiCompanyId = useCallback(() => {
    if (!apiUser) {
      const env = import.meta.env.VITE_DEFAULT_COMPANY_ID;
      if (env != null && String(env).trim() !== "") {
        const n = Number(String(env).trim());
        if (Number.isInteger(n) && n > 0) return n;
      }
      return null;
    }
    if (apiUser.role === "super_admin") {
      return effectiveCompanyId ?? apiUser.companyId ?? null;
    }
    return apiUser.companyId ?? null;
  }, [apiUser, effectiveCompanyId]);

  // Must run during render, not in useEffect: child effects run before parent effects, so API calls
  // could fire before registerAuthSession and miss the Bearer token.
  registerAuthSession({ getIdToken, getApiCompanyId });

  const logout = useCallback(async () => {
    if (!isFirebaseConfigured()) return;
    const auth = getFirebaseAuth();
    await signOut(auth);
    setApiUser(null);
    sessionStorage.removeItem("ct-effective-company-id");
    setEffectiveCompanyIdState(null);
  }, []);

  const value = useMemo(
    () => ({
      firebaseConfigured: isFirebaseConfigured(),
      loading,
      error,
      firebaseUser,
      user: apiUser,
      effectiveCompanyId,
      setEffectiveCompanyId,
      refreshMe,
      logout,
      isSuperAdmin: apiUser?.role === "super_admin",
      isCompanyAdmin: apiUser?.role === "company_admin" || apiUser?.role === "super_admin",
      canOpenAdmin: apiUser?.role === "company_admin" || apiUser?.role === "super_admin"
    }),
    [loading, error, firebaseUser, apiUser, effectiveCompanyId, setEffectiveCompanyId, refreshMe, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
