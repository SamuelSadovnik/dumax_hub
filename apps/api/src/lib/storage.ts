import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import { env } from '../env';
import { HttpError, badRequest, notFound } from './http';
import { decryptBuffer, encryptBuffer } from './crypto';

/**
 * Armazenamento local, sempre criptografado (AES-256-GCM).
 * Nada é servido estaticamente: arquivos saem só por rotas autenticadas
 * ou por link assinado e temporário (anexos do chat).
 * Para produção em nuvem, troque por S3/R2/GCS mantendo esta interface.
 */
export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);
export const PRIVATE_DIR = path.join(UPLOAD_ROOT, 'private');
const MAX_BYTES = 10 * 1024 * 1024;

export interface SavedFile {
  key: string;
  name: string;
  mime: string;
  size: number;
  /** SHA-256 do conteúdo original (antes da criptografia) */
  sha256: string;
}

export async function saveUpload(file: MultipartFile, opts: { folder: string; allowedExt?: string[] }): Promise<SavedFile> {
  const ext = path.extname(file.filename).toLowerCase().slice(0, 10);
  if (opts.allowedExt && !opts.allowedExt.includes(ext)) {
    file.file.resume();
    throw badRequest(`Formato não permitido. Use: ${opts.allowedExt.join(', ')}`);
  }
  const buf = await file.toBuffer().catch(() => {
    throw new HttpError(413, 'Arquivo muito grande (máx. 10 MB)');
  });
  if (file.file.truncated || buf.length > MAX_BYTES) throw new HttpError(413, 'Arquivo muito grande (máx. 10 MB)');

  const key = `${opts.folder}/${randomUUID()}${ext}`;
  const full = privatePath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, encryptBuffer(buf), { mode: 0o600 });
  return { key, name: file.filename, mime: file.mimetype, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

export function privatePath(key: string) {
  const full = path.resolve(PRIVATE_DIR, key);
  if (!full.startsWith(PRIVATE_DIR + path.sep)) throw badRequest('Caminho inválido');
  return full;
}

/** Lê e descriptografa um arquivo guardado */
export async function readPrivate(key: string): Promise<Buffer> {
  try {
    return decryptBuffer(await fs.readFile(privatePath(key)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('Arquivo não encontrado');
    throw err;
  }
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
};
export const mimeOf = (key: string) => MIME[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export async function ensureUploadDirs() {
  await fs.mkdir(PRIVATE_DIR, { recursive: true, mode: 0o700 });
}
