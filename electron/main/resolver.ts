import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chatCompletion } from './openrouter'
import type { Message } from './types'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

async function recentMainCommits(workspacePath: string): Promise<string> {
  try {
    return (await git(workspacePath, ['log', '--oneline', '-5'])).trim()
  } catch {
    return '(no history)'
  }
}

const RESOLVER_SYSTEM = `You are a merge conflict resolver. You will be shown a file containing git conflict markers (<<<<<<<, =======, >>>>>>>). Your job is to produce the correct merged version of the file.

Rules:
- OUTPUT ONLY the resolved file content. No explanation, no markdown fences, no preamble.
- Preserve BOTH sets of changes when they are independent (e.g. one side added a feature, the other side fixed a bug — keep both).
- If the changes truly conflict, prefer the side described as "incoming" unless it's obviously wrong.
- Remove ALL conflict markers.
- Preserve original indentation and line endings.
- Do not add comments explaining what you did.`

export interface ResolvedFile {
  path: string
  originalConflict: string
  resolved: string
}

export interface ResolutionResult {
  files: ResolvedFile[]
  servedBy?: string
  error?: string
}

export async function resolveConflicts(
  apiKey: string,
  model: string,
  workspacePath: string,
  conflictedFiles: string[],
  incomingBranch: string,
  incomingTaskDescription: string
): Promise<ResolutionResult> {
  const mainContext = await recentMainCommits(workspacePath)
  const files: ResolvedFile[] = []
  let servedBy: string | undefined

  for (const rel of conflictedFiles) {
    const abs = path.join(workspacePath, rel)
    let original: string
    try {
      original = await readFile(abs, 'utf8')
    } catch (e) {
      // Binary file or missing — cannot resolve, skip
      files.push({ path: rel, originalConflict: '', resolved: '' })
      continue
    }

    const messages: Message[] = [
      { role: 'system', content: RESOLVER_SYSTEM },
      {
        role: 'user',
        content: `File: ${rel}

The "incoming" side is branch \`${incomingBranch}\`. That agent's task was:
"${incomingTaskDescription}"

The current main branch head, recent commits:
${mainContext}

Here is the conflicted file. Return the resolved content only.

\`\`\`
${original}
\`\`\``
      }
    ]

    try {
      const { message } = await chatCompletion(apiKey, model, messages)
      const resolved = stripFences((message.content ?? '').trim())
      if (message.servedBy) servedBy = message.servedBy
      files.push({ path: rel, originalConflict: original, resolved })
    } catch (e) {
      return { files, servedBy, error: (e as Error).message }
    }
  }

  return { files, servedBy }
}

function stripFences(s: string): string {
  // Strip a single leading/trailing code fence if the model added one anyway
  const m = s.match(/^```[^\n]*\n([\s\S]*?)\n```$/)
  return m ? m[1] : s
}

export async function applyResolution(
  workspacePath: string,
  files: ResolvedFile[]
): Promise<void> {
  for (const f of files) {
    if (!f.resolved) continue
    const abs = path.join(workspacePath, f.path)
    await writeFile(abs, f.resolved, 'utf8')
    await git(workspacePath, ['add', f.path])
  }
}

export async function commitResolution(workspacePath: string, branch: string): Promise<void> {
  // Complete the merge commit
  await git(workspacePath, ['commit', '--no-edit', '-m', `vibe: merge ${branch} (AI-resolved conflicts)`])
}
