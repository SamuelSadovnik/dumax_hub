import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env, isDev } from './env';
import { HttpError } from './lib/http';
import { prisma } from './lib/prisma';
import { initRealtime } from './lib/realtime';
import { ensureUploadDirs, mimeOf, readPrivate } from './lib/storage';
import { verifyFileSignature } from './lib/crypto';
import { startScheduler } from './jobs/scheduler';
import { authRoutes } from './modules/auth';
import { userRoutes } from './modules/users';
import { orgRoutes } from './modules/org';
import { recruitmentRoutes } from './modules/recruitment';
import { taskRoutes } from './modules/tasks';
import { chatRoutes } from './modules/chat';
import { pulseRoutes } from './modules/pulse';
import { feedRoutes } from './modules/feed';
import { meetingRoutes } from './modules/meetings';
import { metricsRoutes } from './modules/metrics';
import { pontoRoutes } from './modules/ponto/routes';
import { aiRoutes } from './modules/ai/routes';
import { performanceRoutes } from './modules/performance/routes';
import { timelogRoutes } from './modules/performance/timelogs';
import { goalRoutes } from './modules/performance/goals';
import { documentRoutes } from './modules/documents';
import { licenseRoutes } from './modules/licenses';
import { inboxRoutes } from './modules/inbox';
import { profileRoutes } from './modules/profiles';

const app = Fastify({
  logger: { level: isDev ? 'info' : 'warn' },
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: true,
});

await ensureUploadDirs();
await app.register(cors, { origin: env.WEB_URL, credentials: true });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
// Cabeçalhos de segurança em todas as respostas
app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  if (!isDev) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

/** Arquivos (anexos do chat) — só com link assinado e dentro da validade */
app.get('/api/files/*', async (req, reply) => {
  const key = decodeURIComponent((req.params as { '*': string })['*']);
  const { exp, sig } = req.query as { exp?: string; sig?: string };
  if (!exp || !sig || !verifyFileSignature(key, exp, sig)) return reply.status(403).send({ message: 'Link expirado ou inválido' });
  reply.type(mimeOf(key)).header('Cache-Control', 'private, max-age=3600');
  return reply.send(await readPrivate(key));
});

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return reply.status(400).send({
      message: first ? `${first.path.join('.') ? first.path.join('.') + ': ' : ''}${first.message}` : 'Dados inválidos',
      issues: err.flatten(),
    });
  }
  if (err instanceof HttpError) return reply.status(err.status).send({ message: err.message });
  if (err instanceof Prisma.PrismaClientInitializationError) {
    req.log.error(err);
    return reply.status(503).send({ message: 'A API não conseguiu conectar no banco. O Postgres está rodando? Rode: npm run db:up' });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2021' || err.code === 'P2022') {
      return reply.status(503).send({ message: 'O banco ainda não tem as tabelas. Rode: npm run setup' });
    }
    if (err.code === 'P2002') return reply.status(409).send({ message: 'Registro duplicado' });
    if (err.code === 'P2025') return reply.status(404).send({ message: 'Registro não encontrado' });
    if (err.code === 'P2003') return reply.status(400).send({ message: 'Referência inválida' });
  }
  if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ message: err.message });
  req.log.error(err);
  return reply.status(500).send({ message: 'Erro interno. Tente novamente.' });
});

app.get('/api/health', async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { ok: true, time: new Date().toISOString() };
});

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(orgRoutes, { prefix: '/api/org' });
await app.register(recruitmentRoutes, { prefix: '/api' }); // /api/public/* e /api/jobs, /api/applications
await app.register(taskRoutes, { prefix: '/api/tasks' });
await app.register(chatRoutes, { prefix: '/api/chat' });
await app.register(pulseRoutes, { prefix: '/api/pulse' });
await app.register(feedRoutes, { prefix: '/api/feed' });
await app.register(meetingRoutes, { prefix: '/api/meetings' });
await app.register(metricsRoutes, { prefix: '/api/metrics' });
await app.register(pontoRoutes, { prefix: '/api/ponto' });
await app.register(aiRoutes, { prefix: '/api/ai' });
await app.register(performanceRoutes, { prefix: '/api/performance' });
await app.register(timelogRoutes, { prefix: '/api/timelogs' });
await app.register(goalRoutes, { prefix: '/api/goals' });
await app.register(documentRoutes, { prefix: '/api' }); // /api/documents e /api/public/sign
await app.register(licenseRoutes, { prefix: '/api/licenses' });
await app.register(inboxRoutes, { prefix: '/api/inbox' });
await app.register(profileRoutes, { prefix: '/api/profiles' });

// Checagem rápida do banco na subida, com mensagem clara no terminal
try {
  const users = await prisma.user.count();
  if (users === 0) app.log.warn('⚠️  Banco sem usuários. Rode: npm run db:seed');
} catch (err) {
  const code = (err as { code?: string }).code;
  app.log.error(
    code === 'P2021'
      ? '❌ As tabelas não existem. Rode: npm run setup'
      : '❌ Não consegui conectar no Postgres. Rode: npm run db:up (Docker aberto?) e confira o DATABASE_URL em apps/api/.env',
  );
}

initRealtime(app.server);
startScheduler(app.log);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: '0.0.0.0' });
app.log.info(`🚀 Dumax Hub API em http://localhost:${env.PORT}`);
