import { contextBridge, ipcRenderer } from 'electron'

const api = {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke('config:set', partial)
  },
  probe: {
    openrouter: (apiKey: string) => ipcRenderer.invoke('probe:openrouter', apiKey),
    ollama: () => ipcRenderer.invoke('probe:ollama')
  },
  models: {
    pricing: () => ipcRenderer.invoke('models:pricing')
  },
  ledger: {
    summary: () => ipcRenderer.invoke('ledger:summary')
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    create: (title: string, description?: string) => ipcRenderer.invoke('tasks:create', title, description),
    update: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('tasks:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    assignToAgent: (taskId: string, agentId: string) => ipcRenderer.invoke('tasks:assign_to_agent', taskId, agentId)
  },
  pm: {
    state: () => ipcRenderer.invoke('pm:state'),
    run: (trigger: 'manual' | 'chat', userInput?: string) => ipcRenderer.invoke('pm:run', trigger, userInput),
    clear: () => ipcRenderer.invoke('pm:clear'),
    readSummary: () => ipcRenderer.invoke('pm:read_summary'),
    lastModified: () => ipcRenderer.invoke('pm:last_modified')
  },
  onPmEvent: (cb: (event: { type: string; data: unknown }) => void) => {
    const listener = (_e: unknown, event: { type: string; data: unknown }) => cb(event)
    ipcRenderer.on('pm:event', listener)
    return () => ipcRenderer.off('pm:event', listener)
  },
  workspace: {
    pick: () => ipcRenderer.invoke('workspace:pick')
  },
  context: {
    read: () => ipcRenderer.invoke('context:read'),
    write: (content: string) => ipcRenderer.invoke('context:write', content)
  },
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    get: (id: string) => ipcRenderer.invoke('agents:get', id),
    ensure: (id: string) => ipcRenderer.invoke('agents:ensure', id),
    spawn: () => ipcRenderer.invoke('agents:spawn'),
    close: (id: string) => ipcRenderer.invoke('agents:close', id),
    start: (id: string, task: string) => ipcRenderer.invoke('agent:start', id, task),
    continue: (id: string, input: string) => ipcRenderer.invoke('agent:continue', id, input),
    kill: (id: string) => ipcRenderer.invoke('agent:kill', id),
    checkOverlap: (id: string) => ipcRenderer.invoke('agent:check_overlap', id),
    merge: (id: string) => ipcRenderer.invoke('agent:merge', id),
    abortMerge: () => ipcRenderer.invoke('agent:abort_merge'),
    resolveConflicts: (id: string, files: string[]) => ipcRenderer.invoke('agent:resolve_conflicts', id, files),
    acceptResolution: (id: string, files: Array<{ path: string; originalConflict: string; resolved: string }>) =>
      ipcRenderer.invoke('agent:accept_resolution', id, files)
  },
  onAgentEvent: (cb: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown) => cb(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.off('agent:event', listener)
  }
}

contextBridge.exposeInMainWorld('vibe', api)

export type VibeApi = typeof api
