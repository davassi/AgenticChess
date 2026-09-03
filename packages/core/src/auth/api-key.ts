import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const API_KEY_PREFIX = "ac_";

const LOOKUP_PREFIX_BYTES = 6;
const SECRET_BYTES = 32;
const API_KEY_REGEX = /^ac_([A-Za-z0-9_-]{8})([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  hash: string;
}

export type RandomBytes = (size: number) => Uint8Array;

const defaultRandom: RandomBytes = (size) => new Uint8Array(randomBytes(size));

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function generateApiKey(random: RandomBytes = defaultRandom): GeneratedApiKey {
  const prefix = toBase64Url(random(LOOKUP_PREFIX_BYTES));
  const secret = toBase64Url(random(SECRET_BYTES));
  const key = `${API_KEY_PREFIX}${prefix}${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function splitApiKey(key: string): { prefix: string; secret: string } | null {
  const match = API_KEY_REGEX.exec(key);
  if (match === null) return null;
  const [, prefix, secret] = match;
  if (prefix === undefined || secret === undefined) return null;
  return { prefix, secret };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function keysMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
