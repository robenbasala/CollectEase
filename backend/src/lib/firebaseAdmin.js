const fs = require("fs");
const path = require("path");
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

let initError = null;

function readServiceAccountFromFile(filePath) {
  const trimmed = String(filePath || "").trim();
  if (!trimmed) return null;
  const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Service account file not found: ${resolved}. Save the JSON key from Firebase Console → Project settings → Service accounts → Generate new private key (see backend/secrets/FIREBASE_SERVICE_ACCOUNT_INSTRUCTIONS.txt).`
    );
  }
  const raw = fs.readFileSync(resolved, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in service account file: ${resolved}`);
  }
}

function getServiceAccountFromEnv() {
  const pathFromEnv =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (pathFromEnv && String(pathFromEnv).trim()) {
    return readServiceAccountFromFile(pathFromEnv);
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && String(raw).trim()) {
    let s = String(raw).trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    try {
      return JSON.parse(s);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.");
    }
  }

  throw new Error(
    "Set FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json (recommended) or paste FIREBASE_SERVICE_ACCOUNT_JSON in backend/.env. Firebase Console → Project settings → Service accounts. See backend/.env.example and backend/secrets/FIREBASE_SERVICE_ACCOUNT_INSTRUCTIONS.txt."
  );
}

function ensureFirebaseApp() {
  if (initError) throw initError;
  if (getApps().length > 0) return;
  try {
    const sa = getServiceAccountFromEnv();
    initializeApp({
      credential: cert(sa)
    });
  } catch (e) {
    initError = e;
    throw e;
  }
}

function getFirebaseAuth() {
  ensureFirebaseApp();
  return getAuth();
}

module.exports = { ensureFirebaseApp, getFirebaseAuth };
