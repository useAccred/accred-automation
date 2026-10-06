import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { env } from "./env";

let cachedKey: Buffer | undefined;

function encryptionKey(): Buffer {
  cachedKey ??= Buffer.from(hkdfSync("sha256", env.appSecret, "accred-automation", "secrets-v1", 32));
  return cachedKey;
}

/** AES-256-GCM. Output is `v1.<iv>.<tag>.<ciphertext>`, each part base64url. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

let cachedWalletKey: Buffer | undefined;

function walletKey(): Buffer {
  cachedWalletKey ??= Buffer.from(hkdfSync("sha256", env.tradingWalletSecret ?? env.appSecret, "accred-automation", "trading-wallet-v1", 32));
  return cachedWalletKey;
}

/**
 * Encrypts a trading wallet's private key. Uses its own key, so nothing that can
 * read stored API keys or connection secrets can read a signing key, and the
 * other way round. Output is `w1.<iv>.<tag>.<ciphertext>`.
 */
export function encryptWalletKey(privateKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", walletKey(), iv);
  const data = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  return ["w1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptWalletKey(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "w1" || !iv || !tag || data === undefined) throw new Error("Unreadable wallet key");
  const decipher = createDecipheriv("aes-256-gcm", walletKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
