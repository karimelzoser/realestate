import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptContactValue(plaintext: string, encodedKey: string): Buffer {
  const key = decodeAesKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, ciphertext]);
}

export function decryptContactValue(envelope: Uint8Array, encodedKey: string): string {
  const value = Buffer.from(envelope);
  if (value.length < 1 + IV_BYTES + TAG_BYTES || value[0] !== ENVELOPE_VERSION) {
    throw new Error('Unsupported encrypted contact envelope.');
  }
  const key = decodeAesKey(encodedKey);
  const iv = value.subarray(1, 1 + IV_BYTES);
  const tag = value.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = value.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function hmacSha256(value: string, secret: string): Buffer {
  if (secret.length < 32) throw new Error('HMAC secret must contain at least 32 characters.');
  return createHmac('sha256', secret).update(value, 'utf8').digest();
}

export function secureDigestMatches(left: Uint8Array, right: Uint8Array): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function phoneDisplayHint(e164: string): string {
  const visible = e164.slice(-4);
  const country = e164.startsWith('+') ? e164.slice(0, Math.min(4, e164.length - 4)) : '';
  return `${country} •••••• ${visible}`.trim();
}

function decodeAesKey(encodedKey: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(encodedKey, 'base64');
  } catch {
    throw new Error('CONTACT_ENCRYPTION_KEY_BASE64 must be valid base64.');
  }
  if (key.length !== 32) {
    throw new Error('CONTACT_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes.');
  }
  return key;
}
