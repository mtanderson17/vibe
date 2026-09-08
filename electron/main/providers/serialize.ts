import type { Message } from '../types'
import type { OpenAIRawChoice } from './types'

export function toApiMessages(messages: Message[]): unknown[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content ?? '',
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      }
    }
    return { role: m.role, content: m.content ?? '' }
  })
}

export function parseToolCalls(choice: OpenAIRawChoice): Array<{ id: string; name: string; arguments: Record<string, unknown> }> | undefined {
  if (!choice.message.tool_calls?.length) return undefined
  return choice.message.tool_calls.map(tc => {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments || '{}')
    } catch {
      args = { _raw: tc.function.arguments }
    }
    return { id: tc.id, name: tc.function.name, arguments: args }
  })
}
