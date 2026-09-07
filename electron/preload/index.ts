import { contextBridge, ipcRenderer } from 'electron'

const api = {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke('config:set', partial)
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
    start: (id: string, task: string) => ipcRenderer.invoke('agent:start', id, task),
    continue: (id: string, input: string) => ipcRenderer.invoke('agent:continue', id, input),
    kill: (id: string) => ipcRenderer.invoke('agent:kill', id),
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
