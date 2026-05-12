import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/apiClient";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import PortfolioSummaryCard from "../components/PortfolioSummaryCard";

export default function Dashboard() {
  const { selectedRegion } = useOutletContext();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedRegion) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getDashboardSummary(selectedRegion);
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load summary");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRegion]);

  if (!selectedRegion) {
    return (
      <div className="page">
        <PageHeader
          title="Dashboard"
          subtitle="Select a region in the navbar to load portfolios and properties."
          showBack={false}
        />
        <div className="empty-state card" style={{ padding: "2rem" }}>
          Choose a region above to see collection performance by portfolio.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Dashboard" showBack={false} />

      {loading && <Spinner />}
      {error && (
        <div className="card" style={{ padding: "1rem", color: "var(--color-danger)" }}>
          {error}
        </div>
      )}

      {!loading && !error && summary && (
        <div className="grid-portfolios">
          {summary.portfolios.length === 0 && (
            <div className="empty-state card" style={{ padding: "2rem" }}>
              No portfolio data for this region.
            </div>
          )}
          {summary.portfolios.map((p) => (
            <PortfolioSummaryCard key={p.name} region={selectedRegion} portfolio={p} />
          ))}
        </div>
      )}
    </div>
  );
}
