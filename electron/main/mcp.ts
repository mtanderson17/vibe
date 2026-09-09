// MCP (Model Context Protocol) client. Connects to configured servers, lists
// their tools, and exposes them as if they were built-in Vibe tools.
//
// Tools from servers are namespaced: mcp_<serverName>_<toolName>. Dispatch
// during a run: recognize the prefix, route to the right server, call tool.
//
// Servers are configured in the Vibe workspace at .vibe/mcp.json:
//   { "servers": { "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp"] }, ... } }

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean       // default true
}

interface McpServersFile {
  servers: Record<string, McpServerConfig>
}

interface ConnectedServer {
  name: string
  client: Client
  tools: McpToolDescriptor[]
}

export interface McpToolDescriptor {
  namespacedName: string    // e.g. "mcp_playwright_click"
  serverName: string
  originalName: string
  description: string
  inputSchema: Record<string, unknown>
}

// State: server name → connected client
const connected = new Map<string, ConnectedServer>()

function configPath(workspacePath: string): string {
  return path.join(workspacePath, '.vibe', 'mcp.json')
}

const DEFAULT_CONFIG: McpServersFile = {
  servers: {
    // Users add entries here. Left empty by default — no surprise long-running child procs.
    // Example (commented in the seed file, users uncomment):
    //   "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] }
  }
}

export async function loadMcpConfig(workspacePath: string): Promise<McpServersFile> {
  const p = configPath(workspacePath)
  if (!existsSync(p)) {
    await mkdir(path.dirname(p), { recursive: true })
    const seed = `{
  "// note": "MCP server config. Uncomment / add servers below. Each server is a stdio child process.",
  "// example_playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] },
  "// example_github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." } },
  "servers": {}
}`
    await writeFile(p, seed, 'utf8')
    return DEFAULT_CONFIG
  }
  try {
    const raw = await readFile(p, 'utf8')
    const parsed = JSON.parse(raw) as McpServersFile
    return parsed
  } catch (e) {
    console.warn('[vibe] mcp.json parse failed', e)
    return DEFAULT_CONFIG
  }
}

// Connect to each enabled server, list tools, cache. Called on workspace load.
export async function connectMcpServers(workspacePath: string): Promise<void> {
  await disconnectAll()
  const cfg = await loadMcpConfig(workspacePath)
  for (const [name, server] of Object.entries(cfg.servers)) {
    if (server.enabled === false) continue
    try {
      const client = new Client({ name: 'vibe', version: '0.1.0' }, { capabilities: {} })
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>
      })
      await client.connect(transport)

      const { tools: rawTools } = await client.listTools()
      const tools: McpToolDescriptor[] = rawTools.map(t => ({
        namespacedName: `mcp_${name}_${t.name}`,
        serverName: name,
        originalName: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>
      }))
      connected.set(name, { name, client, tools })
      console.log(`[vibe] MCP connected: ${name} (${tools.length} tools)`)
    } catch (e) {
      console.warn(`[vibe] MCP server "${name}" failed to connect:`, (e as Error).message)
    }
  }
}

export async function disconnectAll(): Promise<void> {
  for (const s of connected.values()) {
    try { await s.client.close() } catch { /* ignore */ }
  }
  connected.clear()
}

// All MCP tools, ready to be exposed to the agent (namespaced names).
export function listMcpTools(): McpToolDescriptor[] {
  const out: McpToolDescriptor[] = []
  for (const s of connected.values()) out.push(...s.tools)
  return out
}

// Convert MCP tool descriptors to OpenAI-format tool schemas so we can pass
// them alongside our built-in tools to the AI SDK.
export function mcpToolsAsOpenAISchemas(): Array<Record<string, unknown>> {
  return listMcpTools().map(t => ({
    type: 'function',
    function: {
      name: t.namespacedName,
      description: `[MCP: ${t.serverName}] ${t.description}`,
      parameters: t.inputSchema
    }
  }))
}

// Dispatch a namespaced MCP tool call. Returns the tool result as a string.
export async function callMcpTool(namespacedName: string, args: Record<string, unknown>): Promise<string> {
  // Parse "mcp_<server>_<tool>"
  if (!namespacedName.startsWith('mcp_')) throw new Error(`Not an MCP tool: ${namespacedName}`)
  // Find the longest matching server prefix (server names may contain underscores)
  const rest = namespacedName.slice('mcp_'.length)
  let match: { server: ConnectedServer; toolName: string } | null = null
  for (const s of connected.values()) {
    if (rest.startsWith(s.name + '_')) {
      match = { server: s, toolName: rest.slice(s.name.length + 1) }
      break
    }
  }
  if (!match) throw new Error(`No connected MCP server for tool: ${namespacedName}`)

  const result = await match.server.client.callTool({ name: match.toolName, arguments: args })
  // Result content is an array of { type: 'text', text } | { type: 'image', data, mimeType } | ...
  // We stringify text parts, note others.
  const parts: string[] = []
  const content = (result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>) ?? []
  for (const c of content) {
    if (c.type === 'text') parts.push(c.text ?? '')
    else if (c.type === 'image') parts.push(`[image: ${c.mimeType ?? 'unknown'}, ${(c.data ?? '').length} bytes base64]`)
    else parts.push(`[unsupported content type: ${c.type}]`)
  }
  const text = parts.join('\n')
  return result.isError ? `[MCP error] ${text}` : text
}

export function isMcpTool(name: string): boolean {
  return name.startsWith('mcp_')
}
