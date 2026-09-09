// Vercel AI SDK-backed provider. Replaces our hand-rolled OpenAI-compat + SSE
// parsing with the ai package + per-provider drivers. Benefits:
//  - Anthropic prompt caching wired automatically
//  - Standardized tool-call format across providers
//  - Proper streaming semantics + typed errors
//  - Retry on transient errors baked in
//
// We still write our own tool set, system prompts, and agent loop — this only
// replaces the transport layer.

import { streamText, generateText, jsonSchema, tool as aiTool, type LanguageModel, type ModelMessage } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createXai } from '@ai-sdk/xai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { Message, ToolCall } from '../types'

export interface ProviderKeys {
  openrouter?: string | null
  anthropic?: string | null
  openai?: string | null
  gemini?: string | null
  groq?: string | null
  xai?: string | null
}

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface CompletionResult {
  message: Message
  usage?: Usage
}

// Resolve a Vibe slug to an AI SDK LanguageModel. Prefix mapping mirrors our
// prior providerFor(): direct providers when their key is set, else OpenRouter.
export function resolveLanguageModel(slug: string, keys: ProviderKeys): { model: LanguageModel; label: string; slug: string } {
  if (slug.startsWith('ollama/')) {
    const ollama = createOpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' })
    return { model: ollama(slug.slice('ollama/'.length)), label: 'Ollama', slug }
  }
  if (slug.startsWith('anthropic/') && keys.anthropic) {
    const anthropic = createAnthropic({ apiKey: keys.anthropic })
    return { model: anthropic(slug.slice('anthropic/'.length)), label: 'Anthropic', slug }
  }
  if (slug.startsWith('openai/') && keys.openai) {
    const openai = createOpenAI({ apiKey: keys.openai })
    return { model: openai(slug.slice('openai/'.length)), label: 'OpenAI', slug }
  }
  if ((slug.startsWith('google/') || slug.startsWith('gemini/')) && keys.gemini) {
    const google = createGoogleGenerativeAI({ apiKey: keys.gemini })
    const prefix = slug.startsWith('google/') ? 'google/' : 'gemini/'
    return { model: google(slug.slice(prefix.length)), label: 'Gemini', slug }
  }
  if (slug.startsWith('groq/') && keys.groq) {
    const groq = createGroq({ apiKey: keys.groq })
    return { model: groq(slug.slice('groq/'.length)), label: 'Groq', slug }
  }
  if ((slug.startsWith('xai/') || slug.startsWith('x-ai/')) && keys.xai) {
    const xai = createXai({ apiKey: keys.xai })
    const prefix = slug.startsWith('xai/') ? 'xai/' : 'x-ai/'
    return { model: xai(slug.slice(prefix.length)), label: 'xAI', slug }
  }
  // Fall through: OpenRouter (default). Uses the caller-provided key or nothing
  // (which will fail on API call, surfaced to the user).
  const openrouter = createOpenRouter({ apiKey: keys.openrouter ?? '' })
  return { model: openrouter.chat(slug), label: 'OpenRouter', slug }
}

// Convert our Message[] to AI SDK ModelMessage[]. Handles assistant tool_calls
// and tool result messages.
function toModelMessages(messages: Message[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content ?? '' })
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content ?? '' })
    } else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        // Mixed assistant text + tool calls
        const parts: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }> = []
        if (m.content) parts.push({ type: 'text', text: m.content })
        for (const tc of m.toolCalls) {
          parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input: tc.arguments })
        }
        out.push({ role: 'assistant', content: parts })
      } else {
        out.push({ role: 'assistant', content: m.content ?? '' })
      }
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: m.toolCallId ?? '',
          toolName: m.name ?? '',
          output: { type: 'text', value: m.content ?? '' }
        }]
      })
    }
  }
  return out
}

// Convert our OpenAI-format tool schemas to AI SDK's tool() format.
// Our schemas already carry JSON Schema in `function.parameters`.
interface OurToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

function toAiTools(tools?: Array<Record<string, unknown>>): Record<string, ReturnType<typeof aiTool>> | undefined {
  if (!tools || !tools.length) return undefined
  const out: Record<string, ReturnType<typeof aiTool>> = {}
  for (const t of tools as unknown as OurToolSchema[]) {
    if (t.type !== 'function' || !t.function?.name) continue
    out[t.function.name] = aiTool({
      description: t.function.description,
      inputSchema: jsonSchema(t.function.parameters as Parameters<typeof jsonSchema>[0])
    })
  }
  return out
}

export interface ChatCompletionOptions {
  keys: ProviderKeys
  model: string   // comma-separated slug chain
  messages: Message[]
  tools?: Array<Record<string, unknown>>
  signal?: AbortSignal
  onDelta?: (text: string) => void
  maxTokens?: number
}

// Main entry point. Tries each slug in the chain until one succeeds.
export async function chatCompletion(opts: ChatCompletionOptions): Promise<CompletionResult> {
  const slugs = opts.model.split(',').map(s => s.trim()).filter(Boolean)
  if (!slugs.length) throw new Error('No model configured')

  let lastError: unknown = null
  for (const slug of slugs) {
    try {
      return await callOne(slug, opts)
    } catch (e) {
      lastError = e
      if (opts.signal?.aborted) throw e
      if (!isRetryableProviderError(e)) throw e
      console.warn(`[vibe] ${slug} failed, trying next fallback:`, (e as Error).message)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function callOne(slug: string, opts: ChatCompletionOptions): Promise<CompletionResult> {
  const { model: languageModel, slug: usedSlug, label } = resolveLanguageModel(slug, opts.keys)
  const modelMessages = toModelMessages(opts.messages)
  const aiTools = toAiTools(opts.tools)

  // Enable Anthropic's interleaved thinking for Claude models. This lets Claude
  // do chain-of-thought before AND between tool calls — meaningful quality boost
  // for multi-step tasks, especially with prompt caching (thinking blocks cache).
  const providerOptions = label === 'Anthropic' ? {
    anthropic: {
      thinking: { type: 'enabled' as const, budgetTokens: 4000 }
    }
  } : undefined

  if (opts.onDelta) {
    const result = streamText({
      model: languageModel,
      messages: modelMessages,
      tools: aiTools,
      abortSignal: opts.signal,
      maxOutputTokens: opts.maxTokens,
      providerOptions
    })
    // Consume text stream for deltas
    for await (const chunk of result.textStream) {
      opts.onDelta(chunk)
    }
    // Wait for finish
    const finalContent = await result.text
    const finalToolCalls = await result.toolCalls
    const finalUsage = await result.usage
    return {
      message: {
        role: 'assistant',
        content: finalContent || null,
        toolCalls: finalToolCalls.length ? finalToolCalls.map(tc => ({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: tc.input as Record<string, unknown>
        })) : undefined,
        servedBy: usedSlug
      },
      usage: normalizeUsage(finalUsage)
    }
  }

  const result = await generateText({
    model: languageModel,
    messages: modelMessages,
    tools: aiTools,
    abortSignal: opts.signal,
    maxOutputTokens: opts.maxTokens,
    providerOptions
  })
  return {
    message: {
      role: 'assistant',
      content: result.text || null,
      toolCalls: result.toolCalls.length ? result.toolCalls.map(tc => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.input as Record<string, unknown>
      })) : undefined,
      servedBy: usedSlug
    },
    usage: normalizeUsage(result.usage)
  }
}

function normalizeUsage(u: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined): Usage | undefined {
  if (!u) return undefined
  return {
    prompt_tokens: u.inputTokens ?? 0,
    completion_tokens: u.outputTokens ?? 0,
    total_tokens: u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
  }
}

// AI SDK's errors extend Error; we retry on rate-limit / transient failures.
// Any http status in the retryable list, or errors mentioning specific text
// (some providers put status in message only).
function isRetryableProviderError(e: unknown): boolean {
  const err = e as { statusCode?: number; message?: string; name?: string }
  if (typeof err.statusCode === 'number') {
    return [400, 402, 404, 429, 500, 502, 503].includes(err.statusCode)
  }
  const msg = err.message ?? ''
  return /rate limit|429|502|503|not found|paid version|no models provided|no endpoints/i.test(msg)
}

// Short one-shot for slug generation etc.
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

  const { model: languageModel } = resolveLanguageModel(primary, keys)
  const result = await generateText({
    model: languageModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    maxOutputTokens: maxTokens
  })
  return result.text
}
