import type { Message } from '../types'

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface CompletionResult {
  message: Message
  usage?: Usage
}

export interface ProviderInfo {
  baseUrl: string
  model: string
  needsAuth: boolean
  label: 'OpenRouter' | 'Ollama' | 'Anthropic' | 'OpenAI' | 'Gemini' | 'Groq' | 'xAI'
}

export interface OpenAIRawChoice {
  message: {
    role: 'assistant'
    content: string | null
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
  }
  finish_reason: string
}

export interface OpenAIRawResponse {
  model?: string
  choices: OpenAIRawChoice[]
  usage?: Usage
}

export interface StreamChunk {
  model?: string
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: Usage
}
