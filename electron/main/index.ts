import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import { getConfig, setConfig } from './config'
import { ensureRepo, mergeBranch, abortMerge, removeWorktree, deleteBranch, branchChangedFiles, branchDiff } from './git'
import { resolveConflicts, applyResolution, commitResolution } from './resolver'
import { probeOpenRouterFree, detectOllama } from './probe'
import { loadTasks, createTask, updateTask, deleteTask } from './tasks'

// Reset any tasks assigned to `agentId` back to backlog (used when an agent is
// closed/killed mid-task so the work isn't stranded).
async function unassignTasksForAgent(workspacePath: string, agentId: string): Promise<void> {
  const tasks = await loadTasks(workspacePath).catch(() => [])
  for (const t of tasks) {
    if (t.assignedTo === agentId && t.status !== 'done') {
      await updateTask(workspacePath, t.id, { assignedTo: null, status: 'backlog' }).catch(() => {})
    }
  }
}

// Mark tasks assigned to `agentId` as done (used when an agent's branch was
// successfully merged into main).
async function completeTasksForAgent(workspacePath: string, agentId: string): Promise<void> {
  const tasks = await loadTasks(workspacePath).catch(() => [])
  for (const t of tasks) {
    if (t.assignedTo === agentId && t.status !== 'done') {
      await updateTask(workspacePath, t.id, { status: 'done' }).catch(() => {})
    }
  }
}
import { runPmAgent, getPmState, clearPmChat, bindPmSender } from './pmagent'
import { readLedger, summarize } from './ledger'
import { bindApprovalSender, respondToApproval } from './approval'
import { shutdownAllApps } from './launcher'
import { listProviderModels } from './catalog'
import { buildAppMenu } from './menu'
import { readSummary, writeSummary, summaryLastModified } from './context'
import { readContext, writeContext } from './context'
import { bindSender, startAgent, continueAgent, killAgent, listAgents, ensureAgent, getAgent, emit, hydrateAgentsFromWorkspace, spawnAgent, closeAgent, setAgentModel, setAgentName } from './agent'
import { deleteAgentFile, saveAgent } from './persistence'

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  bindSender(mainWindow.webContents)
  bindPmSender(mainWindow.webContents)
  bindApprovalSender(mainWindow.webContents)
  buildAppMenu(mainWindow)

  // Hydrate persisted agents before renderer loads
  const cfg = getConfig()
  if (cfg.workspacePath) {
    await hydrateAgentsFromWorkspace(cfg.workspacePath).catch(err => console.error('[vibe] hydrate failed', err))
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  shutdownAllApps()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  shutdownAllApps()
})

function registerIpc(): void {
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:set', (_e, partial) => setConfig(partial))

  ipcMain.handle('approval:respond', (_e, id: string, approved: boolean) => {
    respondToApproval(id, approved)
  })

  ipcMain.handle('probe:openrouter', async (_e, apiKey: string) => probeOpenRouterFree(apiKey))
  ipcMain.handle('probe:ollama', async () => detectOllama())

  // PM agent
  ipcMain.handle('pm:state', () => getPmState())
  ipcMain.handle('pm:run', async (_e, trigger: 'manual' | 'chat', userInput?: string) => {
    runPmAgent(trigger, userInput).catch(err => console.error('[vibe] pm error', err))
    return { ok: true }
  })
  ipcMain.handle('pm:clear', () => { clearPmChat(); return { ok: true } })
  ipcMain.handle('pm:read_summary', async () => {
    const cfg = getConfig()
    if (!cfg.workspacePath) return ''
    return readSummary(cfg.workspacePath)
  })
  ipcMain.handle('pm:last_modified', async () => {
    const cfg = getConfig()
    if (!cfg.workspacePath) return null
    return summaryLastModified(cfg.workspacePath)
  })

  ipcMain.handle('tasks:list', async () => {
    const cfg = getConfig()
    if (!cfg.workspacePath) return []
    return loadTasks(cfg.workspacePath)
  })
  ipcMain.handle('tasks:create', async (_e, title: string, description?: string) => {
    const cfg = getConfig()
    if (!cfg.workspacePath) throw new Error('No workspace')
    return createTask(cfg.workspacePath, title, description)
  })
  ipcMain.handle('tasks:update', async (_e, id: string, patch: Record<string, unknown>) => {
    const cfg = getConfig()
    if (!cfg.workspacePath) throw new Error('No workspace')
    return updateTask(cfg.workspacePath, id, patch)
  })
  ipcMain.handle('tasks:delete', async (_e, id: string) => {
    const cfg = getConfig()
    if (!cfg.workspacePath) return
    return deleteTask(cfg.workspacePath, id)
  })
  ipcMain.handle('tasks:assign_to_agent', async (_e, taskId: string, agentId: string) => {
    const cfg = getConfig()
    const agent = getAgent(agentId) ?? ensureAgent(agentId)
    if (!cfg.workspacePath) throw new Error('No workspace')
    const tasks = await loadTasks(cfg.workspacePath)
    const task = tasks.find(t => t.id === taskId)
    if (!task) throw new Error('Task not found')
    if (agent.status === 'running') throw new Error(`${agentId} is currently running`)
    await updateTask(cfg.workspacePath, taskId, { assignedTo: agentId, status: 'in_progress' })
    startAgent(agentId, task.title + (task.description ? '\n\n' + task.description : '')).catch(err => console.error('start error', err))
    return { ok: true }
  })

  ipcMain.handle('ledger:summary', async () => {
    const cfg = getConfig()
    if (!cfg.workspacePath) return null
    const entries = await readLedger(cfg.workspacePath).catch(() => [])
    return summarize(entries)
  })

  ipcMain.handle('models:list_provider', async (_e, provider: 'anthropic' | 'openai' | 'gemini' | 'groq' | 'xai') => {
    const cfg = getConfig()
    const keyMap: Record<string, string | null> = {
      anthropic: cfg.anthropicApiKey,
      openai: cfg.openaiApiKey,
      gemini: cfg.geminiApiKey,
      groq: cfg.groqApiKey,
      xai: cfg.xaiApiKey
    }
    return listProviderModels(provider, keyMap[provider] ?? '')
  })

  ipcMain.handle('models:pricing', async () => {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models')
      if (!res.ok) return {}
      const data = await res.json() as { data: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> }
      const map: Record<string, { prompt: number; completion: number }> = {}
      for (const m of data.data) {
        map[m.id] = {
          prompt: parseFloat(m.pricing?.prompt ?? '0'),
          completion: parseFloat(m.pricing?.completion ?? '0')
        }
      }
      return map
    } catch { return {} }
  })

  ipcMain.handle('workspace:pick', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const workspacePath = res.filePaths[0]
    setConfig({ workspacePath })
    await ensureRepo(workspacePath)
    return workspacePath
  })

  ipcMain.handle('context:read', async () => {
    const cfg = getConfig()
    if (!cfg.workspacePath) return ''
    return readContext(cfg.workspacePath)
  })

  ipcMain.handle('context:write', async (_e, content: string) => {
    const cfg = getConfig()
    if (!cfg.workspacePath) throw new Error('Workspace not set')
    await writeContext(cfg.workspacePath, content)
  })

  ipcMain.handle('agents:list', () => listAgents())
  ipcMain.handle('agents:get', (_e, id: string) => getAgent(id))
  ipcMain.handle('agents:ensure', (_e, id: string) => ensureAgent(id))

  ipcMain.handle('agents:spawn', () => spawnAgent())
  ipcMain.handle('agents:close', async (_e, id: string) => {
    const cfg = getConfig()
    const agent = getAgent(id)
    const branch = agent?.branch
    const worktreePath = agent?.worktreePath

    // Immediate work: kill any running loop + drop in-memory state + delete persistence file.
    // These are all fast (memory + one file unlink).
    closeAgent(id)
    if (cfg.workspacePath) {
      await deleteAgentFile(cfg.workspacePath, id).catch(() => {})
      // Reset any in-progress tasks assigned to this agent back to backlog so
      // they can be reassigned instead of being stranded.
      await unassignTasksForAgent(cfg.workspacePath, id).catch(() => {})
    }

    // Background work: git worktree removal + branch delete are slow on Windows (~1-3s each).
    // Fire and forget — the UI has already updated optimistically.
    if (branch && cfg.workspacePath && worktreePath) {
      Promise.resolve().then(async () => {
        await removeWorktree(cfg.workspacePath!, worktreePath).catch(err => console.error('[vibe] worktree cleanup failed', err))
        await deleteBranch(cfg.workspacePath!, branch).catch(err => console.error('[vibe] branch delete failed', err))
      })
    }
    return { ok: true }
  })

  ipcMain.handle('agent:start', async (_e, id: string, task: string) => {
    startAgent(id, task).catch(err => console.error('agent error', err))
    return { ok: true }
  })

  ipcMain.handle('agent:continue', async (_e, id: string, input: string) => {
    continueAgent(id, input).catch(err => console.error('agent continue error', err))
    return { ok: true }
  })

  ipcMain.handle('agent:kill', async (_e, id: string) => {
    killAgent(id)
    return { ok: true }
  })

  ipcMain.handle('agent:set_model', async (_e, id: string, model: string | null) => {
    setAgentModel(id, model)
    return { ok: true }
  })

  ipcMain.handle('agent:set_name', async (_e, id: string, name: string | null) => {
    setAgentName(id, name)
    return { ok: true }
  })

  ipcMain.handle('agent:preview_diff', async (_e, id: string) => {
    const cfg = getConfig()
    const agent = getAgent(id)
    if (!cfg.workspacePath || !agent?.branch) return { files: [], totalAdded: 0, totalRemoved: 0 }
    return await branchDiff(cfg.workspacePath, agent.branch)
  })

  ipcMain.handle('agent:check_overlap', async (_e, id: string) => {
    const cfg = getConfig()
    const agent = getAgent(id)
    if (!cfg.workspacePath || !agent?.branch) return { own: [], overlaps: {} }
    const own = await branchChangedFiles(cfg.workspacePath, agent.branch)
    const overlaps: Record<string, string[]> = {}
    for (const other of listAgents()) {
      if (other.id === id || !other.branch) continue
      if (other.status !== 'awaiting_merge' && other.status !== 'running' && other.status !== 'awaiting_input') continue
      const theirs = await branchChangedFiles(cfg.workspacePath, other.branch)
      const shared = own.filter(f => theirs.includes(f))
      if (shared.length) overlaps[other.id] = shared
    }
    return { own, overlaps }
  })

  ipcMain.handle('agent:merge', async (_e, id: string) => {
    const cfg = getConfig()
    const agent = getAgent(id)
    if (!cfg.workspacePath || !agent?.branch) throw new Error('Nothing to merge')
    const result = await mergeBranch(cfg.workspacePath, agent.branch)
    if (result.ok) {
      if (agent.worktreePath) await removeWorktree(cfg.workspacePath, agent.worktreePath)
      if (agent.branch) await deleteBranch(cfg.workspacePath, agent.branch)
      // Clear dead refs BEFORE persisting so a restart doesn't hydrate stale state.
      agent.status = 'merged'
      agent.branch = null
      agent.worktreePath = null
      await saveAgent(cfg.workspacePath, agent).catch(err => console.error('[vibe] persist merged failed', err))
      // Move the assigned task (if any) to done on the kanban.
      await completeTasksForAgent(cfg.workspacePath, id).catch(() => {})
      emit({ agentId: id, type: 'status', data: 'merged' })
      runPmAgent('merge').catch(err => console.error('[vibe] pm-agent post-merge failed', err))
    }
    return result
  })

  ipcMain.handle('agent:abort_merge', async () => {
    const cfg = getConfig()
    if (!cfg.workspacePath) return
    await abortMerge(cfg.workspacePath)
  })

  ipcMain.handle('agent:resolve_conflicts', async (_e, id: string, conflictedFiles: string[]) => {
    const cfg = getConfig()
    const agent = getAgent(id)
    if (!cfg.workspacePath || !cfg.openrouterApiKey || !agent?.branch) {
      throw new Error('Cannot resolve: missing workspace, key, or branch')
    }
    return await resolveConflicts(
      cfg.openrouterApiKey,
      agent.pinnedModel ?? cfg.model,
      cfg.workspacePath,
      conflictedFiles,
      agent.branch,
      agent.task ?? ''
    )
  })

  ipcMain.handle('agent:accept_resolution', async (_e, id: string, files: Array<{ path: string; originalConflict: string; resolved: string }>) => {
    const cfg = getConfig()
    const agent = getAgent(id)
    if (!cfg.workspacePath || !agent?.branch) throw new Error('Cannot accept: missing workspace or branch')
    await applyResolution(cfg.workspacePath, files)
    await commitResolution(cfg.workspacePath, agent.branch)
    if (agent.worktreePath) await removeWorktree(cfg.workspacePath, agent.worktreePath)
    if (agent.branch) await deleteBranch(cfg.workspacePath, agent.branch)
    agent.status = 'merged'
    agent.branch = null
    agent.worktreePath = null
    await saveAgent(cfg.workspacePath, agent).catch(err => console.error('[vibe] persist merged failed', err))
    await completeTasksForAgent(cfg.workspacePath, id).catch(() => {})
    emit({ agentId: id, type: 'status', data: 'merged' })
    return { ok: true }
  })
}
