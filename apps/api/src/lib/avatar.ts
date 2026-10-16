import type { FastifyRequest } from 'fastify';
import { badRequest } from './http';
import { saveUpload } from './storage';
import { avatarUrlFor } from './crypto';

/** Lê a imagem enviada (campo "file") e devolve o avatarUrl assinado */
export async function saveAvatar(req: FastifyRequest) {
  if (!req.isMultipart()) throw badRequest('Envie uma imagem');
  const file = await req.file();
  if (!file) throw badRequest('Envie uma imagem');
  const saved = await saveUpload(file, { folder: 'avatars', allowedExt: ['.jpg', '.jpeg', '.png', '.webp'] });
  return avatarUrlFor(saved.key);
}
