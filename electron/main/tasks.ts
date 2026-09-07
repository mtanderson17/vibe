import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type TaskStatus = 'backlog' | 'in_progress' | 'awaiting_merge' | 'done'

export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  assignedTo?: string | null
  branch?: string | null
  proposed?: boolean  // PM-agent proposed, awaiting human accept
  proposedBy?: string
  createdAt: string
  updatedAt: string
}

interface TasksFile {
  tasks: Task[]
}

function tasksPath(workspacePath: string): string {
  return path.join(workspacePath, '.vibe', 'tasks.json')
}

export async function loadTasks(workspacePath: string): Promise<Task[]> {
  const p = tasksPath(workspacePath)
  if (!existsSync(p)) return []
  try {
    const raw = await readFile(p, 'utf8')
    const parsed = JSON.parse(raw) as TasksFile
    return parsed.tasks ?? []
  } catch { return [] }
}

async function saveTasks(workspacePath: string, tasks: Task[]): Promise<void> {
  const p = tasksPath(workspacePath)
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify({ tasks }, null, 2), 'utf8')
}

export async function createTask(
  workspacePath: string,
  title: string,
  description?: string,
  opts?: { proposed?: boolean; proposedBy?: string }
): Promise<Task> {
  const tasks = await loadTasks(workspacePath)
  const now = new Date().toISOString()
  const task: Task = {
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    description,
    status: 'backlog',
    assignedTo: null,
    branch: null,
    proposed: opts?.proposed ?? false,
    proposedBy: opts?.proposedBy,
    createdAt: now,
    updatedAt: now
  }
  tasks.push(task)
  await saveTasks(workspacePath, tasks)
  return task
}

export async function updateTask(workspacePath: string, id: string, patch: Partial<Task>): Promise<Task | null> {
  const tasks = await loadTasks(workspacePath)
  const idx = tasks.findIndex(t => t.id === id)
  if (idx < 0) return null
  tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() }
  await saveTasks(workspacePath, tasks)
  return tasks[idx]
}

export async function deleteTask(workspacePath: string, id: string): Promise<void> {
  const tasks = await loadTasks(workspacePath)
  const next = tasks.filter(t => t.id !== id)
  await saveTasks(workspacePath, next)
}
