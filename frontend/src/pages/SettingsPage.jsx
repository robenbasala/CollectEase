import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageIcon } from "lucide-react";
import { api } from "../api/apiClient";
import { getActiveCompanyId, getCompanyDisplayName } from "../config/company.js";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

function numToInput(v) {
  if (v == null || Number.isNaN(Number(v))) return "";
  return String(v);
}

function SettingsAlertCard({ idPrefix, title, description, amount, day, months, onAmount, onDay, onMonths }) {
  return (
    <section className="settings-panel-card settings-card-tall">
      <h2 className="settings-panel-title">{title}</h2>
      <p className="settings-panel-desc">{description}</p>
      <div className="settings-field-group">
        <div className="field">
          <label htmlFor={`${idPrefix}-amt`}>More than $ (Amount Threshold)</label>
          <input
            id={`${idPrefix}-amt`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-day`}>After day of the month</label>
          <input
            id={`${idPrefix}-day`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={day}
            onChange={(e) => onDay(e.target.value)}
          />
        </div>
      </div>
      <div className="settings-or-wrap" role="separator" aria-label="Or">
        <span className="settings-or-badge">Or</span>
      </div>
      <div className="settings-field-group">
        <div className="field">
          <label htmlFor={`${idPrefix}-mo`}>Owe # of months (always)</label>
          <input
            id={`${idPrefix}-mo`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={months}
            onChange={(e) => onMonths(e.target.value)}
          />
        </div>
      </div>
    </section>
  );
}

function buildPayload(s) {
  return {
    followupAmount: s.followupAmount.trim() === "" ? null : s.followupAmount.trim(),
    followupDays: s.followupDays.trim() === "" ? null : s.followupDays.trim(),
    followupMonths: s.followupMonths.trim() === "" ? null : s.followupMonths.trim(),
    legalAlertAmount: s.legalAlertAmount.trim() === "" ? null : s.legalAlertAmount.trim(),
    legalAlertDays: s.legalAlertDays.trim() === "" ? null : s.legalAlertDays.trim(),
    legalAlertMonths: s.legalAlertMonths.trim() === "" ? null : s.legalAlertMonths.trim(),
    erpStaticLink: s.erpStaticLink.trim() === "" ? null : s.erpStaticLink.trim(),
    defaultLegalStatusList: s.defaultLegalStatusList.trim() === "" ? null : s.defaultLegalStatusList.trim(),
    logoDataUrl: s.logoDataUrl,
    companyDisplayName: s.companyDisplayName.trim() === "" ? null : s.companyDisplayName.trim()
  };
}

export default function SettingsPage() {
  const companyId = getActiveCompanyId();
  const envCompanyName = getCompanyDisplayName();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [listNames, setListNames] = useState([]);

  const [followupAmount, setFollowupAmount] = useState("");
  const [followupDays, setFollowupDays] = useState("");
  const [followupMonths, setFollowupMonths] = useState("");
  const [legalAlertAmount, setLegalAlertAmount] = useState("");
  const [legalAlertDays, setLegalAlertDays] = useState("");
  const [legalAlertMonths, setLegalAlertMonths] = useState("");
  const [erpStaticLink, setErpStaticLink] = useState("");
  const [defaultLegalStatusList, setDefaultLegalStatusList] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const [companyDisplayName, setCompanyDisplayName] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [data, lists] = await Promise.all([
          api.getAdminCompanySettings(),
          api.getAdminPropertyListNames()
        ]);
        const s = data.settings || {};
        const names = lists.listNames || [];
        if (!cancelled) {
          setListNames(names);
          setFollowupAmount(numToInput(s.followupAmount));
          setFollowupDays(numToInput(s.followupDays));
          setFollowupMonths(numToInput(s.followupMonths));
          setLegalAlertAmount(numToInput(s.legalAlertAmount));
          setLegalAlertDays(numToInput(s.legalAlertDays));
          setLegalAlertMonths(numToInput(s.legalAlertMonths));
          setErpStaticLink(s.erpStaticLink ?? s.ErpStaticLink ?? "");
          setDefaultLegalStatusList(s.defaultLegalStatusList ?? "");
          setLogoDataUrl(s.logoDataUrl ?? null);
          setCompanyDisplayName(s.companyDisplayName ?? envCompanyName ?? "");
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [envCompanyName]);

  const legalListOptions = useMemo(() => {
    const set = new Set(listNames);
    if (defaultLegalStatusList && defaultLegalStatusList.trim()) {
      set.add(defaultLegalStatusList.trim());
    }
    return Array.from(set);
  }, [listNames, defaultLegalStatusList]);

  const onLogoFile = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 320 * 1024) {
      setError("Logo file must be 320 KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : null;
      setLogoDataUrl(url);
      setError("");
    };
    reader.readAsDataURL(file);
  }, []);

  const clearLogo = useCallback(() => setLogoDataUrl(null), []);

  const save = useCallback(async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const body = buildPayload({
        followupAmount,
        followupDays,
        followupMonths,
        legalAlertAmount,
        legalAlertDays,
        legalAlertMonths,
        erpStaticLink,
        defaultLegalStatusList,
        logoDataUrl,
        companyDisplayName
      });
      const data = await api.putAdminCompanySettings(body);
      const saved = data.settings;
      window.dispatchEvent(new CustomEvent("ct:company-settings-updated", { detail: saved }));
      setSuccess("Saved.");
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    followupAmount,
    followupDays,
    followupMonths,
    legalAlertAmount,
    legalAlertDays,
    legalAlertMonths,
    erpStaticLink,
    defaultLegalStatusList,
    logoDataUrl,
    companyDisplayName
  ]);

  return (
    <div className="settings-screen-root">
      <div className="settings-main">
        <PageHeader title="Settings" backTo="/" />

        {loading && <Spinner />}
        {error && (
          <div
            className="settings-panel-card"
            style={{ marginBottom: "1rem", color: "var(--color-danger)", fontSize: "0.9rem" }}
          >
            {error}
          </div>
        )}
        {success && !error && (
          <div
            className="settings-panel-card"
            style={{ marginBottom: "1rem", color: "var(--color-success)", fontSize: "0.9rem" }}
          >
            {success}
          </div>
        )}

        {!loading && (
          <>
            <div className="settings-grid">
              <SettingsAlertCard
                idPrefix="followup"
                title="Follow Up Alerts"
                description="Configure when to send follow-up alerts for outstanding amounts"
                amount={followupAmount}
                day={followupDays}
                months={followupMonths}
                onAmount={setFollowupAmount}
                onDay={setFollowupDays}
                onMonths={setFollowupMonths}
              />

              <SettingsAlertCard
                idPrefix="legal"
                title="Legal Alerts"
                description="Configure when to send legal alerts and escalation parameters"
                amount={legalAlertAmount}
                day={legalAlertDays}
                months={legalAlertMonths}
                onAmount={setLegalAlertAmount}
                onDay={setLegalAlertDays}
                onMonths={setLegalAlertMonths}
              />

              <section className="settings-panel-card settings-card-tall">
                <h2 className="settings-panel-title">Settings</h2>
                <p className="settings-panel-desc">
                  Configure static part of your ERP link and legal status list
                </p>
                <div className="settings-field-group">
                  <div className="field">
                    <label htmlFor="erp-link">Static part of the Link</label>
                    <input
                      id="erp-link"
                      type="url"
                      placeholder="https://www.yardiasp1..."
                      autoComplete="off"
                      value={erpStaticLink}
                      onChange={(e) => setErpStaticLink(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="legal-list">Default Legal Status List</label>
                    <select
                      id="legal-list"
                      value={defaultLegalStatusList}
                      onChange={(e) => setDefaultLegalStatusList(e.target.value)}
                    >
                      <option value="">— Select —</option>
                      {legalListOptions.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="settings-panel-card settings-slot-logo">
                <div className="settings-field-group">
                  <div className="field">
                    <label>Logo</label>
                    <div className="settings-logo-preview">
                      {logoDataUrl ? (
                        <img src={logoDataUrl} alt="" />
                      ) : (
                        <ImageIcon size={40} strokeWidth={1.25} aria-hidden />
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <label className="btn btn-primary" style={{ cursor: "pointer", margin: 0 }}>
                        <input type="file" accept="image/*" className="sr-only" onChange={onLogoFile} />
                        Upload
                      </label>
                      {logoDataUrl ? (
                        <button type="button" className="btn btn-ghost" onClick={clearLogo}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="co-name">Company Name</label>
                    <input
                      id="co-name"
                      type="text"
                      autoComplete="organization"
                      value={companyDisplayName}
                      onChange={(e) => setCompanyDisplayName(e.target.value)}
                      placeholder="Montium"
                    />
                    <p className="settings-company-id-hint">
                      Company ID <strong>{companyId}</strong> — name and logo appear in the main navigation after save.
                    </p>
                  </div>
                </div>
              </section>
            </div>

            <div className="settings-save-bar">
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
