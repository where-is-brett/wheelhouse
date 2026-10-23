// hooks/register.ts
// Wheelhouse's mod. It signs nothing and runs no shell: every call it makes goes to the
// plugin's bridge, `node <plugin root>/scripts/mod/bridge.js`, through ask (hooks/mod/ask.ts),
// with one JSON request, and the bridge answers one JSON line. The prompts the bridge's answers
// hold, and the settings view's Ask the front desk, are handed to the front desk as prompts.
//
// This file only wires the hooks, each passing on with next(e) and never changing the message,
// but for Wheelhouse traffic in the front desk's session (hooks/mod/messages.ts):
//   session.start    registers /wheelhouse-go, /wheelhouse and /wheelhouse-digest, sends the session's usage figures
//                    and starts the pane's ticks (hooks/mod/pane.tsx), which hand on the prompts
//                    their answers hold
//   session.measure  sends the usage figures again when the allowance or the cost moved
//   prompt.submit    keeps Wheelhouse traffic out of the front desk and ticks instead; a phoned
//                    "stop" sends stop; a reply code and an option sends reply
//   session.receive  keeps Wheelhouse traffic out of the front desk and ticks instead
//   turn.start       marks the session busy, for the tick
//   turn.complete    marks it idle again
//   command.run      /wheelhouse-go sends go and answers with the bridge's words; /wheelhouse opens the pane;
//                    /wheelhouse-digest answers with the bridge's briefing
//   ui.render        draws the pane, with each card's buttons, STOP or Lift STOP and the settings
//                    view (hooks/mod/cards.tsx, hooks/mod/settings.tsx)
// A typed reply or "stop" is read past any reminder blocks the app puts before it (ownWords),
// and the bridge is sent what follows them.
// A message counts as the director's only when it came from the prompt (`composer`) or the
// phone (`bridge`); every other origin never reaches the bridge. A press counts as the
// director's under the origin `pane`, which only a button's press handler sends.
import type { Register, EngineInterface, PromptSubmitInput, SessionRateLimit, SessionCost } from 'claude-code'
import { ask, send, FAILED, type Answer } from './mod/ask'
import { drawPane, openPane, startPane, turnEnded, turnStarted } from './mod/pane'
import { keepOut, KEPT_OUT, ownWords } from './mod/messages'

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
  // The app's reminder blocks before the typed line are read past; a remainder that still holds
  // a reminder tag is not the director's own words.
  const own = ownWords(e.text)
  if (own === null) return null
  const text = own.trim()
  // A typed "stop" is the stop-word hook's; only a phoned one is sent.
  if (STOP.test(text)) return origin === 'bridge' ? { request: { cmd: 'stop', origin }, quiet: false } : null
  if (REPLY.test(text)) return { request: { cmd: 'reply', origin, text: own }, quiet: false }
  if (codedReply(text)) return { request: { cmd: 'reply', origin, text: own }, quiet: true }
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'wheelhouse-go', description: 'Lift STOP' })
    } catch {
      // Without the command, a reply code still lifts STOP.
    }
    try {
      await $.command.register({ name: 'wheelhouse', description: 'Open Wheelhouse\'s pane' })
    } catch {
      // Without the command, the pane still opens at the session's start.
    }
    try {
      await $.command.register({ name: 'wheelhouse-digest', description: 'Show the briefing, with no Claude turn' })
    } catch {
      // Without the command, the front desk still gives the briefing.
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
    try {
      await startPane($, e)
    } catch {
      // The pane is informing only.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) await sendUsage($, e.rateLimits, e.cost)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await turnStarted($, e)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await turnEnded($, e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Wheelhouse traffic is kept out before anything else; the director's messages never are.
  on('prompt.submit', async ($, e, next) => {
    if (await keepOut($, e.origin.kind, e.text)) return { drop: KEPT_OUT }
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
  on('command.run', { command: 'wheelhouse-go' }, async ($, e) => {
    let answer: Answer | null = null
    try {
      answer = await ask($, { cmd: 'go', origin: e.origin.kind, cwd: await $.session.root() })
    } catch {
      answer = null
    }
    if (answer === null) $.ui.toast(FAILED)
    return { text: answer?.says ?? FAILED }
  })

  // A delivery for one of the session's agents is not the front desk's conversation.
  on('session.receive', async ($, e, next) => {
    if (e.agentId === undefined && await keepOut($, e.origin.kind, e.text)) return { consumed: KEPT_OUT }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'wheelhouse' }, async ($) => openPane($))

  // The bridge's text is the command's output, its own words when it has no briefing included
  // (or its refusal's, should it refuse); only no answer at all is a toast too.
  on('command.run', { command: 'wheelhouse-digest' }, async ($, e) => {
    let answer: Answer | null = null
    try {
      answer = await ask($, { cmd: 'digest', origin: e.origin.kind, cwd: await $.session.root() })
    } catch {
      answer = null
    }
    const words = answer?.text ?? answer?.says
    if (words === undefined) $.ui.toast(FAILED)
    return { text: words ?? FAILED }
  })

  // The pane's id, PANE_ID, written out so the validator can name the hook; scripts/mod/validate.js
  // checks it is PANE_ID.
  on('ui.render', { component: 'Pane', requestId: 'wheelhouse' }, async ($, e) => drawPane($, e))
    .catch(($, e, next) => next(e))
}
