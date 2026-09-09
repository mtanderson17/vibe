import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMcpTool, listMcpTools, mcpToolsAsOpenAISchemas } from '../electron/main/mcp'

test('isMcpTool: recognizes mcp_ prefix', () => {
  assert.equal(isMcpTool('mcp_playwright_click'), true)
  assert.equal(isMcpTool('mcp_github_create_issue'), true)
})

test('isMcpTool: rejects built-in tool names', () => {
  assert.equal(isMcpTool('read_file'), false)
  assert.equal(isMcpTool('write_file'), false)
  assert.equal(isMcpTool('replace_in_file'), false)
  assert.equal(isMcpTool('todo_write'), false)
  assert.equal(isMcpTool('finish'), false)
})

test('isMcpTool: empty and edge cases', () => {
  assert.equal(isMcpTool(''), false)
  assert.equal(isMcpTool('mcp'), false)   // missing underscore
  assert.equal(isMcpTool('mcp_'), true)   // technically namespaced (routed then errored downstream)
})

test('listMcpTools: no connected servers returns empty', () => {
  // Bare module state — nothing connected in this test env.
  assert.deepEqual(listMcpTools(), [])
})

test('mcpToolsAsOpenAISchemas: no servers returns empty array (safe for concat)', () => {
  const schemas = mcpToolsAsOpenAISchemas()
  assert.ok(Array.isArray(schemas))
  assert.equal(schemas.length, 0)
})
