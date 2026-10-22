// tests/mod/cards.test.ts
// The pane's buttons on the board view: each card's buttons, STOP and Lift STOP, run by
// `claude plugin test .` (npm run mod-check). The bridge's answers come from `$.process.run`,
// answered here. The mod decides nothing: these tests check only that it draws the buttons the
// bridge gave, sends what was pressed under the origin `pane`, and passes on what the bridge said.
import { test, expect, mock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/Users/someone/projects/shop'
const SESSION = '0b6a4e1c-4f3a-4d7e-9a51-2f3c8d9e1a77'
const PANE_ID = 'wheelhouse'
const TICK_MS = 15000
const START = Date.parse('2026-10-19T03:00:50.000Z')
const SINCE = '2026-10-19T02:00:00.000Z'
const RUN_RESULT = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const CONTEXT = { window: 200000, tokens: 1000, percent: 0.5 }
const PANE_PROPS = {
  title: 'Wheelhouse', isFocused: false, bodyColumns: 48, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}
const FAILED = 'Wheelhouse couldn\'t record that'
const CANT_ANSWER = 'This card can\'t be answered here: ask the front desk about it.'

const FIRST = 'Merge the banner change?'
const SECOND = 'Allow build commands to run unattended?'

const button = (label: string, does: string) => ({ label, does })

const model = (stopOn: boolean) => ({
  v: 1,
  project: 'shop',
  at: '2026-10-19T03:00:50.000Z',
  glance: '2 cards wait',
  stop: stopOn ? { on: true, since: SINCE } : { on: false, since: null },
  cards: [
    {
      id: 'card-1', n: 1, header: 'Approve', kind: 'approve', text: FIRST, hash: 'aaaaaaaaaaaa',
      buttons: [button('Approve', 'record'), button('Not now', 'record'), button('Explain more', 'turn')], note: null, blocking: false, asked: false,
    },
    {
      id: 'card-2', n: 2, header: 'Confirm', kind: 'confirm', text: SECOND, hash: 'bbbbbbbbbbbb',
      buttons: [], note: CANT_ANSWER, blocking: false, asked: false,
    },
  ],
  building: [],
  health: stopOn ? [{ level: 'stop', text: 'STOP is on, since 19 October 2026', of: 'stop' }] : [],
  usage: null,
  finished: [],
  incidents: [],
  watcher: 'running',
  missing: [],
})

const frontDesk = (stopOn = false) => ({ ok: true, role: 'front-desk', every: TICK_MS, pane: model(stopOn), glance: '2 cards wait', status: '2 cards wait' })

type Reply = object | { exitCode: number } | { hold: number, then: object }

// Registers the world beneath the mod and returns what it saw. `bridge` answers every request
// but a tick's; `tick` answers the ticks.
function world(on: any, bridge: (request: any) => Reply, tick: () => object = () => frontDesk()) {
  const clock = mock.clock(on, { now: START })
  const panes = new Map<string, string>()
  const current = { session: SESSION }
  let sessions = 0
  const seen = { requests: [] as any[], ticks: [] as any[], toasts: [] as string[], submits: [] as any[] }
  on('session.id', () => ({ value: current.session }))
  on('session.root', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXT, rateLimits: [], cost: undefined } }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('ui.toast', ($: any, e: any) => { seen.toasts.push(e.text); return { value: undefined } })
  on('ui.open', ($: any, e: any) => { panes.set(e.id, e.title ?? e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($: any, e: any) => { panes.delete(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [...panes].map(([id, title]) => ({ id, title, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', async ($: any, e: any) => {
    const request = JSON.parse(e.init?.stdin ?? 'null')
    let got: any
    if (request?.cmd === 'tick') {
      seen.ticks.push(request)
      got = tick()
    } else if (request?.cmd === 'usage') {
      got = { ok: true }
    } else {
      seen.requests.push(request)
      got = bridge(request)
    }
    if (got.hold !== undefined) {
      await clock.sleep(got.hold)
      got = got.then
    }
    if (got.exitCode !== undefined) return { value: { ...RUN_RESULT, exitCode: got.exitCode, stdout: '' } }
    return { value: { ...RUN_RESULT, stdout: `${JSON.stringify(got)}\n` } }
  })
  on('prompt.submit', ($: any, e: any) => { seen.submits.push(e); return { text: e.text, origin: e.origin } })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('command.run', () => ({ text: 'the engine ran it' }))
  const clear = () => { for (const list of Object.values(seen)) list.length = 0 }
  // Starts a new session and lets its first tick finish.
  const start = async ($: any, surface: string) => {
    clear()
    sessions += 1
    current.session = `${SESSION}-${sessions}`
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
  }
  return { seen, clear, start, clock }
}

const mount = ($: any, surface: string) => $.ui.mount({ plugin: 'wheelhouse', surface, component: 'Pane', requestId: PANE_ID, props: PANE_PROPS })
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
const buttons = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key)
const cardKey = (id: string, label: string) => `card:${id}:${label}`

test('each button the bridge gave a card is drawn, and a press sends its card, hash and label as pane', async ($, on) => {
  const { seen, clear, start } = world(on, () => ({ ok: true, says: 'Approved: the banner change merges next', submit: [] }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    // STOP's button, then the shown card's three, in the bridge's order, then Next and Settings.
    expect(await buttons(ui)).toEqual(['stop', cardKey('card-1', 'Approve'), cardKey('card-1', 'Not now'), cardKey('card-1', 'Explain more'), 'next', 'settings'])
    for (const label of ['Approve', 'Not now', 'Explain more']) {
      expect((await ui.find({ key: cardKey('card-1', label) }))?.props.label).toBe(label)
    }

    clear()
    await ui.press({ key: cardKey('card-1', 'Approve') })
    expect(seen.requests).toEqual([{ cmd: 'press', origin: 'pane', cwd: ROOT, card: 'card-1', hash: 'aaaaaaaaaaaa', label: 'Approve' }])
    // The press is followed by a tick, so the pane shows what it changed.
    expect(seen.ticks).toHaveLength(1)
    expect(seen.submits).toEqual([])
    await ui.unmount()
  }
})

test('a card with a note and no buttons gets none, and its note is drawn under it', async ($, on) => {
  const { start } = world(on, () => ({ ok: true }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'next' })
    const drawn = await texts(ui)
    expect(drawn.indexOf(CANT_ANSWER)).toBe(drawn.indexOf(SECOND) + 1)
    expect(await buttons(ui)).toEqual(['stop', 'back', 'settings'])
    // A card with no note draws none.
    await ui.press({ key: 'back' })
    expect(await texts(ui)).not.toContain(CANT_ANSWER)
    await ui.unmount()
  }
})

test('a press shows Recording at once and toasts the bridge\'s words', async ($, on) => {
  let reply: Reply = { ok: true, says: 'Approved: the banner change merges next', submit: [] }
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    // The bridge takes two seconds: meanwhile the pressed button says Recording and the card's
    // other buttons are plain text, so nothing else is sent; STOP stays a button.
    // The press is started and left asleep on the clock with the bridge, as a person's press waits.
    reply = { hold: 2000, then: { ok: true, says: 'Approved: the banner change merges next', submit: [] } }
    const pressed = ui.press({ key: cardKey('card-1', 'Approve') })
    await clock.settle()
    expect(seen.toasts).toEqual(['Recording Approve on card 1'])
    await ui.redraw()
    expect(await texts(ui)).toContain('Recording…')
    expect(await ui.find({ key: cardKey('card-1', 'Approve') })).toBeUndefined()
    expect(await ui.find({ key: cardKey('card-1', 'Not now') })).toBeUndefined()
    expect(await texts(ui)).toContain('Not now')
    expect((await ui.find({ key: 'stop' }))?.type).toBe('Button')

    await clock.advance(2000)
    await pressed
    expect(seen.requests).toHaveLength(1)
    expect(seen.toasts).toEqual(['Recording Approve on card 1', 'Approved: the banner change merges next'])
    await ui.redraw()
    expect(await texts(ui)).not.toContain('Recording…')
    expect((await ui.find({ key: cardKey('card-1', 'Approve') }))?.type).toBe('Button')

    // A refusal is the bridge's words too.
    clear()
    reply = { ok: false, says: 'That card has changed: look at the pane again' }
    await ui.press({ key: cardKey('card-1', 'Not now') })
    expect(seen.toasts).toEqual(['Recording Not now on card 1', 'That card has changed: look at the pane again'])
    await ui.unmount()
  }
})

test('a press the bridge never answers is a toast, and leaves the buttons live', async ($, on) => {
  let reply: Reply = { exitCode: 1 }
  const { seen, clear, start } = world(on, () => reply)
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    reply = { exitCode: 1 }
    await ui.press({ key: cardKey('card-1', 'Approve') })
    expect(seen.toasts).toEqual(['Recording Approve on card 1', FAILED])
    await ui.redraw()
    expect(await texts(ui)).not.toContain('Recording…')
    expect((await ui.find({ key: cardKey('card-1', 'Approve') }))?.type).toBe('Button')
    // An answer that isn't the bridge's line is a failure too.
    clear()
    reply = { ok: false }
    await ui.press({ key: cardKey('card-1', 'Approve') })
    expect(seen.toasts).toEqual(['Recording Approve on card 1', FAILED])
    expect((await ui.find({ key: cardKey('card-1', 'Approve') }))?.type).toBe('Button')
    await ui.unmount()
  }
})

test('a double press sends once', async ($, on) => {
  const { seen, clear, start } = world(on, () => ({ ok: true, says: 'Approved', submit: ['Wheelhouse pane: the director pressed Approve on card 1 (card-1).'] }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    await Promise.all([ui.press({ key: cardKey('card-1', 'Approve') }), ui.press({ key: cardKey('card-1', 'Approve') })])
    expect(seen.requests).toHaveLength(1)
    expect(seen.submits).toHaveLength(1)
    // Two buttons of the same card pressed together send once too.
    clear()
    await Promise.all([ui.press({ key: cardKey('card-1', 'Approve') }), ui.press({ key: cardKey('card-1', 'Not now') })])
    expect(seen.requests).toHaveLength(1)
    await ui.unmount()
  }
})

test('a double click on a card button, a moment apart, sends once', async ($, on) => {
  let reply: Reply = { ok: true }
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    // The bridge takes a second; the second click comes 200 ms after the first, once the pane has
    // redrawn the button as Recording.
    reply = { hold: 1000, then: { ok: true, says: 'Approved' } }
    const pressed = ui.press({ key: cardKey('card-1', 'Approve') })
    await clock.advance(200)
    await ui.redraw()
    expect(await ui.find({ key: cardKey('card-1', 'Approve') })).toBeUndefined()
    await expect(ui.press({ key: cardKey('card-1', 'Approve') })).rejects.toThrow()
    await clock.advance(800)
    await pressed
    expect(seen.requests).toHaveLength(1)
    await ui.unmount()
  }
})

test('a press whose answer holds a prompt submits it', async ($, on) => {
  const prompts = ['Wheelhouse pane: the director pressed Explain more on card 1 (card-1).', 'Wheelhouse pane: a second prompt.']
  let reply: object = { ok: true, says: 'Asking the front desk', submit: [prompts[0]] }
  const { seen, clear, start } = world(on, () => reply)
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    reply = { ok: true, says: 'Asking the front desk', submit: [prompts[0]] }
    await ui.press({ key: cardKey('card-1', 'Explain more') })
    expect(seen.submits.map((p: any) => p.text)).toEqual([prompts[0]])
    expect(seen.submits[0].origin).toMatchObject({ kind: 'plugin', name: 'wheelhouse' })
    expect(seen.toasts).toEqual(['Recording Explain more on card 1', 'Asking the front desk'])
    // Several prompts go in order, each once.
    clear()
    reply = { ok: true, submit: prompts }
    await ui.press({ key: cardKey('card-1', 'Explain more') })
    expect(seen.submits.map((p: any) => p.text)).toEqual(prompts)
    // A refused press can still hand the front desk its prompt.
    clear()
    reply = { ok: false, says: 'STOP is on: the front desk takes it from here', submit: [prompts[0]] }
    await ui.press({ key: cardKey('card-1', 'Explain more') })
    expect(seen.submits.map((p: any) => p.text)).toEqual([prompts[0]])
    expect(seen.toasts.at(-1)).toBe('STOP is on: the front desk takes it from here')
    await ui.unmount()
  }
})

test('STOP shows while STOP is off, Lift STOP while it is on, each sending pane', async ($, on) => {
  let stopOn = false
  const { seen, clear, start, clock } = world(on, (request) => {
    if (request.cmd === 'stop') return { ok: true, says: 'STOP is on.' }
    if (request.cmd === 'go') return { ok: true, says: 'STOP is off. In progress: 1 feature building.' }
    return { ok: false }
  }, () => frontDesk(stopOn))
  for (const surface of SURFACES) {
    stopOn = false
    await start($, surface)
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'stop' }))?.props.label).toBe('STOP')
    expect(await ui.find({ key: 'lift-stop' })).toBeUndefined()
    clear()
    stopOn = true
    await ui.press({ key: 'stop' })
    expect(seen.requests).toEqual([{ cmd: 'stop', origin: 'pane', cwd: ROOT }])
    expect(seen.toasts).toEqual(['Recording STOP', 'STOP is on.'])
    expect(seen.ticks).toHaveLength(1)

    // The tick after the press drew STOP on: Lift STOP now, carrying the STOP the pane drew.
    await ui.redraw()
    expect(await ui.find({ key: 'stop' })).toBeUndefined()
    expect((await ui.find({ key: 'lift-stop' }))?.props.label).toBe('Lift STOP')
    clear()
    stopOn = false
    await ui.press({ key: 'lift-stop' })
    expect(seen.requests).toEqual([{ cmd: 'go', origin: 'pane', cwd: ROOT, since: SINCE }])
    expect(seen.toasts).toEqual(['Recording Lift STOP', 'STOP is off. In progress: 1 feature building.'])
    expect(seen.ticks).toHaveLength(1)
    await ui.redraw()
    expect((await ui.find({ key: 'stop' }))?.type).toBe('Button')
    await clock.advance(TICK_MS)
    await ui.unmount()
  }
})

test('STOP stays live while a card press is recorded', async ($, on) => {
  let reply: Reply = { ok: true }
  const { seen, clear, start, clock } = world(on, (request) => (request.cmd === 'stop' ? { ok: true, says: 'STOP is on.' } : reply))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    reply = { hold: 3000, then: { ok: true, says: 'Approved' } }
    const pressed = ui.press({ key: cardKey('card-1', 'Approve') })
    await clock.settle()
    await ui.press({ key: 'stop' })
    expect(seen.requests.map((r: any) => r.cmd)).toEqual(['press', 'stop'])
    await ui.redraw()
    expect(await texts(ui)).toContain('Recording…')
    await clock.advance(3000)
    await pressed
    await ui.redraw()
    expect(await texts(ui)).not.toContain('Recording…')
    await ui.unmount()
  }
})

test('the pane origin is sent only from a press', async ($, on) => {
  const { seen, clear, start, clock } = world(on, () => ({ ok: true, says: 'Done' }), () => frontDesk(true))
  for (const surface of SURFACES) {
    await start($, surface)
    // Ticks, turns, typed prompts, /go and opening the pane send nothing under `pane`.
    await $.turn.start({ turnId: 't1', text: 'hello' })
    await $.prompt.submit({ text: 'ABCD Approve', origin: { kind: 'composer' }, wait: false })
    await $.prompt.submit({ text: 'stop', origin: { kind: 'bridge' }, wait: false })
    await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
    await $.command.run({ command: 'go', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    await $.command.run({ command: 'wheelhouse', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    await clock.advance(2 * TICK_MS)
    const ui = await mount($, surface)
    await ui.press({ key: 'next' })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'settings' })
    await ui.press({ key: 'board' })
    expect(seen.requests.length).toBeGreaterThan(0)
    expect(seen.ticks.length).toBeGreaterThan(0)
    expect([...seen.requests, ...seen.ticks].filter((r: any) => r.origin === 'pane')).toEqual([])

    // Each press sends `pane`, and only the press.
    clear()
    await ui.press({ key: cardKey('card-1', 'Approve') })
    await ui.press({ key: 'lift-stop' })
    expect(seen.requests.map((r: any) => [r.cmd, r.origin])).toEqual([['press', 'pane'], ['go', 'pane']])
    expect(seen.ticks.every((r: any) => r.origin === undefined)).toBe(true)
    await ui.unmount()
  }
})

test('Lift STOP on a picture with no STOP start sends since null, and the bridge\'s refusal is a toast', async ($, on) => {
  // The bridge lifts only the STOP the pane drew (ruling 21): with no start drawn it refuses, and
  // the director sees its words.
  const UNDATED = 'The pane didn\'t say which STOP it showed, so STOP stays on; type /go to lift it'
  let stop: object = { on: true, since: null }
  let reply: Reply = { ok: false, says: UNDATED }
  const { seen, clear, start } = world(on, () => reply, () => ({ ...frontDesk(true), pane: { ...model(true), stop } }))
  for (const surface of SURFACES) {
    for (const undated of [{ on: true, since: null }, { on: true }, { on: true, since: 42 }]) {
      stop = undated
      reply = { ok: false, says: UNDATED }
      await start($, surface)
      const ui = await mount($, surface)
      clear()
      await ui.press({ key: 'lift-stop' })
      expect(seen.requests).toEqual([{ cmd: 'go', origin: 'pane', cwd: ROOT, since: null }])
      expect(seen.toasts).toEqual(['Recording Lift STOP', UNDATED])
      await ui.redraw()
      expect((await ui.find({ key: 'lift-stop' }))?.type).toBe('Button')
      // No answer at all says so too.
      clear()
      reply = { exitCode: 1 }
      await ui.press({ key: 'lift-stop' })
      expect(seen.toasts).toEqual(['Recording Lift STOP', FAILED])
      await ui.unmount()
    }
  }
})

test('STOP pressed twice sends once', async ($, on) => {
  let reply: Reply = { ok: true, says: 'STOP is on.' }
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    // Two presses at once.
    clear()
    reply = { ok: true, says: 'STOP is on.' }
    await Promise.all([ui.press({ key: 'stop' }), ui.press({ key: 'stop' })])
    expect(seen.requests).toEqual([{ cmd: 'stop', origin: 'pane', cwd: ROOT }])
    // A second click a moment later, while the first is recorded: STOP is Recording, not a button.
    clear()
    reply = { hold: 1000, then: { ok: true, says: 'STOP is on.' } }
    const pressed = ui.press({ key: 'stop' })
    await clock.advance(200)
    await ui.redraw()
    expect(await ui.find({ key: 'stop' })).toBeUndefined()
    expect(await texts(ui)).toContain('Recording…')
    await expect(ui.press({ key: 'stop' })).rejects.toThrow()
    await clock.advance(800)
    await pressed
    expect(seen.requests).toHaveLength(1)
    await ui.redraw()
    expect((await ui.find({ key: 'stop' }))?.type).toBe('Button')
    await ui.unmount()
  }
})

test('Lift STOP is plain text while a card press is recorded, and sends nothing', async ($, on) => {
  let reply: Reply = { ok: true }
  const { seen, clear, start, clock } = world(on, () => reply, () => frontDesk(true))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    reply = { hold: 2000, then: { ok: true, says: 'Approved' } }
    const pressed = ui.press({ key: cardKey('card-1', 'Approve') })
    await clock.settle()
    await ui.redraw()
    expect(await ui.find({ key: 'lift-stop' })).toBeUndefined()
    expect(await texts(ui)).toContain('Lift STOP')
    await expect(ui.press({ key: 'lift-stop' })).rejects.toThrow()
    await clock.advance(2000)
    await pressed
    expect(seen.requests.map((r: any) => r.cmd)).toEqual(['press'])
    await ui.redraw()
    expect((await ui.find({ key: 'lift-stop' }))?.type).toBe('Button')

    // Pressed together, from the same drawing: only the first is sent.
    clear()
    reply = { ok: true }
    await Promise.all([ui.press({ key: cardKey('card-1', 'Approve') }), ui.press({ key: 'lift-stop' })])
    expect(seen.requests.map((r: any) => r.cmd)).toEqual(['press'])
    await ui.unmount()
  }
})

// Each in a test of its own, so the session's state holds no picture from an earlier answer.
for (const surface of SURFACES) {
  for (const [first, line] of [[{ hold: 60000, then: frontDesk() }, 'Reading how the project stands…'], [{ exitCode: 1 }, 'Couldn\'t read the latest at ']] as const) {
    test(`STOP is drawn before the first tick has answered (${surface}, ${'hold' in first ? 'a tick still running' : 'a failed tick'})`, async ($, on) => {
      // STOP needs only the session's folder, so the pane carries it from its first drawing.
      let tickReply: object = first
      const { seen, clear, clock } = world(on, () => ({ ok: true, says: 'STOP is on.' }), () => tickReply)
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      await clock.settle()
      const ui = await mount($, surface)
      expect(await buttons(ui)).toEqual(['stop'])
      const drawn = await texts(ui)
      expect(drawn.slice(0, 2)).toEqual(['STOP', 'Halts every builder at once.'])
      expect(drawn).toHaveLength(3)
      expect(drawn[2]).toStartWith(line)
      clear()
      await ui.press({ key: 'stop' })
      expect(seen.requests).toEqual([{ cmd: 'stop', origin: 'pane', cwd: ROOT }])
      expect(seen.toasts).toEqual(['Recording STOP', 'STOP is on.'])
      tickReply = frontDesk()
      await clock.advance(60000)
      await ui.unmount()
    })
  }
}

test('a press made while a tick runs gets its own tick once that one ends, and only one', async ($, on) => {
  let tickReply: object = frontDesk()
  const { seen, clear, start, clock } = world(on, () => ({ ok: true, says: 'Approved' }), () => tickReply)
  for (const surface of SURFACES) {
    tickReply = frontDesk()
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    // The timer's tick takes five seconds; two presses come meanwhile.
    tickReply = { hold: 5000, then: frontDesk() }
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    tickReply = frontDesk()
    await ui.press({ key: cardKey('card-1', 'Approve') })
    await ui.press({ key: cardKey('card-1', 'Not now') })
    expect(seen.requests).toHaveLength(2)
    expect(seen.ticks).toHaveLength(1)
    // It ends, and one tick follows at once, not two, and not at the timer's next fire.
    await clock.advance(5000)
    expect(seen.ticks).toHaveLength(2)
    await clock.advance(TICK_MS - 5000 - 1)
    expect(seen.ticks).toHaveLength(2)
    await clock.advance(1)
    expect(seen.ticks).toHaveLength(3)
    await ui.unmount()
  }
})
