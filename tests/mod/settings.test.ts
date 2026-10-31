// tests/mod/settings.test.ts
// The pane's settings view, drawn as groups, run by `claude plugin test .` (npm run mod-check). The bridge's rows
// and its answers to a choice come from `$.process.run`, answered here. The groups are the bridge's
// (scripts/mod/settings-pane.js): these tests check only that the mod draws them, sends the chosen
// value under the origin `pane` and passes on what the bridge said.
//
// A pick is run with ui.select, which settles in this build and runs the Select's own onSelect
// (ui.input does not settle: see tests/mod/cards.test.ts). A real pick in a live session isn't run.
import { test, expect, mock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/Users/someone/projects/shop'
const SESSION = '0b6a4e1c-4f3a-4d7e-9a51-2f3c8d9e1a77'
const PANE_ID = 'wheelhouse'
const TICK_MS = 15000
const START = Date.parse('2026-10-19T03:00:50.000Z')
const RUN_RESULT = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const CONTEXT = { window: 200000, tokens: 1000, percent: 0.5 }
const PANE_PROPS = {
  title: 'Wheelhouse', isFocused: false, bodyColumns: 48, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}
const FAILED = 'That wasn\'t recorded. Try again, or type it in the chat.'
const ADVANCED = 'Advanced settings: ask the First Mate'

const model = {
  v: 1, project: 'shop', at: '2026-10-19T03:00:50.000Z', glance: 'Nothing waits',
  stop: { on: false, since: null }, cards: [], building: [], health: [], usage: null,
  finished: [], incidents: [], watcher: 'running', missing: [],
}
const frontDesk = { ok: true, role: 'front-desk', every: TICK_MS, pane: model, glance: 'Nothing waits', status: 'Nothing waits' }

const AUTONOMY = [{ value: 'cautious', label: 'Cautious' }, { value: 'balanced', label: 'Balanced' }, { value: 'trusting', label: 'Trusting' }]
const PROJECT_NOTE = 'Only for this project. A pick changes it at once and counts as your confirmation; Undo stays for a minute.'
const YOU_NOTE = 'These follow you to every project.'
const groupsWith = (autonomy: string, changed?: any) => [
  { id: 'stop', title: 'All stop', note: 'All stop halts the whole Crew at once. Only you can lift it.', rows: [{ key: 'builders', label: 'Crew', value: 'Working', kind: 'value' }] },
  {
    id: 'project', title: 'This project', note: PROJECT_NOTE,
    rows: [
      { key: 'autonomy', label: 'Autonomy', value: autonomy, kind: 'select', options: AUTONOMY, ...(changed ? { changed } : {}) },
      { key: 'pace', label: 'Crew at once', value: '2', kind: 'select', options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }] },
      { key: 'protection', label: 'Protection', value: 'Standard', kind: 'change' },
    ],
  },
  {
    id: 'you', title: 'You, in every project', note: YOU_NOTE,
    rows: [
      { key: 'presence', label: 'Availability', value: null, current: 'Away until 18:00', kind: 'select', options: [{ value: 'available', label: 'Available' }, { value: 'away', label: 'Away' }] },
      { key: 'notifications', label: 'Notifications', value: 'On, quiet 22:00 to 07:00', kind: 'change' },
    ],
  },
  { id: 'advanced', title: 'Advanced settings', note: '', rows: [{ key: 'advanced', label: 'Advanced settings', value: '', kind: 'change' }] },
]
const answerWith = (autonomy: string, changed?: any) => ({ ok: true, rows: [], groups: groupsWith(autonomy, changed), text: ADVANCED })

type Reply = object | { exitCode: number } | { hold: number, then: object }

function world(on: any, bridge: (request: any) => Reply) {
  const clock = mock.clock(on, { now: START })
  const panes = new Map<string, string>()
  const current = { session: SESSION }
  let sessions = 0
  const seen = { requests: [] as any[], ticks: [] as any[], toasts: [] as string[], submits: [] as any[] }
  // Set to make the engine refuse the next prompts the mod submits.
  const control = { refuseSubmit: false }
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
      got = frontDesk
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
  on('prompt.submit', ($: any, e: any) => {
    if (control.refuseSubmit) throw new Error('the session took no prompt')
    seen.submits.push(e)
    return { text: e.text, origin: e.origin }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: 'the engine ran it' }))
  const clear = () => { for (const list of Object.values(seen)) list.length = 0 }
  const start = async ($: any, surface: string) => {
    clear()
    sessions += 1
    current.session = `${SESSION}-${sessions}`
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
  }
  return { seen, clear, start, clock, control }
}

const mount = ($: any, surface: string) => $.ui.mount({ plugin: 'wheelhouse', surface, component: 'Pane', requestId: PANE_ID, props: PANE_PROPS })
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
const buttons = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key)

const choiceKey = (key: string, id: string) => `setting:${key}:${id}`
const textNodes = async (ui: any) => await ui.findAll({ type: 'Text' })
const STOP_NOTE = 'Settings can\'t change while All stop is on. Lift All stop first.'
const PICK = { cmd: 'setting', origin: 'pane', cwd: ROOT, key: 'autonomy', choice: 'cautious' }
const SETTINGS_READ = { cmd: 'settings', cwd: ROOT }
const readsOf = (seen: any) => seen.requests.filter((r: any) => r.cmd === 'settings')
const picksOf = (seen: any) => seen.requests.filter((r: any) => r.cmd === 'setting')
const aGroupedBridge = (state: { autonomy: string, changed?: any }, then: (request: any) => any = () => ({ ok: false })) => (request: any) =>
  (request.cmd === 'settings' ? answerWith(state.autonomy, state.changed) : then(request))

test('Settings draws its groups with their notes, and Done filled in the header', async ($, on) => {
  const { seen, clear, start } = world(on, aGroupedBridge({ autonomy: 'balanced' }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    await ui.press({ key: 'settings' })
    expect(seen.requests).toEqual([SETTINGS_READ])
    const heading = (await textNodes(ui)).find((n: any) => n.text === 'Settings')
    expect(heading?.props.size).toBe('title')
    expect(heading?.props.weight).toBe('semibold')
    const done = await ui.find({ key: 'done' })
    expect(done?.props.variant).toBe('primary')
    expect(done?.props.label).toBe('Done')
    const drawn = await texts(ui)
    for (const words of ['All stop', 'This project', 'You, in every project', 'Advanced settings', PROJECT_NOTE, YOU_NOTE, 'All stop halts the whole Crew at once. Only you can lift it.']) expect(drawn).toContain(words)
    // Four panels, each with the quiet line; the Advanced group has no note, so no empty line under it.
    const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle !== undefined)
    expect(boxes).toHaveLength(4)
    for (const b of boxes) {
      expect(b.props.borderStyle).toBe('round')
      expect(b.props.borderColor).toBeUndefined()
    }
    expect(drawn).not.toContain('')
    // A value row is its name and value; a change row its name, its value in footnote and a small Change….
    expect(drawn).toContain('Crew')
    expect(drawn).toContain('Working')
    const standard = (await textNodes(ui)).find((n: any) => n.text === 'Standard')
    expect(standard?.props.size).toBe('footnote')
    expect(standard?.props.dimColor).toBe(true)
    const change = await ui.find({ key: choiceKey('protection', 'change') })
    expect(change?.props.plain).toBe(true)
    expect(change?.props.label).toBe('Change…')
    // The Advanced group is its one row, so the name is said once.
    expect((await ui.findAll({ type: 'Text' })).filter((n: any) => n.text === 'Advanced settings')).toHaveLength(1)
    // Done goes back to the board view.
    await ui.press({ key: 'done' })
    expect(await ui.find({ key: 'done' })).toBeUndefined()
    expect((await ui.find({ key: 'settings' }))?.type).toBe('Button')
    await ui.unmount()
  }
})

test('a level row is a Select with its options and the value in force', async ($, on) => {
  const { start } = world(on, aGroupedBridge({ autonomy: 'balanced' }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    const select = await ui.find({ key: 'setting:autonomy' })
    expect(select?.type).toBe('Select')
    expect(select?.props.value).toBe('balanced')
    expect(select?.props.options).toEqual(AUTONOMY)
    // Availability matches no option: no Select, so none can pick of itself; its words stand there.
    expect((await ui.findAll({ type: 'Select' })).map((n: any) => n.key)).toEqual(['setting:autonomy', 'setting:pace'])
    expect(await texts(ui)).toContain('Autonomy')
    expect(await texts(ui)).toContain('Away until 18:00')
    // No "›" off the phone.
    expect((await texts(ui)).some((x: string) => x.includes('›'))).toBe(false)
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('a pick sends the setting press with the origin pane, once, showing Recording…', async ($, on) => {
  const state = { autonomy: 'balanced' }
  const { seen, clear, start, clock } = world(on, aGroupedBridge(state, (request) => {
    if (request.cmd !== 'setting') return { ok: false }
    return { hold: 2000, then: { ok: true, says: 'Autonomy is now cautious, for this project' } }
  }))
  for (const surface of SURFACES) {
    state.autonomy = 'balanced'
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    clear()
    const picked = ui.select({ key: 'setting:autonomy', value: 'cautious' })
    await clock.settle()
    await ui.redraw()
    // While it records, the row says so, and every Select is its value in plain dim words.
    expect(await texts(ui)).toContain('Recording…')
    expect(await ui.findAll({ type: 'Select' })).toHaveLength(0)
    const dim = (await textNodes(ui)).filter((n: any) => n.props.dimColor === true).map((n: any) => n.text)
    expect(dim).toEqual(expect.arrayContaining(['2', 'Away until 18:00']))
    // A second pick meanwhile sends nothing.
    await expect(ui.select({ key: 'setting:pace', value: '3' })).rejects.toThrow()
    state.autonomy = 'cautious'
    await clock.advance(2000)
    await picked
    expect(picksOf(seen)).toEqual([PICK])
    expect(seen.toasts).toEqual(['Recording…', 'Autonomy is now cautious, for this project'])
    // The settings are read again, so the Select shows the new value, live again.
    expect((await ui.find({ key: 'setting:autonomy' }))?.props.value).toBe('cautious')
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('a pick under STOP draws the row back and says Settings can\'t change while STOP is on', async ($, on) => {
  const state = { autonomy: 'balanced' }
  const { seen, clear, start, clock } = world(on, aGroupedBridge(state, (request) => (request.cmd === 'setting' ? { ok: false, says: STOP_NOTE } : { ok: false })))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    clear()
    await ui.select({ key: 'setting:autonomy', value: 'cautious' })
    await clock.settle()
    expect(picksOf(seen)).toEqual([PICK])
    await clock.advance(10)
    await ui.redraw()
    expect(seen.toasts).toEqual(['Recording…', STOP_NOTE])
    // The read after the refusal is the value in force: the row is back at it.
    expect(readsOf(seen)).toHaveLength(1)
    expect((await ui.find({ key: 'setting:autonomy' }))?.props.value).toBe('balanced')
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('a pick the bridge never answers is a toast, and leaves the Selects live', async ($, on) => {
  const { seen, clear, start, clock } = world(on, aGroupedBridge({ autonomy: 'balanced' }, () => ({ exitCode: 1 })))
  await start($, 'desktop')
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'settings' })
  clear()
  await ui.select({ key: 'setting:pace', value: '3' })
  await clock.settle()
  expect(seen.toasts).toEqual(['Recording…', FAILED])
  expect((await ui.find({ key: 'setting:pace' }))?.type).toBe('Select')
  await ui.unmount()
})

test('Change… hands the front desk the row\'s name', async ($, on) => {
  const { seen, clear, start } = world(on, aGroupedBridge({ autonomy: 'balanced' }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    clear()
    await ui.press({ key: choiceKey('notifications', 'change') })
    expect(seen.submits.map((p: any) => p.text)).toEqual(['Wheelhouse pane: the director wants to change Notifications.'])
    // It asks the front desk, not the bridge, and so carries no origin of its own.
    expect(seen.requests).toEqual([])
    expect(picksOf(seen)).toEqual([])
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('a row with no value in force draws no Select, and its Change… opens the choices with no tick', async ($, on) => {
  const { seen, clear, start } = world(on, aGroupedBridge({ autonomy: 'balanced' }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    expect(await ui.find({ key: 'setting:presence' })).toBeUndefined()
    expect((await ui.find({ key: choiceKey('presence', 'change') }))?.props.label).toBe('Change…')
    clear()
    await ui.press({ key: choiceKey('presence', 'change') })
    await ui.redraw()
    expect((await ui.find({ key: 'settings-back' }))?.props.label).toBe('‹ Settings')
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => [b.key, b.props.label])).toEqual([
      ['stop', 'All stop'],
      ['settings-back', '‹ Settings'],
      [choiceKey('presence', 'available'), 'Available'],
      [choiceKey('presence', 'away'), 'Away'],
    ])
    expect(seen.requests).toEqual([])
    await ui.press({ key: 'settings-back' })
    expect((await ui.find({ key: choiceKey('presence', 'change') }))?.type).toBe('Button')
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('a pick equal to the value in force sends no request and no toast', async ($, on) => {
  const { seen, clear, start, clock } = world(on, aGroupedBridge({ autonomy: 'balanced' }))
  await start($, 'desktop')
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'settings' })
  clear()
  await ui.select({ key: 'setting:autonomy', value: 'balanced' })
  await clock.settle()
  expect(seen.requests).toEqual([])
  expect(seen.toasts).toEqual([])
  expect((await ui.find({ key: 'setting:autonomy' }))?.type).toBe('Select')
  await ui.press({ key: 'done' })
  await ui.unmount()
})

test('a double click on Change…, a moment apart, asks once; a prompt the engine refuses can be asked again', async ($, on) => {
  const { seen, clear, start, clock, control } = world(on, aGroupedBridge({ autonomy: 'balanced' }))
  const asked = 'Wheelhouse pane: the director wants to change Notifications.'
  for (const surface of SURFACES) {
    control.refuseSubmit = false
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    clear()
    await ui.press({ key: choiceKey('notifications', 'change') })
    await clock.advance(200)
    await ui.redraw()
    expect(await ui.find({ key: choiceKey('notifications', 'change') })).toBeUndefined()
    await expect(ui.press({ key: choiceKey('notifications', 'change') })).rejects.toThrow()
    expect(seen.submits.map((p: any) => p.text)).toEqual([asked])
    // The other rows' Change… is live meanwhile.
    expect((await ui.find({ key: choiceKey('protection', 'change') }))?.type).toBe('Button')

    // Opening the settings view again makes it live again.
    await ui.press({ key: 'done' })
    await ui.press({ key: 'settings' })
    expect((await ui.find({ key: choiceKey('notifications', 'change') }))?.type).toBe('Button')

    clear()
    control.refuseSubmit = true
    await ui.press({ key: choiceKey('notifications', 'change') })
    expect(seen.toasts).toEqual(['That didn\'t reach the First Mate. Type it in the chat instead.'])
    expect((await ui.find({ key: choiceKey('notifications', 'change') }))?.type).toBe('Button')
    control.refuseSubmit = false
    await ui.press({ key: choiceKey('notifications', 'change') })
    expect(seen.submits.map((p: any) => p.text)).toEqual([asked])
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('a row changed just now shows Undo, which sends undo', async ($, on) => {
  const state: { autonomy: string, changed?: any } = { autonomy: 'cautious', changed: { at: new Date(START - 20000).toISOString(), undo: true } }
  const { seen, clear, start, clock } = world(on, aGroupedBridge(state, (request) => (request.cmd === 'setting' ? { ok: true, says: 'Autonomy is back to balanced' } : { ok: false })))
  for (const surface of SURFACES) {
    state.autonomy = 'cautious'
    state.changed = { at: new Date(START - 20000).toISOString(), undo: true }
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    const line = (await textNodes(ui)).find((n: any) => n.text === 'Changed just now')
    expect(line?.props.size).toBe('footnote')
    const undo = await ui.find({ key: choiceKey('autonomy', 'undo') })
    expect(undo?.props.plain).toBe(true)
    expect(undo?.props.label).toBe('Undo')
    // Only the row that changed has one.
    expect(await ui.findAll({ type: 'Button' }).then((b: any[]) => b.filter((x) => x.key.endsWith(':undo')))).toHaveLength(1)
    clear()
    state.autonomy = 'balanced'
    state.changed = undefined
    await ui.press({ key: choiceKey('autonomy', 'undo') })
    await clock.settle()
    expect(picksOf(seen)).toEqual([{ ...PICK, choice: 'undo' }])
    expect(seen.toasts).toEqual(['Recording…', 'Autonomy is back to balanced'])
    expect(await ui.find({ key: choiceKey('autonomy', 'undo') })).toBeUndefined()
    expect(await texts(ui)).not.toContain('Changed just now')
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('Undo leaves when its minute is up, with nothing sent', async ($, on) => {
  const state: { autonomy: string, changed?: any } = { autonomy: 'cautious', changed: { at: new Date(START - 20000).toISOString(), undo: true } }
  const { seen, clear, start, clock } = world(on, aGroupedBridge(state))
  for (const surface of SURFACES) {
    state.changed = { at: new Date(clock.now() - 20000).toISOString(), undo: true }
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    expect(await ui.find({ key: choiceKey('autonomy', 'undo') })).toBeDefined()
    clear()
    // The bridge still gives the row its change: the pane alone takes Undo away at the minute.
    await clock.advance(39000)
    expect(await ui.find({ key: choiceKey('autonomy', 'undo') })).toBeDefined()
    await clock.advance(1000)
    expect(await ui.find({ key: choiceKey('autonomy', 'undo') })).toBeUndefined()
    expect(await texts(ui)).not.toContain('Changed just now')
    expect(picksOf(seen)).toEqual([])
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})

test('a change made over a minute ago, or not undoable, shows no Undo', async ($, on) => {
  const state: { autonomy: string, changed?: any } = { autonomy: 'cautious', changed: { at: new Date(START - 61000).toISOString(), undo: true } }
  const { start } = world(on, aGroupedBridge(state))
  await start($, 'desktop')
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'settings' })
  expect(await ui.find({ key: choiceKey('autonomy', 'undo') })).toBeUndefined()
  expect(await texts(ui)).not.toContain('Changed just now')
  await ui.press({ key: 'done' })
  state.changed = { at: new Date(START).toISOString(), undo: false }
  await ui.press({ key: 'settings' })
  expect(await ui.find({ key: choiceKey('autonomy', 'undo') })).toBeUndefined()
  await ui.unmount()
})

test('on the phone a row opens its choices on their own page, with a tick on the one in force', async ($, on) => {
  const state = { autonomy: 'balanced' }
  const { seen, clear, start, clock } = world(on, aGroupedBridge(state, (request) => (request.cmd === 'setting' ? { ok: true, says: 'Autonomy is now cautious, for this project' } : { ok: false })))
  await start($, 'mobile')
  const ui = await mount($, 'mobile')
  await ui.press({ key: 'settings' })
  // No Select on the phone: each level row is a Button with its name, value and "›".
  expect(await ui.findAll({ type: 'Select' })).toHaveLength(0)
  const row = await ui.find({ key: 'setting:autonomy' })
  expect(row?.type).toBe('Button')
  expect(row?.props.label).toBe('Autonomy  Balanced ›')
  expect((await ui.find({ key: 'setting:presence' }))?.props.label).toBe('Availability  Away until 18:00 ›')
  // "›" is on the phone only, and on level rows only.
  expect((await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.props.label).includes('›')).map((b: any) => b.key)).toEqual(['setting:autonomy', 'setting:pace', 'setting:presence'])

  await ui.press({ key: 'setting:autonomy' })
  await ui.redraw()
  expect((await ui.find({ key: 'settings-back' }))?.props.label).toBe('‹ Settings')
  expect(await ui.find({ key: 'done' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => [b.key, b.props.label])).toEqual([
    ['stop', 'All stop'],
    ['settings-back', '‹ Settings'],
    [choiceKey('autonomy', 'cautious'), 'Cautious'],
    [choiceKey('autonomy', 'balanced'), 'Balanced ✓'],
    [choiceKey('autonomy', 'trusting'), 'Trusting'],
  ])
  // Back goes to the list without sending anything.
  clear()
  await ui.press({ key: 'settings-back' })
  expect((await ui.find({ key: 'setting:autonomy' }))?.props.label).toBe('Autonomy  Balanced ›')
  expect(seen.requests).toEqual([])

  // A choice runs the same press, and the list comes back, read again.
  await ui.press({ key: 'setting:autonomy' })
  clear()
  state.autonomy = 'cautious'
  await ui.press({ key: choiceKey('autonomy', 'cautious') })
  await clock.settle()
  expect(picksOf(seen)).toEqual([PICK])
  expect((await ui.find({ key: 'setting:autonomy' }))?.props.label).toBe('Autonomy  Cautious ›')
  await ui.press({ key: 'done' })
  await ui.unmount()
})

test('settings that can\'t be read say so', async ($, on) => {
  const { seen, clear, start } = world(on, () => ({ exitCode: 1 }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    await ui.press({ key: 'settings' })
    expect(await texts(ui)).toContain('Wheelhouse couldn\'t read the settings')
    expect(seen.toasts).toEqual([])
    expect((await ui.find({ key: 'done' }))?.type).toBe('Button')
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
})
