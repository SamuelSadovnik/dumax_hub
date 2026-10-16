import type { ZodTypeAny, z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg = 'Requisição inválida') => new HttpError(400, msg);
export const unauthorized = (msg = 'Não autenticado') => new HttpError(401, msg);
export const forbidden = (msg = 'Você não tem permissão para isso') => new HttpError(403, msg);
export const notFound = (msg = 'Não encontrado') => new HttpError(404, msg);
export const conflict = (msg = 'Registro já existe') => new HttpError(409, msg);

/** Valida com zod e lança ZodError (tratado no error handler como 400) */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}
