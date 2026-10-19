// hooks/mod/pane.tsx
// The side pane and the status line, drawn from the bridge's tick. The mod decides nothing here:
// the bridge says the session's role, how often to tick, what the pane shows and what the status
// line says; the mod asks, keeps the answer in the session's state and draws it.
//
// A tick sends { cmd: 'tick', session, cwd, idle, surface }. In the front desk's session its
// answer holds the pane's model (scripts/mod/status.js), the glance and the status line; any
// other session's answer holds only its role and `every`. One tick runs at a time.
//
// The pane has two views: the board, with each card's buttons (hooks/mod/cards.tsx), and the
// settings (hooks/mod/settings.tsx). STOP or Lift STOP heads both.
import type { EngineInterface, RenderInput, SessionStartInput, TurnStartInput, TurnCompleteInput } from 'claude-code'
import { ask, type Answer, type PaneModel } from './ask'
import { PANE_ID, TICK_MS, STALE_TICKS, TICK_ASK_MS } from './numbers'
import { drawCard, drawStop, pressingNow, releaseAll } from './cards'
import { drawSettings, showSettings } from './settings'

// Whether every button, STOP included, is held back while a turn runs. Buttons stay live during a
// turn, since each press says at once that it was taken (design section 17.1); check 41 turns this
// on if a press made during a turn is lost in Desktop, and then they are drawn as "Wait for Claude
// to finish, or type stop" (cards.tsx WAIT) while a turn runs.
export const HIDE_WHILE_BUSY: boolean = false

const FRONT_DESK = 'front-desk'
const NOT_OPENED = 'Wheelhouse couldn\'t open its pane'
const FIRST_READING = 'Reading how the project stands…'
// The pane's title while what it shows is old: no figures, so none is taken for current.
const PLAIN_TITLE = 'Wheelhouse'

const PANE = { plugin: 'wheelhouse', key: 'pane' } as const
const TICK = { plugin: 'wheelhouse', key: 'tick' } as const
const CARD = { plugin: 'wheelhouse', key: 'card' } as const
const BUSY = { plugin: 'wheelhouse', key: 'busy' } as const
const SURFACE = { plugin: 'wheelhouse', key: 'surface' } as const
const ROLE = { plugin: 'wheelhouse', key: 'role' } as const
const OPENED = { plugin: 'wheelhouse', key: 'opened' } as const
const VIEW = { plugin: 'wheelhouse', key: 'view' } as const
const SETTINGS = { plugin: 'wheelhouse', key: 'settings' } as const

// The module's own: the timer and whether a tick runs. A reload starts both over, with the
// session.start that follows it. Whether the pane has been opened is the session's, kept in its
// state, so a reload never opens a pane the director closed.
let timer: { every: number, cancel: () => void } | null = null
let running = false

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : [])

// "03:01 UTC" for `$.clock.now()`'s milliseconds.
function timeOf(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`
}

function stopTimer() {
  timer?.cancel()
  timer = null
}

function startTimer($: EngineInterface, every: number) {
  const interval = $.clock.every(every, () => { void tick($) })
  timer = { every, cancel: () => interval.cancel() }
}

// The timer after a tick (ruling 28): the answer's `every` when it is above 0, restarted when it
// changed; 0 stops it; no `every` (a failed or late tick) leaves it, or starts it at TICK_MS.
function schedule($: EngineInterface, every: number | undefined) {
  if (every === undefined) {
    if (timer === null) startTimer($, TICK_MS)
    return
  }
  if (every === 0) {
    stopTimer()
    return
  }
  if (timer?.every !== every) {
    stopTimer()
    startTimer($, every)
  }
}

async function paneIsOpen($: EngineInterface) {
  return (await $.ui.panes()).some((pane) => pane.id === PANE_ID)
}

// While what the pane shows is old, the status line this session set is cleared and the open
// pane's title carries no figures, so neither shows old figures as current; the pane says how old.
async function showOld($: EngineInterface, session: string) {
  const [role, opened] = await Promise.all([$.state.get(ROLE), $.state.get(OPENED)])
  if (role.value !== FRONT_DESK || opened.value !== session) return
  $.ui.status(undefined)
  if (await paneIsOpen($)) await $.ui.open({ id: PANE_ID, title: PLAIN_TITLE })
}

// What an answered tick shows. The session's first front-desk answer opens the pane; later ones,
// a reload's included, retitle it only while it is open, so a pane the director closed stays
// closed. A session whose role is no longer the front desk's (a foreman known only from its
// first prompt) closes the pane and clears the status line.
async function show($: EngineInterface, answer: Answer, session: string, now: number) {
  const before = (await $.state.get(ROLE)).value
  if (answer.role !== undefined) await $.state.set(ROLE, answer.role)
  if (answer.role === FRONT_DESK && answer.pane !== undefined) {
    await $.state.set(PANE, { model: answer.pane, readAt: now })
    const title = answer.glance ?? PLAIN_TITLE
    if ((await $.state.get(OPENED)).value !== session) {
      await $.state.set(OPENED, session)
      await $.ui.open({ id: PANE_ID, title })
    } else if (await paneIsOpen($)) {
      await $.ui.open({ id: PANE_ID, title })
    }
    $.ui.status(answer.status)
  } else if (answer.role !== undefined && answer.role !== FRONT_DESK && before === FRONT_DESK) {
    if (await paneIsOpen($)) await $.ui.close({ id: PANE_ID })
    $.ui.status(undefined)
  }
}

async function runTick($: EngineInterface) {
  let every: number | undefined
  try {
    const [session, cwd, busy, surface] = await Promise.all([$.session.id(), $.session.root(), $.state.get(BUSY), $.state.get(SURFACE)])
    const answer = await ask($, { cmd: 'tick', session, cwd, idle: busy.value !== true, surface: surface.value ?? null }, { timeoutMs: TICK_ASK_MS })
    const now = await $.clock.now()
    if (answer === null || !answer.ok) {
      await $.state.set(TICK, { at: now, failed: true })
      await showOld($, session)
      return
    }
    every = answer.every
    await $.state.set(TICK, { at: now, failed: false })
    await show($, answer, session, now)
  } catch {
    // A tick that can't finish shows nothing new; the next one tries again.
  } finally {
    schedule($, every)
  }
}

// Whether the pane's model is older than STALE_TICKS ticks.
async function isOld($: EngineInterface) {
  const [kept, now] = await Promise.all([$.state.get(PANE), $.clock.now()])
  return kept.value !== undefined && now - kept.value.readAt > STALE_TICKS * TICK_MS
}

// One tick, unless the last one is still running; a tick that runs that long may leave the
// figures old, which the status line and the title then stop showing.
export async function tick($: EngineInterface) {
  if (running) {
    try {
      if (await isOld($)) await showOld($, await $.session.id())
    } catch {
      // The next time the timer fires asks again.
    }
    return
  }
  running = true
  try {
    await runTick($)
  } finally {
    running = false
  }
}

// The session's start: the pane opens with the session's first front-desk answer. The first
// tick isn't waited for, so the session starts at once.
export async function startPane($: EngineInterface, e: SessionStartInput) {
  stopTimer()
  try {
    await $.state.set(SURFACE, e.surface)
  } catch {
    // The tick goes without it.
  }
  try {
    await releaseAll($)
  } catch {
    // The buttons stay as they were.
  }
  void tick($)
}

// Whether the session is busy: only the main loop's turns count, not a subagent's.
export async function turnStarted($: EngineInterface, e: TurnStartInput) {
  if (e.agentId === undefined) await $.state.set(BUSY, true)
}

export async function turnEnded($: EngineInterface, e: TurnCompleteInput) {
  if (e.agentId === undefined) await $.state.set(BUSY, false)
}

// /wheelhouse: the director asked, so the pane opens at any width, titled with the glance. While
// what it shows is old, the title carries no figures and the answer says how old they are.
export async function openPane($: EngineInterface): Promise<{ text: string }> {
  try {
    const [pane, last, now] = await Promise.all([$.state.get(PANE), $.state.get(TICK), $.clock.now()])
    const kept = pane.value
    const glance = typeof kept?.model.glance === 'string' ? kept.model.glance : PLAIN_TITLE
    const stale = staleLine(kept, last.value, now)
    await $.ui.open({ id: PANE_ID, title: stale === null ? glance : PLAIN_TITLE })
    return { text: stale ?? glance }
  } catch {
    $.ui.toast(NOT_OPENED)
    return { text: NOT_OPENED }
  }
}

// The line above everything when what is shown is old: the last tick failed, or no tick has
// answered for more than STALE_TICKS ticks.
function staleLine(kept: { readAt: number } | undefined, last: { at: number, failed: boolean } | undefined, now: number): string | null {
  const failed = last?.failed === true
  if (kept === undefined) return failed ? `Couldn't read the latest at ${timeOf(last.at)}` : null
  if (!failed && now - kept.readAt <= STALE_TICKS * TICK_MS) return null
  return `Couldn't read the latest at ${timeOf(failed ? last.at : now)}; showing ${timeOf(kept.readAt)}'s`
}

// The pane: STOP or Lift STOP, the glance, STOP's line, the waiting cards one at a time with their
// buttons, the building, health and usage lines, what couldn't be read, and Settings; or the
// settings view. Every line is plain Text: a card's text is drawn whole, as written, and the
// bridge has made every other line one line of plain words.
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const [pane, last, shown, now, view, pressing] = await Promise.all([$.state.get(PANE), $.state.get(TICK), $.state.get(CARD), $.clock.now(), $.state.get(VIEW), pressingNow($)])
  // Busy is read only while it holds the buttons back, so a turn's start and end redraw nothing else.
  const live = !HIDE_WHILE_BUSY || (await $.state.get(BUSY)).value !== true
  const after = () => tick($)
  const kept = pane.value
  const model: PaneModel = isRecord(kept?.model) ? kept.model : {}
  const stale = staleLine(kept, last.value, now)
  if (kept === undefined) {
    return (
      <Box flexDirection="column">
        <Text>{stale ?? FIRST_READING}</Text>
      </Box>
    )
  }

  const health = records(model.health).filter((line) => typeof line.text === 'string')
  const stopLine = health.find((line) => line.of === 'stop')?.text
    ?? (isRecord(model.stop) && model.stop.on === true ? 'STOP is on' : null)
  const cards = records(model.cards).filter((card) => typeof card.text === 'string')
  const ids = cards.map((card, i) => (typeof card.id === 'string' ? card.id : `#${i}`))
  const at = Math.max(0, ids.indexOf(shown.value ?? ''))
  const card = cards[at]
  const before = ids[at - 1]
  const later = ids[at + 1]
  const usage = typeof model.usage === 'string' ? model.usage : null
  const top = await drawStop($, e, model, pressing, live, after)

  if (view.value === 'settings') {
    return (
      <Box flexDirection="column">
        {stale !== null && <Text bold>{stale}</Text>}
        {top}
        {drawSettings($, e, (await $.state.get(SETTINGS)).value, pressing, live)}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {stale !== null && <Text bold>{stale}</Text>}
      {top}
      <Text bold>{typeof model.glance === 'string' ? model.glance : PLAIN_TITLE}</Text>
      {typeof stopLine === 'string' && <Text>{stopLine}</Text>}
      {card !== undefined && <Text dimColor>{`Card ${at + 1} of ${cards.length}`}</Text>}
      {card !== undefined && drawCard($, e, card, pressing, live, after)}
      {live && cards.length > 1 && (
        <Box flexDirection="row">
          {before !== undefined && <Button key="back" label="Back" onPress={() => $.state.set(CARD, before)} />}
          {later !== undefined && <Button key="next" label="Next" onPress={() => $.state.set(CARD, later)} />}
        </Box>
      )}
      {strings(model.building).map((line) => <Text>{line}</Text>)}
      {health.filter((line) => line.of !== 'stop').map((line) => <Text>{line.text as string}</Text>)}
      {usage !== null && <Text>{usage}</Text>}
      {strings(model.missing).map((line) => <Text dimColor>{line}</Text>)}
      {live && <Button key="settings" label="Settings" onPress={() => showSettings($)} />}
    </Box>
  )
}
