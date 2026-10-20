// tests/mod/pane.test.ts
// The side pane and the status line, run by `claude plugin test .` (npm run mod-check). The
// bridge's tick answers come from `$.process.run`, answered here; so do the panes the engine
// keeps open, the status line and the clock. The mod's own rules are the bridge's: these tests
// check only that the mod draws what the bridge answered, when it asks and what it keeps.
import { test, expect, mock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/Users/someone/projects/shop'
// Each session start in a test is a new session unless it says otherwise: the session's state is
// the test's, kept across starts, as it is across a reload.
const SESSION = '0b6a4e1c-4f3a-4d7e-9a51-2f3c8d9e1a77'
const PANE_ID = 'wheelhouse'
const TICK_MS = 15000
const TICK_ASK_MS = 50000
// 03:00:50 UTC on 19 October 2026, so a tick fifteen seconds on reads a minute later.
const START = Date.parse('2026-10-19T03:00:50.000Z')
const RUN_RESULT = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const CONTEXT = { window: 200000, tokens: 1000, percent: 0.5 }
const PANE_PROPS = {
  title: 'Wheelhouse', isFocused: false, bodyColumns: 48, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}

// A card's text is drawn exactly as written, so these hold what Markdown would change.
const FIRST = 'Merge **the banner** change? See [the preview](https://example.com/p).'
const SECOND = 'Which colour for the button?\n# Red\n- or blue'

const model = (glance: string) => ({
  v: 1,
  project: 'shop',
  at: '2026-10-19T03:00:50.000Z',
  glance,
  stop: { on: true, since: '2026-10-19T02:00:00.000Z' },
  cards: [
    { id: 'card-1', n: 1, header: 'Approve', kind: 'approve', text: FIRST, hash: 'aaaaaaaaaaaa', buttons: [{ label: 'Approve', does: 'record' }], note: null, blocking: false, asked: false },
    { id: 'card-2', n: 2, header: 'Question', kind: 'question', text: SECOND, hash: 'bbbbbbbbbbbb', buttons: [], note: null, blocking: false, asked: true },
  ],
  building: ['Building the banner, slice 1 of 3'],
  health: [
    { level: 'watch', text: 'CI is failing on main', of: null },
    { level: 'stop', text: 'STOP is on, since 19 October 2026', of: 'stop' },
  ],
  usage: 'Usage: 23% of the five-hour window',
  finished: [],
  incidents: [],
  watcher: 'running',
  missing: ['The helper isn\'t answering'],
})

const frontDesk = (glance: string) => ({ ok: true, role: 'front-desk', every: TICK_MS, pane: model(glance), glance, status: glance })

type Reply = object | { exitCode: number } | { hold: number, then: object }

// Registers the world beneath the mod and returns what it saw. `answer` gives the bridge's
// answer to each tick: an answer object, a non-zero exit, or one held on the clock first.
function world(on: any, answer: (request: any) => Reply) {
  const clock = mock.clock(on, { now: START })
  const panes = new Map<string, string>()
  const current = { session: SESSION }
  // The surfaces the session has attached, and how ui.open answers: a refusal's words, or with
  // `unplaced` the engine's resolved no-surface answer.
  const attached = { surfaces: ['a surface'] as string[], refuseOpen: null as string | null, unplaced: false }
  let sessions = 0
  const seen = { ticks: [] as any[], opens: [] as any[], closes: [] as string[], statuses: [] as (string | undefined)[], registered: [] as any[], toasts: [] as string[] }
  on('session.id', () => ({ value: current.session }))
  on('session.root', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXT, rateLimits: [], cost: undefined } }))
  on('command.register', ($: any, e: any) => { seen.registered.push(e); return { value: { command: e.name } } })
  on('ui.toast', ($: any, e: any) => { seen.toasts.push(e.text); return { value: undefined } })
  on('session.surfaces', () => ({ value: attached.surfaces }))
  on('ui.open', ($: any, e: any) => {
    if (attached.refuseOpen !== null) return { deny: attached.refuseOpen }
    seen.opens.push(e)
    panes.set(e.id, e.title ?? e.id)
    if (attached.unplaced) return { value: { isPlaced: false, reason: 'no-surface: no surface is attached' } }
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($: any, e: any) => { seen.closes.push(e.id); panes.delete(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [...panes].map(([id, title]) => ({ id, title, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.status', ($: any, e: any) => { seen.statuses.push(e.text); return { value: undefined } })
  on('process.run', async ($: any, e: any) => {
    const request = JSON.parse(e.init?.stdin ?? 'null')
    if (request?.cmd !== 'tick') return { value: { ...RUN_RESULT, stdout: '{"ok":true}\n' } }
    seen.ticks.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs, request })
    let got: any = answer(request)
    if (got.hold !== undefined) {
      await clock.sleep(got.hold)
      got = got.then
    }
    if (got.exitCode !== undefined) return { value: { ...RUN_RESULT, exitCode: got.exitCode, stdout: '' } }
    return { value: { ...RUN_RESULT, stdout: `${JSON.stringify(got)}\n` } }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('command.run', () => ({ text: 'the engine ran it' }))
  const clear = () => { for (const list of Object.values(seen)) list.length = 0 }
  // A new session's id.
  const newSession = () => { sessions += 1; current.session = `${SESSION}-${sessions}` }
  // Starts a new session (or, given `again`, the same one, as a reload does) and lets its first
  // tick finish.
  const start = async ($: any, surface: string, again = false) => {
    clear()
    if (!again) newSession()
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
  }
  return { seen, clear, start, clock, panes, current, newSession, attached }
}

// "14:01" for the clock's milliseconds, as the pane says a time: in the computer's own time zone,
// worked out here from the zone's offset rather than the local clock readings the mod uses.
const timeOf = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(11, 16)

const mount = ($: any, surface: string) => $.ui.mount({ plugin: 'wheelhouse', surface, component: 'Pane', requestId: PANE_ID, props: PANE_PROPS })
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)

test('the front desk\'s session opens the pane and sets the status line from the first tick', async ($, on) => {
  let reply: object = frontDesk('2 cards wait')
  const { seen, clear, start, clock, current } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk('2 cards wait')
    await start($, surface)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.ticks[0].argv[0]).toBe('node')
    expect(seen.ticks[0].argv[1]).toEndWith('/scripts/mod/bridge.js')
    expect(seen.ticks[0].timeoutMs).toBe(TICK_ASK_MS)
    expect(seen.ticks[0].request).toEqual({ cmd: 'tick', session: current.session, cwd: ROOT, idle: true, surface })
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
    expect(seen.statuses).toEqual(['2 cards wait'])

    // The next tick, a turn running: it says the session is busy, retitles the open pane and
    // sets the status line again.
    clear()
    reply = frontDesk('1 card waits')
    await $.turn.start({ turnId: 't1', text: 'hello' })
    await clock.advance(TICK_MS)
    expect(seen.ticks.map((t: any) => t.request)).toEqual([{ cmd: 'tick', session: current.session, cwd: ROOT, idle: false, surface }])
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '1 card waits' }])
    expect(seen.statuses).toEqual(['1 card waits'])

    // The turn's end makes the session idle again; a subagent's turn changes nothing.
    clear()
    await $.turn.start({ turnId: 't2', text: '', agentId: 'agent-1' })
    await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
    await clock.advance(TICK_MS)
    expect(seen.ticks.map((t: any) => t.request.idle)).toEqual([true])
    await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, reason: 'answer', agentId: 'agent-1' })

    // An answer with no status (the terminal's own status line shows the glance) clears the line.
    clear()
    const { status, ...withoutStatus } = frontDesk('1 card waits')
    expect(status).toBe('1 card waits')
    reply = withoutStatus
    await clock.advance(TICK_MS)
    expect(seen.statuses).toEqual([undefined])
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '1 card waits' }])
  }
})

test('the pane draws each card\'s text as plain text, one card at a time', async ($, on) => {
  const { start } = world(on, () => frontDesk('2 cards wait'))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    const drawn = await texts(ui)
    // The glance, STOP's line, the card, then the building, health and usage lines, then what
    // couldn't be read.
    expect(drawn).toEqual([
      '2 cards wait',
      'STOP is on, since 19 October 2026',
      'Card 1 of 2',
      FIRST,
      'Building the banner, slice 1 of 3',
      'CI is failing on main',
      'Usage: 23% of the five-hour window',
      'The helper isn\'t answering',
    ])
    expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(0)
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    expect((await ui.find({ key: 'next' }))?.type).toBe('Button')

    await ui.press({ key: 'next' })
    const second = await texts(ui)
    expect(second).toContain('Card 2 of 2')
    expect(second).toContain(SECOND)
    expect(second).not.toContain(FIRST)
    expect(await ui.find({ key: 'next' })).toBeUndefined()

    await ui.press({ key: 'back' })
    expect(await texts(ui)).toContain(FIRST)
    expect(await texts(ui)).toContain('Card 1 of 2')
    await ui.unmount()
  }
})

test('a failed tick shows the last picture under a line saying it is old', async ($, on) => {
  let reply: Reply = frontDesk('2 cards wait')
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk('2 cards wait')
    await start($, surface)
    const read = clock.now()
    const ui = await mount($, surface)
    expect((await texts(ui)).some((t: string) => t.startsWith('Couldn\'t read'))).toBe(false)

    // The bridge fails: the picture stays, under the line. The status line is cleared and the
    // pane's title holds no figures, so neither shows old figures as current.
    clear()
    reply = { exitCode: 1 }
    await clock.advance(TICK_MS)
    const failed = clock.now()
    expect(seen.ticks).toHaveLength(1)
    await ui.redraw()
    const drawn = await texts(ui)
    expect(drawn[0]).toBe(`Couldn't read the latest at ${timeOf(failed)}; showing ${timeOf(read)}'s`)
    // The clock starts at 03:00:50 UTC, so the first surface's times are these, in the computer's
    // zone (14:01 and 14:00 in Sydney's summer), never named as UTC.
    if (surface === SURFACES[0]) {
      const offset = new Date(START).getTimezoneOffset()
      const local = (utcMinutes: number) => {
        const m = (((utcMinutes - offset) % 1440) + 1440) % 1440
        return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      }
      expect(drawn[0]).toBe(`Couldn't read the latest at ${local(3 * 60 + 1)}; showing ${local(3 * 60)}'s`)
      expect(drawn[0]).not.toContain('UTC')
    }
    expect(drawn.slice(1)).toContain('2 cards wait')
    expect(drawn.slice(1)).toContain(FIRST)
    expect(seen.statuses).toEqual([undefined])
    expect(seen.opens).toEqual([{ id: PANE_ID, title: 'Wheelhouse' }])
    // /wheelhouse says the same.
    const asked = await $.command.run({ command: 'wheelhouse', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(asked).toMatchObject({ text: drawn[0] })
    expect(seen.opens.at(-1)).toEqual({ id: PANE_ID, title: 'Wheelhouse' })

    // An answer that says it failed is a failed tick too, and the timer keeps its pace.
    clear()
    reply = { ok: false, says: 'Wheelhouse couldn\'t do that in time' }
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.statuses).toEqual([undefined])
    await ui.redraw()
    expect((await texts(ui))[0]).toBe(`Couldn't read the latest at ${timeOf(clock.now())}; showing ${timeOf(read)}'s`)

    // The next answer clears the line and sets the status line and the title again.
    clear()
    reply = frontDesk('2 cards wait')
    await clock.advance(TICK_MS)
    const reread = clock.now()
    await ui.redraw()
    expect((await texts(ui))[0]).toBe('2 cards wait')
    expect(seen.statuses).toEqual(['2 cards wait'])
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])

    // A tick that never answers leaves the picture to grow old: past three ticks the pane says
    // so, and the status line and the title stop showing its figures.
    reply = { hold: 4 * TICK_MS, then: frontDesk('2 cards wait') }
    await clock.advance(TICK_MS)
    await ui.redraw()
    expect((await texts(ui))[0]).toBe('2 cards wait')
    clear()
    await clock.advance(2 * TICK_MS)
    await ui.redraw()
    expect((await texts(ui))[0]).toBe('2 cards wait')
    expect(seen.statuses).toEqual([])
    await clock.advance(TICK_MS)
    await ui.redraw()
    expect((await texts(ui))[0]).toBe(`Couldn't read the latest at ${timeOf(clock.now())}; showing ${timeOf(reread)}'s`)
    expect(seen.statuses).toEqual([undefined])
    expect(seen.opens).toEqual([{ id: PANE_ID, title: 'Wheelhouse' }])
    reply = frontDesk('2 cards wait')
    await clock.advance(2 * TICK_MS)
    await ui.unmount()
  }
})

test('a pane the director closed is not opened again by a tick', async ($, on) => {
  let glance = '2 cards wait'
  const { seen, clear, start, clock, panes } = world(on, () => frontDesk(glance))
  for (const surface of SURFACES) {
    glance = '2 cards wait'
    await start($, surface)
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])

    clear()
    panes.delete(PANE_ID)
    glance = '1 card waits'
    await clock.advance(TICK_MS)
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(2)
    expect(seen.opens).toEqual([])
    expect(seen.statuses).toEqual(['1 card waits', '1 card waits'])

    // A reload starts the module again, and session.start with it, in the same session: the
    // closed pane stays closed.
    await start($, surface, true)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.opens).toEqual([])
    expect(seen.statuses).toEqual(['1 card waits'])
    await clock.advance(TICK_MS)
    expect(seen.opens).toEqual([])
  }
})

test('a tick never starts while the last one runs', async ($, on) => {
  let reply: Reply = frontDesk('2 cards wait')
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk('2 cards wait')
    await start($, surface)
    clear()
    // The next tick takes forty seconds: the two times the timer fires meanwhile start nothing.
    reply = { hold: 40000, then: frontDesk('1 card waits') }
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    reply = frontDesk('Nothing waits')
    await clock.advance(TICK_MS)
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.statuses).toEqual([])
    await clock.advance(10000)
    expect(seen.statuses).toEqual(['1 card waits'])
    // Once it has answered, the next time the timer fires starts the next tick.
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(2)
    expect(seen.statuses).toEqual(['1 card waits', 'Nothing waits'])
  }
})

test('a feature session opens nothing and stops ticking', async ($, on) => {
  let reply: object = { ok: true, role: 'feature', every: 0 }
  const { seen, start, clock } = world(on, () => reply)
  // A front desk outside a project has no pane, and stops ticking too.
  for (const answer of [{ ok: true, role: 'feature', every: 0 }, { ok: true, role: 'front-desk', every: 0 }]) {
    for (const surface of SURFACES) {
      reply = answer
      await start($, surface)
      expect(seen.ticks).toHaveLength(1)
      await clock.advance(4 * TICK_MS)
      expect(seen.ticks).toHaveLength(1)
      expect(seen.opens).toEqual([])
      expect(seen.closes).toEqual([])
      expect(seen.statuses).toEqual([])
    }
  }
})

test('a session that turns out to be the foreman closes its pane', async ($, on) => {
  let reply: Reply = frontDesk('2 cards wait')
  const { seen, clear, start, clock, panes } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk('2 cards wait')
    await start($, surface)
    expect(seen.opens).toHaveLength(1)

    // The foreman's first prompt arrived after the first tick: the next tick says foreman.
    clear()
    reply = { ok: true, role: 'foreman', every: 30000, submit: [] }
    await clock.advance(TICK_MS)
    expect(seen.closes).toEqual([PANE_ID])
    expect(panes.has(PANE_ID)).toBe(false)
    expect(seen.statuses).toEqual([undefined])
    expect(seen.opens).toEqual([])

    // Its ticks now come at the foreman's pace, and open nothing.
    clear()
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(0)
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.opens).toEqual([])
    expect(seen.closes).toEqual([])
    expect(seen.statuses).toEqual([])
  }
})

// A session in a folder setup is working on: the bridge answers it as setup's (ruling 38).
const setup = { ok: true, role: 'setup', every: TICK_MS }

// Each surface in a test of its own, so the session's state holds no role from an earlier answer.
for (const surface of SURFACES) {
  test(`a session still in setup draws nothing and keeps ticking, and its first front-desk answer opens the pane (${surface})`, async ($, on) => {
    let reply: object = setup
    const { seen, clear, start, clock, panes } = world(on, () => reply)
    await start($, surface)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.opens).toEqual([])
    expect(seen.closes).toEqual([])
    expect(seen.statuses).toEqual([])
    // It ticks every TICK_MS, and nothing is drawn.
    for (let i = 2; i <= 4; i += 1) {
      await clock.advance(TICK_MS)
      expect(seen.ticks).toHaveLength(i)
    }
    expect(seen.opens).toEqual([])
    expect(seen.closes).toEqual([])
    expect(seen.statuses).toEqual([])
    expect(panes.has(PANE_ID)).toBe(false)
    // The pane, if mounted, shows only why there is no pane yet, and no buttons.
    const ui = await mount($, surface)
    expect(await texts(ui)).toEqual(['This project is still being set up: its pane opens once setup finishes'])
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()

    // Setup finishes: the next tick answers the front desk, and the pane opens as at a front
    // desk's session start.
    clear()
    reply = frontDesk('2 cards wait')
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
    expect(seen.statuses).toEqual(['2 cards wait'])
    clear()
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
  })
}

test('a front desk whose folder goes back into setup closes its pane and clears the status line, and opens it again after', async ($, on) => {
  let reply: object = frontDesk('2 cards wait')
  const { seen, clear, start, clock, panes } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk('2 cards wait')
    await start($, surface)
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])

    // A setup run starts for the folder: the pane closes and the status line is cleared, and the
    // timer keeps its interval.
    clear()
    reply = setup
    await clock.advance(TICK_MS)
    expect(seen.closes).toEqual([PANE_ID])
    expect(panes.has(PANE_ID)).toBe(false)
    expect(seen.statuses).toEqual([undefined])
    clear()
    await clock.advance(TICK_MS)
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(2)
    expect(seen.opens).toEqual([])
    expect(seen.closes).toEqual([])
    expect(seen.statuses).toEqual([])

    // Setup finishes: the pane the mod closed opens again, as setup's end is the session's start
    // as the front desk.
    clear()
    reply = frontDesk('1 card waits')
    await clock.advance(TICK_MS)
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '1 card waits' }])
    expect(seen.statuses).toEqual(['1 card waits'])

    // A pane the director then closes stays closed.
    clear()
    panes.delete(PANE_ID)
    await clock.advance(TICK_MS)
    expect(seen.opens).toEqual([])
  }
})

test('a pane the director closed stays closed through a setup run and after it', async ($, on) => {
  let reply: object = frontDesk('2 cards wait')
  const { seen, clear, start, clock, panes } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk('2 cards wait')
    await start($, surface)
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])

    // The director closes the pane; then a setup run starts for the folder: there is nothing for
    // the mod to close.
    panes.delete(PANE_ID)
    clear()
    reply = setup
    await clock.advance(TICK_MS)
    expect(seen.closes).toEqual([])
    expect(seen.statuses).toEqual([undefined])

    // Setup finishes: the pane the director closed stays closed.
    clear()
    reply = frontDesk('1 card waits')
    await clock.advance(TICK_MS)
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(2)
    expect(seen.opens).toEqual([])
    expect(panes.has(PANE_ID)).toBe(false)
    expect(seen.statuses).toEqual(['1 card waits', '1 card waits'])
  }
})

test('session start does not wait for the first tick', async ($, on) => {
  let reply: Reply = { hold: 60000, then: frontDesk('2 cards wait') }
  const { seen, clear, clock, newSession } = world(on, () => reply)
  for (const surface of SURFACES) {
    clear()
    reply = { hold: 60000, then: frontDesk('2 cards wait') }
    newSession()
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
    expect(seen.ticks).toHaveLength(1)
    expect(seen.opens).toEqual([])
    expect(seen.statuses).toEqual([])
    await clock.advance(60000)
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
    expect(seen.statuses).toEqual(['2 cards wait'])
  }
  // A first tick that fails still leaves the timer running, so the pane opens with the next.
  for (const surface of SURFACES) {
    clear()
    reply = { exitCode: 1 }
    newSession()
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
    expect(seen.opens).toEqual([])
    reply = frontDesk('2 cards wait')
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(2)
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
  }
})

test('/wheelhouse opens the pane', async ($, on) => {
  const { seen, clear, start, panes } = world(on, () => frontDesk('2 cards wait'))
  for (const surface of SURFACES) {
    await start($, surface)
    expect(seen.registered).toContainEqual({ name: 'wheelhouse', description: 'Open Wheelhouse\'s pane' })
    panes.delete(PANE_ID)
    clear()
    const result = await $.command.run({ command: 'wheelhouse', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
    expect(result).toMatchObject({ text: '2 cards wait' })
    expect(seen.ticks).toHaveLength(0)
  }
})

test('the stale line comes by itself while a tick hangs', async ($, on) => {
  let reply: Reply = frontDesk('2 cards wait')
  const { start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk('2 cards wait')
    await start($, surface)
    const read = clock.now()
    const ui = await mount($, surface)
    expect((await texts(ui))[0]).toBe('2 cards wait')
    // The next tick hangs for 48 seconds, within the most the mod waits for one (TICK_ASK_MS, 50
    // seconds). Nothing is drawn again by the test: the pane redraws itself once the picture is
    // more than three ticks old, at the timer's fire while that tick still runs.
    reply = { hold: 48000, then: frontDesk('2 cards wait') }
    await clock.advance(3 * TICK_MS)
    expect((await texts(ui))[0]).toBe('2 cards wait')
    await clock.advance(TICK_MS)
    expect((await texts(ui))[0]).toBe(`Couldn't read the latest at ${timeOf(clock.now())}; showing ${timeOf(read)}'s`)
    // The tick's answer clears it.
    reply = frontDesk('2 cards wait')
    await clock.advance(3000)
    expect((await texts(ui))[0]).toBe('2 cards wait')
    await clock.advance(TICK_MS)
    await ui.unmount()
  }
})

// What /wheelhouse says where the session has no pane of its own.
const NOT_HERE = 'Wheelhouse\'s pane belongs to the project\'s front desk: type /wheelhouse there'
const SETTING_UP = 'This project is still being set up: its pane opens once setup finishes'
const NO_PROJECT = 'This folder isn\'t a Wheelhouse project, so it has no pane'

test('/wheelhouse in a session that isn\'t the front desk\'s says whose the pane is, and opens nothing', async ($, on) => {
  let reply: object = { ok: true, role: 'feature', every: 0 }
  const { seen, clear, start } = world(on, () => reply)
  const cases: [object, string][] = [
    [{ ok: true, role: 'feature', every: 0 }, NOT_HERE],
    [{ ok: true, role: 'foreman', every: 30000, submit: [] }, NOT_HERE],
    [{ ok: true, role: 'foreman', every: 0, submit: [] }, NOT_HERE],
    [{ ok: true, role: 'setup', every: TICK_MS }, SETTING_UP],
    // A front desk outside a project: the bridge answers its role with no pane.
    [{ ok: true, role: 'front-desk', every: 0 }, NO_PROJECT],
  ]
  for (const [answer, says] of cases) {
    for (const surface of SURFACES) {
      reply = answer
      await start($, surface)
      clear()
      const result = await $.command.run({ command: 'wheelhouse', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
      expect(result).toMatchObject({ text: says })
      expect(seen.opens).toEqual([])
      expect(seen.toasts).toEqual([])
    }
  }
})

for (const surface of SURFACES) {
  test(`/wheelhouse before the first tick has answered opens the pane, which says it is reading (${surface})`, async ($, on) => {
    const { seen, clear, clock } = world(on, () => ({ hold: 60000, then: frontDesk('2 cards wait') }))
    clear()
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
    const result = await $.command.run({ command: 'wheelhouse', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(result).toMatchObject({ text: 'Wheelhouse' })
    expect(seen.opens).toEqual([{ id: PANE_ID, title: 'Wheelhouse' }])
    const ui = await mount($, surface)
    expect(await texts(ui)).toEqual(['Reading how the project stands…'])
    await clock.advance(60000)
    await ui.unmount()
  })
}

// A pane /wheelhouse opened before the first answer, whose first answer gives the session no pane:
// the pane says why, in place of its first line, and with no STOP. Each in a test of its own, so
// the session's state holds no answer from an earlier one.
for (const surface of SURFACES) {
  for (const [answer, says] of [[{ ok: true, role: 'feature', every: 0 }, NOT_HERE], [{ ok: true, role: 'setup', every: TICK_MS }, SETTING_UP], [{ ok: true, role: 'front-desk', every: 0 }, NO_PROJECT]] as const) {
    test(`a pane opened before the first answer says why once that answer gives it none (${surface}, ${answer.role}, every ${answer.every})`, async ($, on) => {
      const { clock } = world(on, () => ({ hold: 20000, then: answer }))
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      await clock.settle()
      await $.command.run({ command: 'wheelhouse', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
      const ui = await mount($, surface)
      expect(await texts(ui)).toEqual(['Reading how the project stands…'])
      expect((await ui.find({ key: 'stop' }))?.type).toBe('Button')
      await clock.advance(20000)
      expect(await texts(ui)).toEqual([says])
      expect(await ui.find({ key: 'stop' })).toBeUndefined()
      await clock.advance(TICK_MS)
      await ui.unmount()
    })
  }
}

// A front desk outside a project is known from the last answered tick, not the latest tick: a tick
// that fails after that answer (here, a reload's) leaves /wheelhouse saying so, and opening nothing.
for (const surface of SURFACES) {
  test(`/wheelhouse after a front desk outside a project, then a failed tick, still opens nothing (${surface})`, async ($, on) => {
    let reply: Reply = { ok: true, role: 'front-desk', every: 0 }
    const { seen, clear, start, clock } = world(on, () => reply)
    await start($, surface)
    reply = { exitCode: 1 }
    await start($, surface, true)
    expect(seen.ticks).toHaveLength(1)
    clear()
    const result = await $.command.run({ command: 'wheelhouse', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(result).toMatchObject({ text: NO_PROJECT })
    expect(seen.opens).toEqual([])
    const ui = await mount($, surface)
    expect(await texts(ui)).toEqual([NO_PROJECT])
    expect(await ui.find({ key: 'stop' })).toBeUndefined()
    await clock.advance(TICK_MS)
    await ui.unmount()
  })
}

test('before a surface is attached nothing opens, and the first tick with one opens the pane once', async ($, on) => {
  const reply: object = frontDesk('2 cards wait')
  const { seen, clear, start, clock, panes, attached } = world(on, () => reply)
  attached.surfaces = []
  await start($, 'desktop')
  expect(seen.ticks).toHaveLength(1)
  expect(seen.opens).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual(['2 cards wait'])
  expect(panes.has(PANE_ID)).toBe(false)
  // Still none on the next tick.
  clear()
  await clock.advance(TICK_MS)
  expect(seen.opens).toEqual([])
  // A surface attaches: the next tick opens the pane, and the one after only retitles it.
  attached.surfaces = ['a surface']
  await clock.advance(TICK_MS)
  expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
  clear()
  await clock.advance(TICK_MS)
  expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
  // A pane the director closed stays closed.
  panes.delete(PANE_ID)
  clear()
  await clock.advance(TICK_MS)
  expect(seen.opens).toEqual([])
})

test('a no-surface refusal from ui.open is quiet, and the next tick opens the pane', async ($, on) => {
  const reply: object = frontDesk('2 cards wait')
  const { seen, clear, start, clock, panes, attached } = world(on, () => reply)
  attached.refuseOpen = 'no-surface: no surface is attached ($.session.surfaces() is empty)'
  await start($, 'desktop')
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual(['2 cards wait'])
  expect(panes.has(PANE_ID)).toBe(false)
  attached.refuseOpen = null
  clear()
  await clock.advance(TICK_MS)
  expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
})

test('a ui.open refusal that is not no-surface is not tried again on every tick, and the status line is set', async ($, on) => {
  const reply: object = frontDesk('2 cards wait')
  const { seen, clear, start, clock, attached } = world(on, () => reply)
  attached.refuseOpen = 'the pane may not open'
  await start($, 'desktop')
  expect(seen.statuses).toEqual([])
  attached.refuseOpen = null
  clear()
  await clock.advance(TICK_MS)
  expect(seen.opens).toEqual([])
  expect(seen.statuses).toEqual(['2 cards wait'])
})

test('a ui.open that resolves unplaced for want of a surface keeps the pane, and the next tick only retitles it', async ($, on) => {
  const reply: object = frontDesk('2 cards wait')
  const { seen, clear, start, clock, attached } = world(on, () => reply)
  attached.unplaced = true
  await start($, 'desktop')
  expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual(['2 cards wait'])
  clear()
  await clock.advance(TICK_MS)
  expect(seen.opens).toEqual([{ id: PANE_ID, title: '2 cards wait' }])
})
