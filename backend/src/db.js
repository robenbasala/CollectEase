const sql = require("mssql");
require("dotenv").config();

function stripQuotes(v) {
  if (v == null) return v;
  const s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parses DB_SERVER / optional DB_PORT into host, port, instanceName.
 * Avoids ENOTFOUND when users write "ip , 1433" or mix comma-port with \INSTANCE wrongly.
 */
function parseSqlConnection(rawServer, rawPortEnv) {
  let s = stripQuotes(rawServer);
  if (!s) {
    throw new Error("DB_SERVER is missing");
  }
  s = s.replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();

  let instanceName;
  const bs = s.lastIndexOf("\\");
  if (bs !== -1) {
    instanceName = s.slice(bs + 1).trim();
    s = s.slice(0, bs).trim();
  }

  let host = s;
  let port;

  const comma = s.indexOf(",");
  if (comma !== -1) {
    host = s.slice(0, comma).trim();
    const rest = s.slice(comma + 1).trim();
    if (/^\d+$/.test(rest)) {
      port = Number(rest);
    }
  }

  if (rawPortEnv !== undefined && rawPortEnv !== null && String(rawPortEnv).trim() !== "") {
    const p = Number(String(rawPortEnv).trim());
    if (!Number.isNaN(p) && p > 0) {
      port = p;
    }
  }

  // Connecting by explicit TCP port: do not also send instance name (avoids driver confusion).
  if (port && instanceName) {
    instanceName = undefined;
  }

  return { host, port, instanceName };
}

const { host, port, instanceName } = parseSqlConnection(
  process.env.DB_SERVER,
  process.env.DB_PORT
);

function numEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const connectTimeout = numEnv("DB_CONNECTION_TIMEOUT_MS", 30000);
const requestTimeout = numEnv("DB_REQUEST_TIMEOUT_MS", 30000);

function parseBool(raw, defaultVal) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return defaultVal;
  const s = String(stripQuotes(raw)).toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return defaultVal;
}

const trustEnv =
  process.env.DB_TRUST_SERVER_CERTIFICATE ?? process.env.DB_TRUST_SERVER_CERT;

const config = {
  server: host,
  ...(port ? { port } : {}),
  database: stripQuotes(process.env.DB_DATABASE),
  user: stripQuotes(process.env.DB_USER),
  password: stripQuotes(process.env.DB_PASSWORD),
  options: {
    encrypt: parseBool(process.env.DB_ENCRYPT, true),
    trustServerCertificate: parseBool(trustEnv, true),
    connectTimeout,
    requestTimeout,
    ...(instanceName ? { instanceName } : {})
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config).catch((err) => {
      poolPromise = undefined;
      throw err;
    });
  }
  return poolPromise;
}

async function query(text, inputs) {
  const pool = await getPool();
  const request = pool.request();
  if (inputs && typeof inputs === "object") {
    for (const [key, { type, value }] of Object.entries(inputs)) {
      request.input(key, type, value);
    }
  }
  return request.query(text);
}

module.exports = { sql, getPool, query };
