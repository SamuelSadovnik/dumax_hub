#!/usr/bin/env node
/**
 * Gera segredos fortes no apps/api/.env (cria a partir do .env.example se não existir)
 * e restringe a permissão do arquivo ao dono (chmod 600).
 *
 *   npm run secrets           → preenche só o que está vazio ou é valor de exemplo
 *   npm run secrets -- --force → gera novos JWT_SECRET (desloga todo mundo)
 *
 * Nunca troca a DATA_ENCRYPTION_KEY se ela já existir: trocar a chave torna ilegíveis
 * os dados já criptografados.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, 'apps/api/.env');
const example = join(root, 'apps/api/.env.example');
const force = process.argv.includes('--force');

if (!existsSync(envPath)) {
  copyFileSync(example, envPath);
  console.log('• apps/api/.env criado a partir do .env.example');
}
let env = readFileSync(envPath, 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.replace(/^"|"$/g, '') ?? '';
const set = (k, v) => {
  const line = `${k}="${v}"`;
  env = new RegExp(`^${k}=`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${env.trimEnd()}\n${line}\n`;
};

const jwt = get('JWT_SECRET');
if (force || !jwt || jwt.length < 32 || /troque|secret|exemplo|changeme/i.test(jwt)) {
  set('JWT_SECRET', randomBytes(48).toString('base64url'));
  console.log('• JWT_SECRET gerado');
}
if (!get('DATA_ENCRYPTION_KEY')) {
  set('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  console.log('• DATA_ENCRYPTION_KEY gerada — guarde uma cópia num cofre de senhas!');
} else console.log('• DATA_ENCRYPTION_KEY já existe (mantida)');
if (!get('PONTO_WEBHOOK_SECRET')) {
  set('PONTO_WEBHOOK_SECRET', randomBytes(24).toString('base64url'));
  console.log('• PONTO_WEBHOOK_SECRET gerado');
}

writeFileSync(envPath, env, { mode: 0o600 });
try {
  chmodSync(envPath, 0o600);
} catch {
  /* Windows */
}
console.log('✔ apps/api/.env atualizado (permissão 600). Ele está no .gitignore — nunca suba esse arquivo.');
