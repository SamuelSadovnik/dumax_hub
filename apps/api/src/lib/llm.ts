import Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';
import { env } from '../env';

/**
 * Camada única para o modelo de IA. O resto do sistema fala sempre no formato
 * de mensagens do Claude (blocos text / tool_use / tool_result), que é o que fica
 * salvo no banco. Aqui ele é traduzido para o provedor escolhido:
 *   - anthropic (Claude): ANTHROPIC_API_KEY
 *   - gemini (Google): GEMINI_API_KEY, com plano grátis no AI Studio
 * AI_PROVIDER escolhe; sem ele, usa o primeiro que tiver chave.
 */

export type Provider = 'anthropic' | 'gemini';

/** Bloco de conteúdo no formato do Claude. `_sig` guarda a assinatura de raciocínio do Gemini. */
export type TextBlock = { type: 'text'; text: string; _sig?: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; _sig?: string };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Block = TextBlock | ToolUseBlock | ToolResultBlock;
export type Message = { role: 'user' | 'assistant'; content: string | Block[] };
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

export class LlmError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const DEFAULT_MODEL: Record<Provider, string> = { anthropic: 'claude-sonnet-5-5', gemini: 'gemini-2.5-flash' };
const MODEL_PREFIX: Record<Provider, RegExp> = { anthropic: /^claude/i, gemini: /^(gemini|gemma)/i };

export const llmProvider: Provider | null =
  env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.GEMINI_API_KEY ? 'gemini' : null);

const keyFor = (p: Provider) => (p === 'anthropic' ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY);
export const llmEnabled = () => Boolean(llmProvider && keyFor(llmProvider));

/** Modelo do .env se for do provedor certo; senão, o padrão do provedor */
export const llmModel = llmProvider ? (env.AI_MODEL && MODEL_PREFIX[llmProvider].test(env.AI_MODEL) ? env.AI_MODEL : DEFAULT_MODEL[llmProvider]) : null;

export const llmMissingKeyHint = () =>
  llmProvider === 'gemini' ? 'configure GEMINI_API_KEY no .env da API' : 'configure ANTHROPIC_API_KEY (Claude) ou GEMINI_API_KEY (Google) no .env da API';

export interface ChatInput {
  system: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
}
export interface ChatOutput {
  content: (TextBlock | ToolUseBlock)[];
  wantsTools: boolean;
}

export async function chat(input: ChatInput): Promise<ChatOutput> {
  if (!llmProvider || !keyFor(llmProvider)) throw new LlmError(`Assistente desativado: ${llmMissingKeyHint()}.`, 503);
  return llmProvider === 'gemini' ? geminiChat(input) : anthropicChat(input);
}

// ───────────── Claude ─────────────
let anthropic: Anthropic | null = null;

async function anthropicChat({ system, messages, tools, maxTokens = 2048 }: ChatInput): Promise<ChatOutput> {
  anthropic ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // tira campos que só o Gemini usa
  const clean = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : m.content.map(({ _sig: _s, ...b }: Block & { _sig?: string }) => b),
  })) as Anthropic.Messages.MessageParam[];
  try {
    const res = await anthropic.messages.create({
      model: llmModel!,
      max_tokens: maxTokens,
      system,
      messages: clean,
      ...(tools?.length ? { tools: tools as Anthropic.Messages.Tool[] } : {}),
    });
    const content = res.content.flatMap((b): (TextBlock | ToolUseBlock)[] =>
      b.type === 'text' ? [{ type: 'text', text: b.text }] : b.type === 'tool_use' ? [{ type: 'tool_use', id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [],
    );
    return { content, wantsTools: res.stop_reason === 'tool_use' };
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    throw new LlmError((err as Error).message, status);
  }
}

// ───────────── Gemini ─────────────
type GPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};

/** JSON Schema do Claude → schema do Gemini (subconjunto OpenAPI, tipos em maiúsculas) */
function toGeminiSchema(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof s.type === 'string') out.type = s.type.toUpperCase();
  if (typeof s.description === 'string') out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum.map(String);
  if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  if (s.items && typeof s.items === 'object') out.items = toGeminiSchema(s.items as Record<string, unknown>);
  if (s.properties && typeof s.properties === 'object') {
    out.properties = Object.fromEntries(Object.entries(s.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  return out;
}

function toGeminiContents(messages: Message[]) {
  // o Gemini identifica a resposta da ferramenta pelo nome, não pelo id
  const nameById = new Map<string, string>();
  for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') nameById.set(b.id, b.name);

  return messages
    .map((m) => {
      const blocks: Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const parts: GPart[] = blocks.flatMap((b): GPart[] => {
        if (b.type === 'text') return b.text ? [{ text: b.text, ...(b._sig ? { thoughtSignature: b._sig } : {}) }] : [];
        // ids gerados aqui começam com g_; os que vieram do Gemini voltam para ele
        if (b.type === 'tool_use')
          return [{ functionCall: { ...(b.id.startsWith('g_') ? {} : { id: b.id }), name: b.name, args: b.input ?? {} }, ...(b._sig ? { thoughtSignature: b._sig } : {}) }];
        const name = nameById.get(b.tool_use_id) ?? 'ferramenta';
        let result: unknown = b.content;
        try {
          result = JSON.parse(b.content);
        } catch {
          /* texto simples */
        }
        return [{ functionResponse: { ...(b.tool_use_id.startsWith('g_') ? {} : { id: b.tool_use_id }), name, response: b.is_error ? { error: result } : { result } } }];
      });
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    })
    .filter((c) => c.parts.length);
}

async function geminiChat({ system, messages, tools, maxTokens = 2048 }: ChatInput): Promise<ChatOutput> {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGeminiContents(messages),
    generationConfig: { maxOutputTokens: Math.max(maxTokens, 4096) },
    ...(tools?.length
      ? {
          tools: [
            {
              functionDeclarations: tools.map((t) => {
                const params = toGeminiSchema(t.input_schema);
                const hasParams = params.properties && Object.keys(params.properties as object).length > 0;
                return { name: t.name, description: t.description, ...(hasParams ? { parameters: params } : {}) };
              }),
            },
          ],
        }
      : {}),
  };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(llmModel!)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new LlmError(json.error?.message ?? `Gemini respondeu ${res.status}`, res.status);

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const content = parts
    .filter((p) => !p.thought)
    .flatMap((p): (TextBlock | ToolUseBlock)[] => {
      const sig = p.thoughtSignature ? { _sig: p.thoughtSignature } : {};
      if (p.functionCall) return [{ type: 'tool_use', id: p.functionCall.id ?? `g_${randomBytes(6).toString('hex')}`, name: p.functionCall.name, input: p.functionCall.args ?? {}, ...sig }];
      if (typeof p.text === 'string' && p.text) return [{ type: 'text', text: p.text, ...sig }];
      return [];
    });
  return { content, wantsTools: content.some((b) => b.type === 'tool_use') };
}
