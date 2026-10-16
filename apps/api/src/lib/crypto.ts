import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

/**
 * Criptografia em repouso (AES-256-GCM).
 *
 * - Textos sensíveis viram "enc:v1:<base64(iv|tag|cifrado)>" no banco.
 * - Arquivos são gravados como "DMXE1" + iv + tag + cifrado.
 * - Valores antigos sem prefixo são lidos como estão (compatibilidade).
 *
 * A chave vem de DATA_ENCRYPTION_KEY (32 bytes em base64 — gere com `npm run secrets`).
 * ⚠️ Perder a chave = perder os dados criptografados. Guarde-a num cofre (1Password, Bitwarden, AWS Secrets Manager).
 */

function loadKey(): Buffer {
  if (env.DATA_ENCRYPTION_KEY) {
    const k = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
    if (k.length !== 32) throw new Error('DATA_ENCRYPTION_KEY precisa ter 32 bytes em base64 (rode: npm run secrets)');
    return k;
  }
  // só em desenvolvimento: deriva do JWT_SECRET para o projeto rodar sem configuração extra
  return createHash('sha256').update(`dumax-dev-key:${env.JWT_SECRET}`).digest();
}

const KEY = loadKey();
const PREFIX = 'enc:v1:';
const FILE_MAGIC = Buffer.from('DMXE1');

export function encryptText(plain: string): string;
export function encryptText(plain: string | null | undefined): string | null;
export function encryptText(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return plain ?? null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decryptText(value: string): string;
export function decryptText(value: string | null | undefined): string | null;
export function decryptText(value: string | null | undefined): string | null {
  if (!value || !value.startsWith(PREFIX)) return value ?? null;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '[conteúdo protegido — chave de criptografia diferente]';
  }
}

export function encryptBuffer(buf: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([FILE_MAGIC, iv, c.getAuthTag(), ct]);
}

export function decryptBuffer(buf: Buffer): Buffer {
  if (!buf.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) return buf;
  const o = FILE_MAGIC.length;
  const d = createDecipheriv('aes-256-gcm', KEY, buf.subarray(o, o + 12));
  d.setAuthTag(buf.subarray(o + 12, o + 28));
  return Buffer.concat([d.update(buf.subarray(o + 28)), d.final()]);
}

// ───────────── Links assinados (arquivos do chat etc.) ─────────────
const signKey = createHash('sha256').update(`dumax-url:${env.JWT_SECRET}`).digest();

/** Gera "/api/files/<key>?exp=...&sig=..." válido por `ttlSeconds` */
export function signedFileUrl(key: string, ttlSeconds = 24 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac('sha256', signKey).update(`${key}:${exp}`).digest('base64url');
  return `/api/files/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(key: string, exp: string, sig: string) {
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  const expected = createHmac('sha256', signKey).update(`${key}:${exp}`).digest();
  const given = Buffer.from(sig, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
