import { chat, llmEnabled } from './llm';

export const aiEnabled = llmEnabled;

/**
 * Pede uma resposta em JSON à IA configurada (Claude ou Gemini). Devolve null se a
 * IA estiver desligada (sem chave) ou se algo falhar — quem chama segue sem a IA.
 */
export async function aiJson<T>(system: string, prompt: string, maxTokens = 1200): Promise<T | null> {
  if (!llmEnabled()) return null;
  try {
    const res = await chat({ system, messages: [{ role: 'user', content: prompt }], maxTokens });
    const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
