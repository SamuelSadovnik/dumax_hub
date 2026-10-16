import { z, type ZodTypeAny } from 'zod';

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

/**
 * Booleano vindo de query string. Não use z.coerce.boolean(): Boolean("false") é true,
 * então `?archived=false` virava `true`.
 */
export const queryBool = () =>
  z.preprocess((v) => {
    if (v === 'true' || v === '1' || v === true) return true;
    if (v === 'false' || v === '0' || v === false) return false;
    return v;
  }, z.boolean());

/** Valida com zod e lança ZodError (tratado no error handler como 400) */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}
