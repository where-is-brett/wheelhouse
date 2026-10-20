// hooks/mod/ask.ts
// The mod's one call out: the plugin's bridge, `node <plugin root>/scripts/mod/bridge.js`,
// run through the engine's process call with one JSON request on standard input. The bridge
// answers one JSON line. Those commands run outside the session's sandbox, so the bridge can
// sign (check 32). scripts/mod/validate.js checks that this is the mod's only such call and that
// it runs nothing but the bridge.
import type { EngineInterface, PluginState } from 'claude-code'
import { ASK_MS } from './numbers'

// The pane's model as the bridge sends it (scripts/mod/status.js), declared in types/index.d.ts.
export type PaneModel = PluginState['wheelhouse']['pane']['model']

export const FAILED = 'Wheelhouse couldn\'t record that'

// The bridge's answer line, as scripts/mod/bridge.js lineOf writes it.
export type Answer = {
  ok: boolean,
  says?: string,
  role?: string,
  every?: number,
  pane?: PaneModel,
  glance?: string,
  status?: string,
  submit?: string[],
  // The ids the courier's wake in `submit` marked sent, which `unsent` hands back.
  woken?: string[],
  rows?: Record<string, unknown>[],
  text?: string,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// The answer's fields the mod reads, each kept only when it is of its type, so an answer that
// isn't what the bridge writes can't break the mod.
function answerOf(line: unknown): Answer | null {
  if (!isRecord(line) || typeof line.ok !== 'boolean') return null
  const answer: Answer = { ok: line.ok }
  for (const key of ['says', 'role', 'glance', 'status', 'text'] as const) {
    if (typeof line[key] === 'string') answer[key] = line[key]
  }
  if (typeof line.every === 'number' && Number.isFinite(line.every) && line.every >= 0) answer.every = line.every
  if (isRecord(line.pane)) answer.pane = line.pane as PaneModel
  if (Array.isArray(line.submit) && line.submit.every((item) => typeof item === 'string')) answer.submit = line.submit
  if (Array.isArray(line.woken) && line.woken.every((item) => typeof item === 'string')) answer.woken = line.woken
  if (Array.isArray(line.rows) && line.rows.every(isRecord)) answer.rows = line.rows
  return answer
}

// The bridge's answer, or null when it couldn't start, exited non-zero, timed out or printed
// something that isn't its one line.
export async function ask($: EngineInterface, request: Record<string, unknown>, { timeoutMs = ASK_MS }: { timeoutMs?: number } = {}): Promise<Answer | null> {
  try {
    const run = await $.process.run(['node', `${$.plugin.root}/scripts/mod/bridge.js`], {
      stdin: JSON.stringify(request),
      timeoutMs,
    })
    if (run.exitCode !== 0) return null
    return answerOf(JSON.parse(run.stdout.trim()))
  } catch {
    return null
  }
}

// A request the director made: the bridge's words are a toast, and so is a failure. A `quiet`
// request is one an ordinary message could be: only a record made is shown.
export async function send($: EngineInterface, request: Record<string, unknown>, quiet = false) {
  const answer = await ask($, request)
  if (quiet) {
    if (answer?.ok === true && answer.says !== undefined) $.ui.toast(answer.says)
    return
  }
  if (answer?.says !== undefined) $.ui.toast(answer.says)
  else if (answer === null || !answer.ok) $.ui.toast(FAILED)
}
