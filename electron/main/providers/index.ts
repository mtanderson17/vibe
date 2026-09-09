// Public providers API. Backed by Vercel AI SDK (see aisdk.ts).
export { chatCompletion, shortCompletion, resolveLanguageModel } from './aisdk'
export type { CompletionResult, Usage, ProviderKeys, ChatCompletionOptions } from './aisdk'

// Legacy providerFor kept for the tests that check routing prefix behavior.
// Now returns just { label, apiKey } — we don't need baseUrl anymore since AI SDK
// providers manage their own transport.
import type { ProviderKeys } from './aisdk'
export function providerFor(slug: string, keys: ProviderKeys): { label: 'OpenRouter' | 'Ollama' | 'Anthropic' | 'OpenAI' | 'Gemini' | 'Groq' | 'xAI'; model: string; apiKey: string | null; baseUrl: string; needsAuth: boolean } {
  if (slug.startsWith('ollama/')) {
    return { label: 'Ollama', model: slug.slice('ollama/'.length), apiKey: null, baseUrl: 'http://localhost:11434/v1', needsAuth: false }
  }
  if (slug.startsWith('anthropic/') && keys.anthropic) {
    return { label: 'Anthropic', model: slug.slice('anthropic/'.length), apiKey: keys.anthropic, baseUrl: 'https://api.anthropic.com/v1', needsAuth: true }
  }
  if (slug.startsWith('openai/') && keys.openai) {
    return { label: 'OpenAI', model: slug.slice('openai/'.length), apiKey: keys.openai, baseUrl: 'https://api.openai.com/v1', needsAuth: true }
  }
  if ((slug.startsWith('google/') || slug.startsWith('gemini/')) && keys.gemini) {
    const prefix = slug.startsWith('google/') ? 'google/' : 'gemini/'
    return { label: 'Gemini', model: slug.slice(prefix.length), apiKey: keys.gemini, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsAuth: true }
  }
  if (slug.startsWith('groq/') && keys.groq) {
    return { label: 'Groq', model: slug.slice('groq/'.length), apiKey: keys.groq, baseUrl: 'https://api.groq.com/openai/v1', needsAuth: true }
  }
  if ((slug.startsWith('xai/') || slug.startsWith('x-ai/')) && keys.xai) {
    const prefix = slug.startsWith('xai/') ? 'xai/' : 'x-ai/'
    return { label: 'xAI', model: slug.slice(prefix.length), apiKey: keys.xai, baseUrl: 'https://api.x.ai/v1', needsAuth: true }
  }
  return { label: 'OpenRouter', model: slug, apiKey: keys.openrouter ?? null, baseUrl: 'https://openrouter.ai/api/v1', needsAuth: true }
}
