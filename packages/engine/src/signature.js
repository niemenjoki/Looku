import crypto from "node:crypto";

export const SIGNATURE_HEADER = "x-looku-signature";
export const SITE_HEADER = "x-looku-site";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

// Header format: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>".
export function signBody(key, body, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = crypto
    .createHmac("sha256", key)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

// Only the exact canonical header is accepted, so one signature has one
// spelling and the replay guard cannot be bypassed by rewriting it.
const HEADER_PATTERN = /^t=([1-9]\d{0,11}),v1=([0-9a-f]{64})$/;

export function verifySignature(key, body, header, now = Date.now()) {
  const match = HEADER_PATTERN.exec(String(header || ""));
  if (!match) {
    return false;
  }
  const timestamp = Number(match[1]);
  const parts = { v1: match[2] };
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${timestamp}.${body}`)
    .digest();
  return crypto.timingSafeEqual(expected, Buffer.from(parts.v1, "hex"));
}

export function generateSigningKey() {
  return crypto.randomBytes(32).toString("base64url");
}
