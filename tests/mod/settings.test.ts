// tests/mod/settings.test.ts
// The pane's settings view, run by `claude plugin test .` (npm run mod-check). The bridge's rows
// and its answers to a choice come from `$.process.run`, answered here. The rows are the bridge's
// (scripts/mod/settings-pane.js): these tests check only that the mod draws them, sends the chosen
// id under the origin `pane` and passes on what the bridge said.
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
const FAILED = 'Wheelhouse couldn\'t record that'
const ADVANCED = 'Advanced settings: ask the front desk'

const model = {
  v: 1, project: 'shop', at: '2026-10-19T03:00:50.000Z', glance: 'Nothing waits',
  stop: { on: false, since: null }, cards: [], building: [], health: [], usage: null,
  finished: [], incidents: [], watcher: 'running', missing: [],
}
const frontDesk = { ok: true, role: 'front-desk', every: TICK_MS, pane: model, glance: 'Nothing waits', status: 'Nothing waits' }

const rowsWith = (autonomy: string) => [
  {
    key: 'autonomy', label: 'Autonomy', from: 'this project', current: autonomy === 'cautious' ? 'Cautious' : 'Balanced', here: true,
    choices: [
      { id: 'cautious', label: 'Cautious', chosen: autonomy === 'cautious' },
      { id: 'balanced', label: 'Balanced', chosen: autonomy === 'balanced' },
      { id: 'trusting', label: 'Trusting', chosen: false },
    ],
  },
  {
    key: 'pace', label: 'Pace', from: 'the default', current: '2', here: true,
    choices: [{ id: '1', label: '1', chosen: false }, { id: '2', label: '2', chosen: true }, { id: '3', label: '3', chosen: false }],
  },
  { key: 'notifications', label: 'Notifications', from: 'yours', current: 'On, quiet 22:00 to 07:00', choices: [], here: false, why: 'Changed by asking the front desk' },
]

type Reply = object | { exitCode: number } | { hold: number, then: object }

function world(on: any, bridge: (request: any) => Reply) {
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
  on('prompt.submit', ($: any, e: any) => { seen.submits.push(e); return { text: e.text, origin: e.origin } })
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
  return { seen, clear, start, clock }
}

const mount = ($: any, surface: string) => $.ui.mount({ plugin: 'wheelhouse', surface, component: 'Pane', requestId: PANE_ID, props: PANE_PROPS })
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
const buttons = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key)
const choiceKey = (key: string, id: string) => `setting:${key}:${id}`

test('the settings view draws each row\'s choices and sends the chosen id', async ($, on) => {
  let autonomy = 'balanced'
  const { seen, clear, start } = world(on, (request) => {
    if (request.cmd === 'settings') return { ok: true, rows: rowsWith(autonomy), text: ADVANCED }
    if (request.cmd === 'setting') {
      autonomy = request.choice
      return { ok: true, says: 'Autonomy is now cautious, for this project' }
    }
    return { ok: false }
  })
  for (const surface of SURFACES) {
    autonomy = 'balanced'
    await start($, surface)
    const ui = await mount($, surface)
    clear()
    await ui.press({ key: 'settings' })
    expect(seen.requests).toEqual([{ cmd: 'settings', cwd: ROOT }])
    const drawn = await texts(ui)
    expect(drawn).toContain('Autonomy: Balanced (this project)')
    expect(drawn).toContain('Pace: 2 (the default)')
    expect(drawn).toContain(ADVANCED)
    // One button per choice, in the bridge's order, the chosen one primary, then Board.
    expect(await buttons(ui)).toEqual([
      'stop',
      choiceKey('autonomy', 'cautious'), choiceKey('autonomy', 'balanced'), choiceKey('autonomy', 'trusting'),
      choiceKey('pace', '1'), choiceKey('pace', '2'), choiceKey('pace', '3'),
      choiceKey('notifications', 'ask'),
      'board',
    ])
    expect((await ui.find({ key: choiceKey('autonomy', 'balanced') }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: choiceKey('autonomy', 'cautious') }))?.props.variant).toBeUndefined()
    expect((await ui.find({ key: choiceKey('autonomy', 'cautious') }))?.props.label).toBe('Cautious')

    clear()
    await ui.press({ key: choiceKey('autonomy', 'cautious') })
    expect(seen.requests).toEqual([
      { cmd: 'setting', origin: 'pane', cwd: ROOT, key: 'autonomy', choice: 'cautious' },
      { cmd: 'settings', cwd: ROOT },
    ])
    expect(seen.toasts).toEqual(['Recording Cautious for Autonomy', 'Autonomy is now cautious, for this project'])
    // The rows are read again, so the new choice is the primary one.
    expect((await ui.find({ key: choiceKey('autonomy', 'cautious') }))?.props.variant).toBe('primary')
    expect(await texts(ui)).toContain('Autonomy: Cautious (this project)')

    // Board goes back to the board view.
    await ui.press({ key: 'board' })
    expect(await ui.find({ key: choiceKey('autonomy', 'cautious') })).toBeUndefined()
    expect((await ui.find({ key: 'settings' }))?.type).toBe('Button')
    await ui.unmount()
  }
})

test('a row that changes in the chat offers only Ask the front desk', async ($, on) => {
  const { seen, clear, start } = world(on, (request) => (request.cmd === 'settings' ? { ok: true, rows: rowsWith('balanced'), text: ADVANCED } : { ok: false }))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    const drawn = await texts(ui)
    expect(drawn).toContain('Notifications: On, quiet 22:00 to 07:00 (yours)')
    expect(drawn).toContain('Changed by asking the front desk')
    const offered = (await buttons(ui)).filter((key: string) => key.startsWith('setting:notifications:'))
    expect(offered).toEqual([choiceKey('notifications', 'ask')])
    expect((await ui.find({ key: choiceKey('notifications', 'ask') }))?.props.label).toBe('Ask the front desk')

    clear()
    await ui.press({ key: choiceKey('notifications', 'ask') })
    expect(seen.submits.map((p: any) => p.text)).toEqual(['Wheelhouse pane: the director wants to change Notifications.'])
    // It asks the front desk, not the bridge, and so carries no origin of its own.
    expect(seen.requests).toEqual([])
    await ui.press({ key: 'board' })
    await ui.unmount()
  }
})

test('a choice the bridge refuses or never answers is a toast, and leaves the choices live', async ($, on) => {
  let answer: Reply = { ok: false }
  const { seen, clear, start, clock } = world(on, (request) => (request.cmd === 'settings' ? { ok: true, rows: rowsWith('balanced'), text: ADVANCED } : answer))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    clear()
    answer = { ok: false, says: 'Settings change once STOP is lifted' }
    await ui.press({ key: choiceKey('pace', '3') })
    expect(seen.toasts).toEqual(['Recording 3 for Pace', 'Settings change once STOP is lifted'])
    clear()
    answer = { exitCode: 1 }
    await ui.press({ key: choiceKey('pace', '3') })
    expect(seen.toasts).toEqual(['Recording 3 for Pace', FAILED])
    expect((await ui.find({ key: choiceKey('pace', '3') }))?.type).toBe('Button')

    // While a choice is recorded, the others are plain text and a second press sends nothing.
    clear()
    answer = { hold: 2000, then: { ok: true, says: 'Pace is now 3, for this project' } }
    const pressed = ui.press({ key: choiceKey('pace', '3') })
    await clock.settle()
    await ui.redraw()
    expect(await texts(ui)).toContain('Recording…')
    expect(await ui.find({ key: choiceKey('pace', '1') })).toBeUndefined()
    expect(await ui.find({ key: choiceKey('notifications', 'ask') })).toBeUndefined()
    await clock.advance(2000)
    await pressed
    expect(seen.requests.filter((r: any) => r.cmd === 'setting')).toHaveLength(1)
    expect((await ui.find({ key: choiceKey('pace', '1') }))?.type).toBe('Button')
    await ui.press({ key: 'board' })
    await ui.unmount()
  }
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
    expect((await ui.find({ key: 'board' }))?.type).toBe('Button')
    await ui.press({ key: 'board' })
    await ui.unmount()
  }
})
