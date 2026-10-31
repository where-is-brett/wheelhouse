// hooks/mod/pane.tsx
// The side pane and the status line, drawn from the bridge's tick. The mod decides nothing here:
// the bridge says the session's role, how often to tick, what the pane shows and what the status
// line says; the mod asks, keeps the answer in the session's state and draws it.
//
// A tick sends { cmd: 'tick', session, cwd, idle, surface }. In the front desk's session its
// answer holds the pane's model (scripts/mod/status.js), the glance and the status line; any
// other session's answer, a session still in setup's included, holds only its role and `every`.
// One tick runs at a time: a tick a press asks for while one runs follows it, once. A message
// kept out as traffic (hooks/mod/messages.ts) asks for a tick that says it was received,
// { received: { origin, via } } and never its text, so the bridge notes it. Those that come
// while a tick runs share the one follow-up tick, which lists them ({ received: [...] }), the
// newest MAX_WAITING of them.
// Each prompt an answer's `submit` holds (the courier's wake in the front desk's session, the
// watcher's lines in a Shape 2 foreman's) is handed on in order, once: the bridge has marked it
// handed, so the next answer doesn't hold it again. A courier's wake that can't be handed on is
// sent back as { cmd: 'unsent', session, cwd, ids, at } with the ids and the stamp the answer's
// `woken` and `wokeAt` named, so the bridge undoes its marks and the next idle tick wakes again.
// Its toast shows once for a run of such wakes in a session: again only after one is handed on or
// a turn starts. A watcher's line that can't be handed on is not tried again.
//
// The pane has two views: the board, with each card's buttons (hooks/mod/cards.tsx), and the
// settings (hooks/mod/settings.tsx). STOP or Lift STOP heads both. Everything is drawn by the
// functions of hooks/mod/calm.tsx.
import type { EngineInterface, RenderInput, SessionStartInput, TurnStartInput, TurnCompleteInput } from 'claude-code'
import { ask, type Answer, type PaneModel } from './ask'
import { PANE_ID, TICK_MS, STALE_TICKS, TICK_ASK_MS, STOP_HALTS, ONLY_YOU_LIFT, NOTHING_NEEDS_YOU, NOT_HANDED, NOT_HERE, SETTING_UP, staleLine as staleWords } from './numbers'
import { alarm, alert, bar, body, ends, footnote, group, panel, small, status, tableOf, title } from './calm'
import { drawCard, drawStop, pressSafekeeping, pressingNow, releaseAll, submitAll, NOT_HANDED_FOREMAN } from './cards'
import { drawSettings, forgetAsks, showSettings } from './settings'

// Whether every button, STOP included, is held back while a turn runs. Buttons stay live during a
// turn, since each press says at once that it was taken (design section 17.1); check 41 turns this
// on if a press made during a turn is lost in Desktop, and then they are drawn as "Wait for Claude
// to finish, or type stop" (cards.tsx WAIT) while a turn runs.
export const HIDE_WHILE_BUSY: boolean = false

const FRONT_DESK = 'front-desk'
const FOREMAN = 'foreman'
const SETUP = 'setup'
const NOT_OPENED = 'The pane didn\'t open. Type /wheelhouse to try again.'
const FIRST_READING = 'Reading how the project stands…'
// The pane's title while what it shows is old: no figures, so none is taken for current.
const PLAIN_TITLE = 'Wheelhouse'
// What /wheelhouse says, and opens nothing, where the last answered tick gave the session no pane
// (NOT_HERE and SETTING_UP are the set words, in numbers.ts).
const NO_PROJECT = 'This folder isn\'t a Wheelhouse project, so it has no pane'

const PANE = { plugin: 'wheelhouse', key: 'pane' } as const
const SAFEKEEPING_OPEN = { plugin: 'wheelhouse', key: 'safekeeping' } as const
const TICK = { plugin: 'wheelhouse', key: 'tick' } as const
const CARD = { plugin: 'wheelhouse', key: 'card' } as const
const BUSY = { plugin: 'wheelhouse', key: 'busy' } as const
const SURFACE = { plugin: 'wheelhouse', key: 'surface' } as const
const ROLE = { plugin: 'wheelhouse', key: 'role' } as const
const PICTURED = { plugin: 'wheelhouse', key: 'pictured' } as const
const OPENED = { plugin: 'wheelhouse', key: 'opened' } as const
const VIEW = { plugin: 'wheelhouse', key: 'view' } as const
const SETTINGS = { plugin: 'wheelhouse', key: 'settings' } as const
const UNHANDED = { plugin: 'wheelhouse', key: 'unhanded' } as const

// The module's own: the timer, whether a tick runs and whether a press or traffic asked for one
// meanwhile. A reload starts them over, with the session.start that follows it. Whether the pane
// has been opened is the session's, kept in its state, so a reload never opens a pane the
// director closed.
let timer: { every: number, cancel: () => void } | null = null
let running = false
let again = false
const waiting: Received[] = []
const MAX_WAITING = 50
// The ticks' prompts being handed on. A prompt waits behind a running turn, so they are handed
// on apart from the tick, which goes on ticking, and each tick's after the last tick's.
let handing: Promise<unknown> = Promise.resolve()

// A message kept out as traffic: the origin it arrived under and the hook that saw it.
export type Received = { origin: string, via: 'prompt' | 'receive' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
// The lines of what is building: each is a line of words, or, from the bridge now, { text, see }.
const buildingLines = (value: unknown): string[] => (Array.isArray(value)
  ? value.map((item) => (typeof item === 'string' ? item : isRecord(item) && typeof item.text === 'string' ? item.text : '')).filter((line) => line !== '')
  : [])
const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : [])

// "14:01" for `$.clock.now()`'s milliseconds, in the computer's own time zone: the mod's Date
// carries it, as node's does for the bridge.
function timeOf(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}`
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

// Opens the pane, or retitles it, once the session has a surface to draw on. The first
// ui.open of a session can run before the app has attached one; the call is then left for a
// later tick, and a no-surface refusal, should one come regardless, is quiet. Any other refusal
// passes on. Returns whether the pane was opened.
async function openOnSurface($: EngineInterface, title: string): Promise<boolean> {
  if ((await $.session.surfaces()).length === 0) return false
  try {
    await $.ui.open({ id: PANE_ID, title })
    return true
  } catch (error) {
    if (isNoSurface(error)) return false
    throw error
  }
}

function isNoSurface(error: unknown) {
  const { code, message } = error as { code?: unknown, message?: unknown }
  return code === 'no-surface' || (typeof message === 'string' && message.includes('no-surface'))
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
  if (await paneIsOpen($)) await openOnSurface($, PLAIN_TITLE)
}

// What an answered tick shows. The session's first front-desk answer opens the pane; later ones,
// a reload's included, retitle it only while it is open, so a pane the director closed stays
// closed. A session whose role is no longer the front desk's (a foreman known only from its
// first prompt, or a project whose folder setup is working on again) closes the pane and clears
// the status line; when the pane was open it forgets that it opened it, so a front-desk answer
// after it (setup finished) opens the pane again, while a pane the director closed stays closed.
// The picture, and whether the answer held one, are kept before the role, so /wheelhouse never
// reads a front-desk role with no picture as a folder outside a project.
async function show($: EngineInterface, answer: Answer, session: string, now: number) {
  const before = (await $.state.get(ROLE)).value
  if (answer.role === FRONT_DESK && answer.pane !== undefined) await $.state.set(PANE, { model: answer.pane, readAt: now })
  if (answer.role !== undefined) {
    await $.state.set(PICTURED, answer.pane !== undefined)
    await $.state.set(ROLE, answer.role)
  }
  if (answer.role === FRONT_DESK && answer.pane !== undefined) {
    const title = answer.glance ?? PLAIN_TITLE
    if ((await $.state.get(OPENED)).value !== session) {
      // Kept once the pane is open, or the open was refused: with no surface yet, the next tick
      // opens it; any other refusal is not retried every tick.
      try {
        if (await openOnSurface($, title)) await $.state.set(OPENED, session)
      } catch (error) {
        await $.state.set(OPENED, session)
        throw error
      }
    } else if (await paneIsOpen($)) {
      await openOnSurface($, title)
    }
    $.ui.status(answer.status)
  } else if (answer.role !== undefined && answer.role !== FRONT_DESK && before === FRONT_DESK) {
    // Only a pane the mod itself closes is forgotten: one the director closed stays closed.
    if (await paneIsOpen($)) {
      await $.ui.close({ id: PANE_ID })
      await $.state.set(OPENED, null)
    }
    $.ui.status(undefined)
  }
}

async function runTick($: EngineInterface, received?: Received | Received[]) {
  let every: number | undefined
  try {
    const [session, cwd, busy, surface] = await Promise.all([$.session.id(), $.session.root(), $.state.get(BUSY), $.state.get(SURFACE)])
    const answer = await ask($, { cmd: 'tick', session, cwd, idle: busy.value !== true, surface: surface.value ?? null, ...(received === undefined ? {} : { received }) }, { timeoutMs: TICK_ASK_MS })
    const now = await $.clock.now()
    if (answer === null || !answer.ok) {
      await $.state.set(TICK, { at: now, failed: true })
      await showOld($, session)
      return
    }
    every = answer.every
    const prompts = answer.submit ?? []
    if (prompts.length > 0) {
      handing = handing.then(() => (answer.role === FOREMAN ? submitAll($, prompts, NOT_HANDED_FOREMAN) : handWake($, answer, session, cwd))).catch(() => undefined)
    }
    await $.state.set(TICK, { at: now, failed: false })
    await show($, answer, session, now)
  } catch {
    // A tick that can't finish shows nothing new; the next one tries again.
  } finally {
    schedule($, every)
  }
}

// The courier's wake, handed on. One that can't be is sent back with the ids and the stamp the
// answer named, so the bridge undoes its marks; its toast shows only for the first of a run.
async function handWake($: EngineInterface, answer: Answer, session: string, cwd: string) {
  const unhanded = (await $.state.get(UNHANDED)).value === session
  if (await submitAll($, answer.submit ?? [], NOT_HANDED, unhanded)) {
    await $.state.set(UNHANDED, null)
    return
  }
  await $.state.set(UNHANDED, session)
  const ids = answer.woken ?? []
  if (ids.length > 0 && answer.wokeAt !== undefined) await ask($, { cmd: 'unsent', session, cwd, ids, at: answer.wokeAt })
}

// Whether the last answered tick said this is the front desk's session; false before any has.
export async function isFrontDesk($: EngineInterface): Promise<boolean> {
  return (await $.state.get(ROLE)).value === FRONT_DESK
}

// Whether the pane's model is older than STALE_TICKS ticks.
async function isOld($: EngineInterface) {
  const [kept, now] = await Promise.all([$.state.get(PANE), $.clock.now()])
  return kept.value !== undefined && now - kept.value.readAt > STALE_TICKS * TICK_MS
}

// One tick, unless the last one is still running. Then a press's or traffic's tick (`queued`)
// runs once that one ends, however many asked; the timer's waits for its next fire. A tick that
// runs long may leave the figures old: the status line and the title then stop showing them, and
// the pane is drawn again, so its line saying how old they are comes without a tick's answer.
export async function tick($: EngineInterface, queued = false, received?: Received | Received[]) {
  if (running) {
    if (queued) {
      if (received === undefined) again = true
      else {
        waiting.push(...(Array.isArray(received) ? received : [received]))
        if (waiting.length > MAX_WAITING) waiting.splice(0, waiting.length - MAX_WAITING)
      }
    }
    try {
      if (await isOld($)) {
        await showOld($, await $.session.id())
        $.ui.invalidate('ui.render')
      }
    } catch {
      // The next time the timer fires asks again.
    }
    return
  }
  running = true
  try {
    await runTick($, received)
  } finally {
    running = false
  }
  if (waiting.length > 0) {
    const listed = waiting.splice(0)
    again = false
    await tick($, false, listed.length === 1 ? listed[0] : listed)
  } else if (again) {
    again = false
    await tick($)
  }
}

// The session's start: the pane opens with the session's first front-desk answer. The first
// tick isn't waited for, so the session starts at once.
export async function startPane($: EngineInterface, e: SessionStartInput) {
  stopTimer()
  again = false
  waiting.length = 0
  try {
    await $.state.set(SURFACE, e.surface)
  } catch {
    // The tick goes without it.
  }
  try {
    await releaseAll($)
    await forgetAsks($)
  } catch {
    // The buttons stay as they were.
  }
  void tick($)
}

// Whether the session is busy: only the main loop's turns count, not a subagent's.
export async function turnStarted($: EngineInterface, e: TurnStartInput) {
  if (e.agentId === undefined) {
    await $.state.set(BUSY, true)
    await $.state.set(UNHANDED, null)
  }
}

export async function turnEnded($: EngineInterface, e: TurnCompleteInput) {
  if (e.agentId === undefined) await $.state.set(BUSY, false)
}

// Why the session has no pane, from the last answered tick, or null when it has one or no tick
// has answered yet: another role's session, a folder setup is working on, or a front desk outside
// a project (its answer held no picture). A tick that failed since leaves the reason as it was.
async function noPane($: EngineInterface, kept: unknown): Promise<string | null> {
  const [role, pictured] = await Promise.all([$.state.get(ROLE), $.state.get(PICTURED)])
  if (role.value === undefined) return null
  if (role.value === SETUP) return SETTING_UP
  if (role.value !== FRONT_DESK) return NOT_HERE
  return kept === undefined && pictured.value === false ? NO_PROJECT : null
}

// /wheelhouse: the director asked, so the pane opens at any width, titled with the glance. While
// what it shows is old, the title carries no figures and the answer says how old they are. A
// session the bridge gave no pane opens none, and the answer says why.
export async function openPane($: EngineInterface): Promise<{ text: string }> {
  try {
    const [pane, last, now] = await Promise.all([$.state.get(PANE), $.state.get(TICK), $.clock.now()])
    const kept = pane.value
    const why = await noPane($, kept)
    if (why !== null) return { text: why }
    const glance = typeof kept?.model.glance === 'string' ? kept.model.glance : PLAIN_TITLE
    const stale = staleLine(kept, last.value, now)
    // With no surface yet the pane can't open, and the director who asked is told so.
    if (!(await openOnSurface($, stale === null ? glance : PLAIN_TITLE))) throw new Error('no surface is attached')
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
  // With nothing read yet, only when the failure was: the set line without its showing.
  if (kept === undefined) return failed ? staleWords(timeOf(last.at), '').split(' Showing')[0] : null
  if (!failed && now - kept.readAt <= STALE_TICKS * TICK_MS) return null
  return staleWords(timeOf(failed ? last.at : now), timeOf(kept.readAt))
}


const STOP_IS_ON = 'All stop is on'
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
// The "hh:mm" in a line such as "Since you were last here at 09:10."
const timeIn = (line: unknown): string | null => (typeof line === 'string' ? /\b(\d{2}:\d{2})\b/.exec(line)?.[1] ?? null : null)

// When STOP began, in words: the bridge's All stop line ("All stop is on, since 19 October 2026", or the older "STOP is on") without
// its lead, else the start the model carries, as a time.
function stopSince(model: PaneModel, line: string | null): string | null {
  const rest = line?.replace(/^(?:All stop|STOP) is on,?\s*/, '') ?? ''
  if (rest !== '') return rest.charAt(0).toUpperCase() + rest.slice(1)
  const at = isRecord(model.stop) && typeof model.stop.since === 'string' ? Date.parse(model.stop.since) : NaN
  return Number.isNaN(at) ? null : `Since ${timeOf(at)}`
}

// The next card's subject, with its optional mark: "Next: how files are named · optional · 3 min".
function nextLine(card: Record<string, unknown>): string {
  const parts = isRecord(card.parts) ? card.parts : {}
  const subject = text(parts.ask) ?? text(card.header) ?? String(card.text).split('\n')[0]
  const minutes = count(parts.optional)
  return `Next: ${subject}${minutes !== null && minutes > 0 ? ` · optional · ${minutes} min` : ''}`
}

// The pane, top to bottom (design section 23.3): the line saying what is shown is old; STOP, or
// the STOP is on group; the verdict; the card, with the next card's subject and Back and Next;
// what is being built; launch; health and this week; and the foot, whose Settings is the only button on the board view (the settings view has its own Done). Each is a group, and an empty
// one is left out. Every line is plain Text: a card's text is drawn whole, as written, and the
// bridge has made every other line one line of plain words. Or the settings view.
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const t = tableOf($, e)
  const { Box } = t
  const [pane, last, shown, now, view, pressing] = await Promise.all([$.state.get(PANE), $.state.get(TICK), $.state.get(CARD), $.clock.now(), $.state.get(VIEW), pressingNow($)])
  // Busy is read only while it holds the buttons back, so a turn's start and end redraw nothing else.
  const live = !HIDE_WHILE_BUSY || (await $.state.get(BUSY)).value !== true
  const after = () => tick($, true)
  const kept = pane.value
  const model: PaneModel = isRecord(kept?.model) ? kept.model : {}
  const stale = staleLine(kept, last.value, now)
  const staleNode = stale !== null && alert(t, stale)
  // Before the first picture, STOP heads the pane, as STOP needs only the session's folder. Once a
  // tick has given the session no pane (another role's, setup's included, or a front desk outside
  // a project), a pane /wheelhouse opened before it says why, with no STOP, as /wheelhouse would.
  if (kept === undefined) {
    const why = await noPane($, kept)
    if (why !== null) {
      return (
        <Box flexDirection="column">
          {body(t, why)}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap="sm">
          {await drawStop($, e, {}, pressing, live, after)}
          {footnote(t, STOP_HALTS)}
        </Box>
        {body(t, stale ?? FIRST_READING)}
      </Box>
    )
  }

  const health = records(model.health).filter((line) => typeof line.text === 'string')
  const stopLine = health.find((line) => line.of === 'stop')?.text as string | undefined ?? null
  const cards = records(model.cards).filter((card) => typeof card.text === 'string')
  const ids = cards.map((card, i) => (typeof card.id === 'string' ? card.id : `#${i}`))
  const at = Math.max(0, ids.indexOf(shown.value ?? ''))
  const card = cards[at]
  const before = ids[at - 1]
  const later = ids[at + 1]
  const control = await drawStop($, e, model, pressing, live, after)
  const stopOn = isRecord(model.stop) && model.stop.on === true

  // STOP with what it does beside it, at the right on the board and at the left above the settings'
  // filled Done; or, while it is on, the panel that leads the pane.
  const stopPart = stopOn
    ? alarm(t, [
      title(t, STOP_IS_ON),
      stopSince(model, stopLine) !== null && body(t, stopSince(model, stopLine) as string),
      ends(t, footnote(t, ONLY_YOU_LIFT), control),
    ])
    : (
      <Box flexDirection={view.value === 'settings' ? 'row' : 'row-reverse'} justifyContent={view.value === 'settings' ? 'flex-start' : 'space-between'} alignItems="center" gap="sm">
        {control}
        {footnote(t, STOP_HALTS)}
      </Box>
    )

  if (view.value === 'settings') {
    return (
      <Box flexDirection="column" gap="lg">
        {staleNode}
        {stopPart}
        {await drawSettings($, e, (await $.state.get(SETTINGS)).value, pressing, live, now)}
      </Box>
    )
  }

  const verdict = text(model.verdict) ?? text(model.glance) ?? PLAIN_TITLE
  const since = text(model.since)

  // The card on the first panel, with its place: a card of parts says it in its own header row, one
  // with none above it. With no card, the words the verdict hasn't already said.
  const cardPart = card !== undefined
    ? (
      <Box flexDirection="column" gap="xs">
        {panel(t, [
          !isRecord(card.parts) && footnote(t, `Card ${at + 1} of ${cards.length}`),
          await drawCard($, e, card, `${at + 1} of ${cards.length}`, pressing, live, after),
        ])}
        {ends(t, later !== undefined && footnote(t, nextLine(cards[at + 1])), live && cards.length > 1 && (
          <Box flexDirection="row" gap="sm">
            {before !== undefined && small(t, 'back', 'Back', () => $.state.set(CARD, before))}
            {later !== undefined && small(t, 'next', 'Next', () => $.state.set(CARD, later))}
          </Box>
        ))}
      </Box>
    )
    : !verdict.startsWith(NOTHING_NEEDS_YOU) && status(t, NOTHING_NEEDS_YOU, 'success')

  const building = (Array.isArray(model.building) ? model.building : [])
    .map((item) => (typeof item === 'string' ? { text: item, see: null } : isRecord(item) ? { text: text(item.text), see: text(item.see) } : { text: null, see: null }))
    .filter((item) => item.text !== null)
  const buildingPart = building.length > 0 && group(t, building.map((item) => (
    <Box flexDirection="column">
      {body(t, item.text as string)}
      {item.see !== null && footnote(t, item.see)}
    </Box>
  )), 'Being built')

  const launch = isRecord(model.launch) ? model.launch : null
  const resolved = count(launch?.resolved)
  const total = count(launch?.total)
  const gained = count(launch?.gained)
  const upNext = launch !== null && Array.isArray(launch.next) ? records(launch.next).filter((n) => typeof n.text === 'string') : []
  const launchPart = launch !== null && resolved !== null && total !== null && group(t, [
    (
      <Box flexDirection="column" gap="xs">
        {ends(t, body(t, `${resolved} of ${total} blockers cleared`), gained !== null && gained > 0 && footnote(t, `+${gained} since ${timeIn(since) ?? 'you were last here'}`))}
        {bar(t, resolved, total)}
      </Box>
    ),
    upNext.length > 0 && (
      <Box flexDirection="column" gap="xs">
        {footnote(t, 'What\'s next')}
        {upNext.map((n) => body(t, n.yours === true ? `${n.text as string} (yours)` : (n.text as string)))}
      </Box>
    ),
  ], 'Launch')

  const note = isRecord(model.healthNote) ? model.healthNote : {}
  const watch = health.filter((line) => line.of !== 'stop' && (line.level === 'watch' || line.level === 'stop'))
  const ideas = isRecord(model.ideas) ? model.ideas : null
  const ideasCount = count(ideas?.count)
  const fresh = count(ideas?.fresh)
  const protection = text(note.protection)
  const week = text(note.week)
  const usage = text(model.usage)
  const missing = strings(model.missing)
  const safe = isRecord(model.safekeeping) && typeof model.safekeeping.line === 'string' ? model.safekeeping : null
  const safeOpen = safe !== null && (await $.state.get(SAFEKEEPING_OPEN)).value === true
  const safeActions = safe !== null && Array.isArray(safe.actions) ? records(safe.actions).filter((a) => typeof a.action === 'string' && typeof a.label === 'string') : []
  const safeRow = safe !== null && (
    <Box flexDirection="column" gap="xs">
      {ends(t, body(t, `Safekeeping: ${safe.line as string}`), small(t, 'safekeeping', safeOpen ? 'Hide' : 'Details', () => $.state.set(SAFEKEEPING_OPEN, !safeOpen)))}
      {safeOpen && typeof safe.detail === 'string' && footnote(t, safe.detail)}
      {safeOpen && live && safeActions.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" gap="sm">
          {safeActions.map((a) => small(t, a.action as string, a.label as string, () => pressSafekeeping($, a.action as string, after)))}
        </Box>
      )}
    </Box>
  )
  const healthRows = [
    note.allWell === true && status(t, 'All well', 'success'),
    ...watch.map((line) => status(t, 'To watch', 'warning', line.text as string)),
    safeRow,
    protection !== null && body(t, `Protection: ${protection}`),
    // The week's share once: the health note's, else the usage line of a model without one.
    (week ?? usage) !== null && body(t, (week ?? usage) as string),
    ideasCount !== null && ideasCount > 0 && body(t, `${ideasCount} ${ideasCount === 1 ? 'idea' : 'ideas'}${fresh !== null && fresh > 0 ? ` · ${fresh} new since yesterday` : ''}`),
    ...missing.map((line) => footnote(t, line)),
  ].filter((row) => row !== false)
  const healthPart = healthRows.length > 0 && group(t, healthRows, 'Health and this week')

  const updated = text(model.updated)
  const footPart = ends(t, live && small(t, 'settings', 'Settings', () => showSettings($)), updated !== null && footnote(t, `Updated ${updated}`))

  return (
    <Box flexDirection="column" gap="lg">
      {staleNode}
      {stopPart}
      <Box flexDirection="column">
        {title(t, verdict)}
        {since !== null && footnote(t, since)}
      </Box>
      {cardPart}
      {buildingPart}
      {launchPart}
      {healthPart}
      {footPart}
    </Box>
  )
}
