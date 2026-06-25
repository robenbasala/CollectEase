"use strict";

const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey() {
  const raw = process.env.ETL_ENCRYPTION_KEY || process.env.DB_PASSWORD || "";
  if (!String(raw).trim()) {
    const e = new Error("ETL_ENCRYPTION_KEY (or DB_PASSWORD fallback) is required to store Dataverse secrets.");
    e.code = "NO_ETL_KEY";
    throw e;
  }
  return crypto.createHash("sha256").update(String(raw), "utf8").digest();
}

function encrypt(plainText) {
  const text = String(plainText ?? "");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(cipherText) {
  const buf = Buffer.from(String(cipherText || ""), "base64");
  if (buf.length < IV_LEN + 16 + 1) {
    const e = new Error("Invalid encrypted secret payload");
    e.code = "BAD_CIPHER";
    throw e;
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
