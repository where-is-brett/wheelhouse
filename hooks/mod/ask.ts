// hooks/mod/ask.ts
// The mod's one call out: the plugin's bridge, `node <plugin root>/scripts/mod/bridge.js`,
// run through $.process.run with one JSON request on standard input. The bridge answers one
// JSON line, { ok, says? }. Those commands run outside the session's sandbox, so the bridge
// can sign (check 32). scripts/mod/validate.js checks that this is the only $.process.run in
// the mod and that it runs nothing but the bridge.
import type { EngineInterface } from 'claude-code'

const BRIDGE_MS = 5000

export type Answer = { ok: boolean, says?: string }

// The bridge's answer, or null when it couldn't start, exited non-zero, timed out or printed
// something that isn't its one line.
export async function ask($: EngineInterface, request: Record<string, unknown>): Promise<Answer | null> {
  try {
    const run = await $.process.run(['node', `${$.plugin.root}/scripts/mod/bridge.js`], {
      stdin: JSON.stringify(request),
      timeoutMs: BRIDGE_MS,
    })
    if (run.exitCode !== 0) return null
    const answer = JSON.parse(run.stdout.trim())
    if (answer === null || typeof answer !== 'object' || typeof answer.ok !== 'boolean') return null
    return typeof answer.says === 'string' ? { ok: answer.ok, says: answer.says } : { ok: answer.ok }
  } catch {
    return null
  }
}
