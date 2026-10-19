import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ROLE_LABEL } from '@dumax/shared';
import { prisma } from '../../lib/prisma';
import { authenticate, type AuthUser } from '../../lib/auth';
import { HttpError, notFound, parse } from '../../lib/http';
import { brDateKey, brTime } from '../../lib/dates';
import { isDev } from '../../env';
import { LlmError, chat, llmEnabled, llmMissingKeyHint, llmModel, llmProvider, type Block, type Message } from '../../lib/llm';
import { TOOL_DEFS, runTool } from './tools';

type MessageParam = Message;
type ContentBlockParam = Block;

const MAX_TOOL_ROUNDS = 8;
const HISTORY_LIMIT = 30;

function systemPrompt(user: AuthUser, extra: { department?: string | null; jobTitle?: string | null }) {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(now);
  const scope =
    user.role === 'ADMIN' || user.role === 'HR'
      ? 'Este usuário é RH/admin e pode ver dados de toda a empresa.'
      : user.role === 'MANAGER'
        ? 'Este usuário é GESTOR: pode ver os próprios dados e os de toda a equipe abaixo dele na hierarquia. Não pode ver outras áreas.'
        : 'Este usuário é COLABORADOR: só pode ver os próprios dados de ponto, demandas e agenda (o diretório de pessoas é público).';

  return `Você é o Assistente do Dumax Hub, o hub interno da empresa Dumax. Responda sempre em português do Brasil, de forma direta, simpática e curta.

Agora: ${weekday}, ${brDateKey(now)} às ${brTime(now)} (horário de Brasília, America/Sao_Paulo).
Usuário: ${user.name} (${ROLE_LABEL[user.role]}${extra.jobTitle ? `, ${extra.jobTitle}` : ''}${extra.department ? `, área ${extra.department}` : ''}). ID: ${user.id}.
Permissões: ${scope} As ferramentas já aplicam essas regras; se uma ferramenta negar acesso, explique com educação.

Regras:
- Use as ferramentas para qualquer dado da empresa. Nunca invente números, nomes ou horários.
- Para falar de uma pessoa pelo nome, chame buscar_pessoas antes para obter o id. Se houver mais de uma pessoa com o mesmo nome, pergunte qual.
- Interprete datas relativas ("hoje", "amanhã às 10", "sexta") a partir de agora, no fuso de Brasília, e envie horários em ISO 8601 com -03:00.
- Ações (criar demanda, agendar reunião, enviar mensagem) só quando o usuário pedir. Se faltar algo essencial (ex.: com quem é a reunião), faça no máximo uma pergunta; se não for essencial, use um padrão razoável (reunião de 30 min, título descritivo) e diga o que assumiu.
- "Me" / "pra mim" = o próprio usuário. Uma reunião "pra mim" sem participantes é só na agenda dele.
- Se agendar_reuniao retornar conflitos, avise.
- Ao listar pessoas ou números, use listas curtas ou tabelas em markdown. Inclua links relativos do Hub quando úteis (ex.: [abrir demanda](/demandas?task=...)).
- Dados de clima (pulse) são anônimos: nunca tente descobrir a nota de uma pessoa específica.`;
}

/** Corta o histórico mantendo pares tool_use/tool_result íntegros */
function trimHistory(messages: MessageParam[]): MessageParam[] {
  if (messages.length <= HISTORY_LIMIT) return messages;
  let start = messages.length - HISTORY_LIMIT;
  while (start < messages.length) {
    const m = messages[start];
    const isPlainUser =
      m.role === 'user' && (typeof m.content === 'string' || m.content.every((b: Block) => b.type === 'text'));
    if (isPlainUser) break;
    start++;
  }
  return messages.slice(start);
}

/** Converte o histórico salvo em formato exibível (texto + ferramentas usadas) */
function toDisplay(rows: { id: string; role: string; content: Prisma.JsonValue; createdAt: Date }[]) {
  const out: { id: string; role: 'user' | 'assistant'; text: string; tools: string[]; createdAt: Date }[] = [];
  for (const r of rows) {
    const blocks = r.content as unknown as ContentBlockParam[];
    if (r.role === 'user') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      if (text) out.push({ id: r.id, role: 'user', text, tools: [], createdAt: r.createdAt });
      continue;
    }
    const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
    const tools = blocks.filter((b) => b.type === 'tool_use').map((b) => (b as { name: string }).name);
    const last = out[out.length - 1];
    // junta as voltas de ferramenta numa única "bolha" do assistente
    if (last && last.role === 'assistant') {
      last.text = [last.text, text].filter(Boolean).join('\n\n');
      last.tools.push(...tools);
    } else out.push({ id: r.id, role: 'assistant', text, tools, createdAt: r.createdAt });
  }
  return out;
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/status', async () => ({ enabled: llmEnabled(), provider: llmProvider, model: llmModel }));

  app.get('/threads', async (req) =>
    prisma.aiThread.findMany({ where: { userId: req.auth.id }, orderBy: { updatedAt: 'desc' }, take: 50 }),
  );

  app.get('/threads/:id', async (req) => {
    const { id } = req.params as { id: string };
    const thread = await prisma.aiThread.findFirst({ where: { id, userId: req.auth.id } });
    if (!thread) throw notFound();
    const rows = await prisma.aiMessage.findMany({ where: { threadId: id }, orderBy: { createdAt: 'asc' } });
    return { thread, messages: toDisplay(rows) };
  });

  app.delete('/threads/:id', async (req) => {
    const { id } = req.params as { id: string };
    await prisma.aiThread.deleteMany({ where: { id, userId: req.auth.id } });
    return { ok: true };
  });

  /** Envia uma pergunta. Sem threadId, cria uma conversa nova. */
  app.post('/ask', async (req) => {
    if (!llmEnabled()) throw new HttpError(503, `Assistente desativado: ${llmMissingKeyHint()}.`);
    const body = parse(z.object({ threadId: z.string().nullish(), text: z.string().trim().min(1).max(4000) }), req.body);
    const user = req.auth;

    const thread = body.threadId
      ? await prisma.aiThread.findFirst({ where: { id: body.threadId, userId: user.id } })
      : await prisma.aiThread.create({ data: { userId: user.id, title: body.text.slice(0, 60) } });
    if (!thread) throw notFound('Conversa não encontrada');

    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { jobTitle: true, department: { select: { name: true } } },
    });

    const history = await prisma.aiMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: 'asc' } });
    const messages: MessageParam[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as unknown as ContentBlockParam[],
    }));

    const save = async (role: 'user' | 'assistant', content: ContentBlockParam[]) => {
      messages.push({ role, content });
      return prisma.aiMessage.create({
        data: { threadId: thread.id, role, content: content as unknown as Prisma.InputJsonValue },
      });
    };

    const firstNew = await save('user', [{ type: 'text', text: body.text }]);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let response: Awaited<ReturnType<typeof chat>>;
      try {
        response = await chat({
          system: systemPrompt(user, { jobTitle: profile.jobTitle, department: profile.department?.name }),
          tools: TOOL_DEFS,
          messages: trimHistory(messages),
          maxTokens: 2048,
        });
      } catch (err) {
        req.log.error(err, `Falha na IA (${llmProvider})`);
        // não deixa conversa "fantasma" no histórico: desfaz o que esta pergunta gravou
        if (!body.threadId) await prisma.aiThread.delete({ where: { id: thread.id } }).catch(() => undefined);
        else await prisma.aiMessage.deleteMany({ where: { threadId: thread.id, createdAt: { gte: firstNew.createdAt } } });
        if (err instanceof LlmError && err.status === 429)
          throw new HttpError(429, 'A IA atingiu o limite de uso por agora (no plano grátis isso acontece rápido). Tente de novo em alguns minutos.');
        if (err instanceof LlmError && (err.status === 503 || err.status === 500 || err.status === 529))
          throw new HttpError(503, 'A IA está sobrecarregada neste momento. Tente de novo em um minuto.');
        if (err instanceof LlmError && (err.status === 401 || err.status === 403 || (err.status === 400 && /api key/i.test(err.message))))
          throw new HttpError(502, 'A chave da IA foi recusada. Confira a chave no arquivo apps/api/.env.');
        const detail = isDev && err instanceof Error ? ` (${llmProvider}: ${err.message.slice(0, 300)})` : '';
        throw new HttpError(502, `O assistente não conseguiu responder agora. Tente de novo em instantes.${detail}`);
      }

      const content = response.content as ContentBlockParam[];
      await save('assistant', content.length ? content : [{ type: 'text', text: '…' }]);

      if (!response.wantsTools) break;

      const results: ContentBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const r = await runTool(user, block.name, block.input);
        req.log.info({ tool: block.name, user: user.id, error: r.isError }, 'ai tool');
        results.push({ type: 'tool_result', tool_use_id: block.id, content: r.content, is_error: r.isError });
      }
      await save('user', results);
    }

    await prisma.aiThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
    const newRows = await prisma.aiMessage.findMany({
      where: { threadId: thread.id, createdAt: { gte: firstNew.createdAt } },
      orderBy: { createdAt: 'asc' },
    });
    return { threadId: thread.id, title: thread.title, messages: toDisplay(newRows) };
  });
}
