require("dotenv").config();
const express = require("express");
const cors = require("cors");
const dashboardRoutes = require("./routes/dashboard.routes");
const adminRoutes = require("./routes/admin.routes");
const companiesRoutes = require("./routes/companies.routes");
const authRoutes = require("./routes/auth.routes");
const { verifyFirebaseIdToken, attachRegisteredUser } = require("./middleware/firebaseAuth");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json());

/** Quick check: open http://localhost:5000/api/health — must return JSON, not HTML. */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "collection-tracker-backend" });
});

app.use("/api/auth", authRoutes);

app.use("/api/companies", verifyFirebaseIdToken, attachRegisteredUser, companiesRoutes);
app.use("/api/dashboard", verifyFirebaseIdToken, attachRegisteredUser, dashboardRoutes);
app.use("/api/admin", verifyFirebaseIdToken, attachRegisteredUser, adminRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({
    error: `No API route for ${req.method} ${req.originalUrl}. If you just pulled new code, restart the backend (npm run dev in backend).`
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const dev =
    process.env.NODE_ENV !== "production" || process.env.API_DEBUG === "true";
  const message = dev && err?.message ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}/api`);
});
