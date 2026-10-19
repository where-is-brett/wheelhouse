// hooks/register.ts
// Wheelhouse's mod. It signs nothing and runs no shell: every call it makes goes to the
// plugin's bridge, `node <plugin root>/scripts/mod/bridge.js`, through ask (hooks/mod/ask.ts),
// with one JSON request, and the bridge answers one JSON line, { ok, says? }.
//
// Four hooks, each passing on with next(e) and never changing the message:
//   session.start    registers /go and sends the session's usage figures
//   session.measure  sends them again when the allowance or the cost moved
//   prompt.submit    a phoned "stop" sends stop; a reply code and an option sends reply
//   command.run      /go sends go and answers with the bridge's words
// A message counts as the director's only when it came from the prompt (`composer`) or the
// phone (`bridge`); every other origin never reaches the bridge.
import type { Register, EngineInterface, PromptSubmitInput, SessionRateLimit, SessionCost } from 'claude-code'
import { ask, type Answer } from './mod/ask'

const FAILED = 'Wheelhouse couldn\'t record that'
const DIRECTOR = ['composer', 'bridge']
// The options a reply code can answer: the signed labels of scripts/hooks/prompt-record.js,
// kept in step by tests/scripts/mod/validate.test.js. The bridge refuses every other option.
const LABELS = ['Approve', 'Confirm', 'Lift STOP', 'Do it', 'Push it', 'Change it', 'End it', 'Merge the fix']
// The code alphabet of scripts/state/card-lines.js, kept in step by the same test.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
// A reply is four characters from the code alphabet and one of those labels, in any case, with
// any spacing and one closing full stop; the bridge does the real parse. So an ordinary message
// that starts with a four-letter word sends nothing.
const REPLY = new RegExp(`^[${CODE_ALPHABET}]{4}\\s+(?:${LABELS.map((l) => l.split(' ').join('\\s+')).join('|')})\\s*\\.?$`, 'i')
// A reply to a question card names one of the question's own options, which the mod can't know.
// So a message whose first word is a code as a card shows it (four capitals from the alphabet),
// then a space and an option of at most OPTION_CHARS characters with no control characters, is
// sent too, the way scripts/mod/reply.js parseReply reads it. An ordinary message can look like
// this, so the bridge's refusal is never shown for it.
const OPTION_CHARS = 80
const CODED = new RegExp(`^[${CODE_ALPHABET}]{4} (.+)$`)
// "stop" as the stop-word hook (scripts/hooks/stop-word.js) reads it: the word, in any case,
// with any closing full stops or exclamation marks.
const STOP = /^stop[.!]*$/i

// A request the director made from a message: the bridge's words are a toast, and so is a
// failure. A `quiet` request is one an ordinary message could be: only a record made is shown.
async function send($: EngineInterface, request: Record<string, unknown>, quiet: boolean) {
  const answer = await ask($, request)
  if (quiet) {
    if (answer?.ok === true && answer.says !== undefined) $.ui.toast(answer.says)
    return
  }
  if (answer?.says !== undefined) $.ui.toast(answer.says)
  else if (answer === null || !answer.ok) $.ui.toast(FAILED)
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

// Whether the message is a code and an option, as parseReply reads it: whitespace folded, one
// closing full stop dropped, the option short and free of control characters.
function codedReply(text: string): boolean {
  let words = text.replace(/\s+/g, ' ').trim()
  if (words.endsWith('.')) words = words.slice(0, -1).trimEnd()
  const option = CODED.exec(words)?.[1]
  return option !== undefined && option.length <= OPTION_CHARS && !/[\p{Cc}\p{Cf}]/u.test(option)
}

// What a submitted message asks of the bridge, or null for nothing. A `quiet` request is shown
// only when it made a record.
function requestFor(e: PromptSubmitInput): { request: Record<string, unknown>, quiet: boolean } | null {
  const origin = e.origin.kind
  if (!DIRECTOR.includes(origin) || e.isMeta || e.command) return null
  const text = e.text.trim()
  // A typed "stop" is the stop-word hook's; only a phoned one is sent.
  if (STOP.test(text)) return origin === 'bridge' ? { request: { cmd: 'stop', origin }, quiet: false } : null
  if (REPLY.test(text)) return { request: { cmd: 'reply', origin, text: e.text }, quiet: false }
  if (codedReply(text)) return { request: { cmd: 'reply', origin, text: e.text }, quiet: true }
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'go', description: 'Lift STOP' })
    } catch {
      // Without the command, a reply code still lifts STOP.
    }
    // Usage is informing only, so the session starts without waiting for it.
    void (async () => {
      try {
        const { rateLimits, cost } = await $.session.usage()
        await sendUsage($, rateLimits, cost)
      } catch {
        // The next measure sends it again.
      }
    })()
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) await sendUsage($, e.rateLimits, e.cost)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const asked = requestFor(e)
    if (asked !== null) {
      try {
        await send($, { ...asked.request, cwd: await $.session.root() }, asked.quiet)
      } catch {
        if (!asked.quiet) $.ui.toast(FAILED)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The bridge's words, refusals included, are the command's output; only no answer at all
  // is a toast too.
  on('command.run', { command: 'go' }, async ($, e) => {
    let answer: Answer | null = null
    try {
      answer = await ask($, { cmd: 'go', origin: e.origin.kind, cwd: await $.session.root() })
    } catch {
      answer = null
    }
    if (answer === null) $.ui.toast(FAILED)
    return { text: answer?.says ?? FAILED }
  })
}
