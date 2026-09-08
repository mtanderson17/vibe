// One-shot text completion helper for internal utility tasks (slug generation, etc.).
// No tools, small max_tokens, returns just the text content.

import { completion, providerFor, type ProviderKeys } from './adapter'

const DIRECT_PROVIDER_PREFIXES = ['ollama/', 'anthropic/', 'openai/', 'google/', 'gemini/', 'groq/', 'xai/', 'x-ai/']
function isDirectProviderSlug(slug: string): boolean {
  return DIRECT_PROVIDER_PREFIXES.some(p => slug.startsWith(p))
}

export async function shortCompletion(
  keys: ProviderKeys,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 30
): Promise<string> {
  const slugs = model.split(',').map(s => s.trim()).filter(Boolean)
  const primary = slugs[0]
  if (!primary) throw new Error('No model configured')

  const provider = providerFor(primary, keys)
  const useOpenRouterFallback = provider.label === 'OpenRouter' && slugs.length > 1

  const result = await completion({
    provider,
    modelInBody: useOpenRouterFallback
      ? slugs.filter(s => !isDirectProviderSlug(s)).join(',')
      : provider.model,
    useModelsArray: useOpenRouterFallback,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    maxTokens
  })
  return result.message.content ?? ''
}
