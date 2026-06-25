require("dotenv").config();
const express = require("express");
const cors = require("cors");
const dashboardRoutes = require("./routes/dashboard.routes");
const adminRoutes = require("./routes/admin.routes");
const companiesRoutes = require("./routes/companies.routes");
const authRoutes = require("./routes/auth.routes");
const { verifyFirebaseIdToken, attachRegisteredUser } = require("./middleware/firebaseAuth");
const etlRoutes = require("./routes/etl.routes");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log("REQ:", req.method, req.originalUrl, req.url, req.headers.host);

  res.on("finish", () => {
    console.log("RES:", req.method, req.originalUrl, res.statusCode);
  });

  next();
});

/** Quick check: open http://localhost:5000/api/health — must return JSON, not HTML. */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "collection-tracker-backend" });
});

app.use("/api/auth", authRoutes);

/** Register before the broad `/api` dataflows mount so `/api/companies/.../dataflows` is not swallowed incorrectly. */
app.use("/api/companies", verifyFirebaseIdToken, attachRegisteredUser, companiesRoutes);
app.use("/api/dashboard", verifyFirebaseIdToken, attachRegisteredUser, dashboardRoutes);
app.use("/api/admin", verifyFirebaseIdToken, attachRegisteredUser, adminRoutes);

app.use("/api", verifyFirebaseIdToken, attachRegisteredUser, etlRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({
    error: `No API route for ${req.method} ${req.originalUrl}.`
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const dev =
    process.env.NODE_ENV !== "production" || process.env.API_DEBUG === "true";
  const status = Number(err?.status || err?.statusCode) || 500;
  const clientSafe =
    dev ||
    status < 500 ||
    err?.code === "DV_AUTH" ||
    err?.code === "DV_API" ||
    err?.code === "BAD_CONFIG" ||
    err?.code === "NO_ETL_KEY";
  const message =
    clientSafe && err?.message ? String(err.message) : "Internal server error";
  const httpStatus = status >= 400 && status < 600 ? status : 500;
  res.status(httpStatus).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}/api`);
  try {
    const { startEtlScheduler } = require("./services/etl/etlScheduler");
    startEtlScheduler();
  } catch (e) {
    console.error("[etl-scheduler] failed to start", e?.message || e);
  }
});
