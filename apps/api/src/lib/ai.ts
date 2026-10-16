import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

export const aiEnabled = () => Boolean(client);

/**
 * Pede uma resposta em JSON ao Claude. Devolve null se a IA estiver desligada
 * (sem ANTHROPIC_API_KEY) ou se algo falhar — quem chama segue sem a IA.
 */
export async function aiJson<T>(system: string, prompt: string, maxTokens = 1200): Promise<T | null> {
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: env.AI_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
