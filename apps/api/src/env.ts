import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET precisa ter pelo menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'),
  TZ: z.string().default('America/Sao_Paulo'),

  PULSE_CRON: z.string().default('0 9 * * 5'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Dumax Hub <nao-responda@dumax.com.br>'),

  // Ponto eletrônico
  PONTO_PROVIDER: z.enum(['mock', 'http']).default('mock'),
  PONTO_API_URL: z.string().optional(),
  PONTO_API_TOKEN: z.string().optional(),
  PONTO_WEBHOOK_SECRET: z.string().optional(),
  PONTO_SYNC_CRON: z.string().default('*/15 * * * *'),

  // Criptografia de dados sensíveis (32 bytes em base64). Gere com: npm run secrets
  DATA_ENCRYPTION_KEY: z.string().optional(),

  // Assistente IA
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Em produção, recusa subir com segredos fracos ou de exemplo
if (env.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (env.JWT_SECRET.length < 32 || /troque|secret|exemplo|changeme/i.test(env.JWT_SECRET)) problems.push('JWT_SECRET fraco ou de exemplo');
  if (!env.DATA_ENCRYPTION_KEY) problems.push('DATA_ENCRYPTION_KEY ausente');
  if (/dumax:dumax@/.test(env.DATABASE_URL)) problems.push('senha padrão do banco no DATABASE_URL');
  if (problems.length) {
    console.error(`❌ Configuração insegura para produção: ${problems.join('; ')}. Rode "npm run secrets" e revise o .env.`);
    process.exit(1);
  }
}
export const isDev = env.NODE_ENV === 'development';
