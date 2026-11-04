// hooks/mod/close.ts
// The mod's one hook on a tool call, and the one narrow exception to "the mod never approves a permission
// prompt": a Wheelhouse card open in the chat as a question is closed by itself once it is answered somewhere else
// (the pane, the VS Code panel, another session). It can only refuse: the one thing this file returns of its own is
// { deny: CLOSED_IN_PANEL }, which the First Mate reads as a plain line, never an answer. It returns no result, no
// answers and no changed input, so no choice is ever put in the chat's name, and nothing the chat's record could sign
// is made. It runs only for a call of AskUserQuestion (hooks/register.ts names the matcher), and it closes only when
// every question in the call is a Wheelhouse card and every card is answered on proof an agent can't write:
//   - this session's own pane press the bridge counted (the card's id, noted in this process by cards.tsx after the
//     press, and handed to the bridge, which matches it to the question), or
//   - the bridge's word that the card is decided by a verified signed record, or, for Lift All stop, that STOP is off
//     (scripts/mod/closed.js); a plain card answer written through the helper counts for nothing.
// The call is let run first (`next`), so the dialog opens as it would; the checks run beside it, and when one holds
// the call is refused with `next` still pending, which takes the dialog off and lets the turn carry on.
// scripts/mod/validate.js pins this exception: the hook's matcher, this file, and the shape of what it returns.
import type { EngineInterface } from 'claude-code'
import { ask } from './ask'
import { CLOSED_IN_PANEL } from './numbers'

// Pane presses the bridge counted in this session: the card's id, and when (the clock's ms). It lives in this process
// only, so nothing an agent writes to a file can add to it. The bridge matches an id to the chat's question.
const pressed = new Map<string, number>()

// Notes a pane press the bridge counted on the card with this id.
export function notePressed(id: unknown, at: number) {
  if (typeof id === 'string' && id !== '' && id.length <= 64) pressed.set(id, at)
}

// How often the checks run, and how many runs apart the bridge is asked when nothing new was pressed.
const CHECK_MS = 1000
const ASK_EVERY = 5

// The question texts of the call, or [] when it isn't the shape AskUserQuestion takes.
function textsOf(e: { questions?: unknown }): string[] {
  if (!Array.isArray(e.questions) || e.questions.length === 0) return []
  const texts = e.questions.map((q) => (q !== null && typeof q === 'object' && typeof (q as { question?: unknown }).question === 'string' ? (q as { question: string }).question : null))
  return texts.every((t): t is string => t !== null) ? texts : []
}

// The ids of the cards pressed here since `since`.
function pressedSince(since: number): string[] {
  return Array.from(pressed).filter(([, at]) => at >= since).map(([id]) => id).slice(-8)
}

// What the bridge says of the questions: 'closed' when every one is a card answered on proof (a verified signed record,
// STOP lifted, or a card in `ids` that this session's pane pressed), 'plain' when some are no card (so none will become
// one), else 'open'; null when it can't say.
async function bridgeSays($: EngineInterface, texts: string[], ids: string[]): Promise<'closed' | 'open' | 'plain' | null> {
  try {
    const answer = await ask($, { cmd: 'closed', cwd: await $.session.root(), questions: texts, pressed: ids })
    if (answer === null || !answer.ok || typeof answer.cards !== 'number' || typeof answer.closed !== 'number') return null
    if (answer.cards !== texts.length) return 'plain'
    return answer.closed === answer.cards ? 'closed' : 'open'
  } catch {
    return null
  }
}

type Next = (e: any) => Promise<unknown>

export async function closeWhenAnswered($: EngineInterface, e: { questions?: unknown }, next: Next): Promise<unknown> {
  const running = next(e)
  const texts = textsOf(e)
  if (texts.length === 0) return running
  const since = await $.clock.now()
  const held: { timer?: { cancel: () => void } } = {}
  const closing = new Promise<'closed'>((resolve) => {
    let runs = 0
    let asking = false
    let plain = false
    let told = ''
    const check = () => {
      if (plain || asking) return
      const ids = pressedSince(since)
      const key = ids.join(',')
      runs += 1
      // Asked at once when a press is new, else every ASK_EVERY runs.
      if (key === told && (runs - 1) % ASK_EVERY !== 0) return
      told = key
      asking = true
      void bridgeSays($, texts, ids).then((says) => {
        if (says === 'closed') resolve('closed')
        if (says === 'plain') plain = true
      }).finally(() => { asking = false })
    }
    held.timer = $.clock.every(CHECK_MS, check)
  })
  try {
    const got = await Promise.race([running.then((value) => ({ value })), closing.then(() => null)])
    return got === null ? { deny: CLOSED_IN_PANEL } : got.value
  } finally {
    held.timer?.cancel()
  }
}
