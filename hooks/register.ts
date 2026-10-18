// hooks/register.ts
// Wheelhouse's mod. It signs nothing and runs no shell: every call it makes goes to the
// plugin's bridge, `node <plugin root>/scripts/mod/bridge.js`, through $.process.run, with one
// JSON request on standard input, and the bridge answers one JSON line, { ok, says? }. Those
// commands run outside the session's sandbox, so the bridge can sign (check 32).
//
// Four hooks, each passing on with next(e) and never changing the message:
//   session.start    registers /go and sends the session's usage figures
//   session.measure  sends them again when the allowance or the cost moved
//   prompt.submit    a phoned "stop" sends stop; a reply code and an option sends reply
//   command.run      /go sends go and answers with the bridge's words
// A message counts as the director's only when it came from the prompt (`composer`) or the
// phone (`bridge`); every other origin never reaches the bridge.
import type { Register, EngineInterface, PromptSubmitInput, SessionRateLimit, SessionCost } from 'claude-code'

const FAILED = 'Wheelhouse couldn\'t record that'
const BRIDGE_MS = 5000
const DIRECTOR = ['composer', 'bridge']
// A reply code is four characters from the code alphabet (scripts/state/card-lines.js), in
// any case, then an option; the bridge does the real parse. As there, the option is at most
// 80 characters and the message may end with one full stop.
const REPLY = /^[A-HJKMNP-TV-Z2-9]{4}\s+\S.{0,79}$/is
const STOP = /^stop\.?$/i

type Answer = { ok: boolean, says?: string }

// The bridge's answer, or null when it couldn't start, exited non-zero, timed out or printed
// something that isn't its one line.
async function ask($: EngineInterface, request: Record<string, unknown>): Promise<Answer | null> {
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

// A request the director made. A failure always says so; with `showSays`, the bridge's words
// are shown as a toast too.
async function send($: EngineInterface, request: Record<string, unknown>, showSays: boolean): Promise<Answer | null> {
  const answer = await ask($, request)
  if (showSays && answer?.says !== undefined) $.ui.toast(answer.says)
  else if (answer === null || !answer.ok) $.ui.toast(FAILED)
  return answer
}

// The session's usage figures. A reading that can't be kept says nothing: the next one comes
// at the next measure.
async function sendUsage($: EngineInterface, rateLimits: readonly SessionRateLimit[], cost: SessionCost | undefined) {
  try {
    const windows = rateLimits.map(({ kind, percentUsed, resetsAt }) =>
      resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt })
    await ask($, {
      cmd: 'usage',
      session: await $.session.id(),
      cwd: await $.session.root(),
      ...(cost === undefined ? {} : { usd: cost.usd }),
      ...(windows.length === 0 ? {} : { windows }),
    })
  } catch {
    // Usage is informing only.
  }
}

// What a submitted message asks of the bridge, or null for nothing.
function requestFor(e: PromptSubmitInput): Record<string, unknown> | null {
  const origin = e.origin.kind
  if (!DIRECTOR.includes(origin) || e.isMeta || e.command) return null
  const text = e.text.trim()
  // A typed "stop" is the stop-word hook's; only a phoned one is sent.
  if (STOP.test(text)) return origin === 'bridge' ? { cmd: 'stop', origin } : null
  if (REPLY.test(text)) return { cmd: 'reply', origin, text: e.text }
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'go', description: 'Lift STOP' })
    } catch {
      // Without the command, a reply code still lifts STOP.
    }
    try {
      const { rateLimits, cost } = await $.session.usage()
      await sendUsage($, rateLimits, cost)
    } catch {
      // Usage is informing only.
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) await sendUsage($, e.rateLimits, e.cost)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const request = requestFor(e)
    if (request !== null) {
      try {
        await send($, { ...request, cwd: await $.session.root() }, true)
      } catch {
        $.ui.toast(FAILED)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'go' }, async ($, e) => {
    try {
      // The answer is the command's output, so only a failure is a toast.
      const answer = await send($, { cmd: 'go', origin: e.origin.kind, cwd: await $.session.root() }, false)
      return { text: answer?.says ?? (answer?.ok ? 'STOP is off.' : FAILED) }
    } catch {
      $.ui.toast(FAILED)
      return { text: FAILED }
    }
  })
}
