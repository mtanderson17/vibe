import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import { getConfig, setConfig } from './config'
import { ensureRepo, mergeBranch, abortMerge, removeWorktree, deleteBranch } from './git'
import { resolveConflicts, applyResolution, commitResolution } from './resolver'
import { readContext, writeContext } from './context'
import { bindSender, startAgent, continueAgent, killAgent, listAgents, ensureAgent, getAgent, emit } from './agent'

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
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc(): void {
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:set', (_e, partial) => setConfig(partial))

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

  ipcMain.handle('agent:merge', async (_e, id: string) => {
    const cfg = getConfig()
    const agent = getAgent(id)
    if (!cfg.workspacePath || !agent?.branch) throw new Error('Nothing to merge')
    const result = await mergeBranch(cfg.workspacePath, agent.branch)
    if (result.ok) {
      agent.status = 'merged'
      if (agent.worktreePath) await removeWorktree(cfg.workspacePath, agent.worktreePath)
      if (agent.branch) await deleteBranch(cfg.workspacePath, agent.branch)
      emit({ agentId: id, type: 'status', data: 'merged' })
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
    agent.status = 'merged'
    if (agent.worktreePath) await removeWorktree(cfg.workspacePath, agent.worktreePath)
    if (agent.branch) await deleteBranch(cfg.workspacePath, agent.branch)
    emit({ agentId: id, type: 'status', data: 'merged' })
    return { ok: true }
  })
}
