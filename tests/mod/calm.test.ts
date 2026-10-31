// tests/mod/calm.test.ts
// The pane drawn in Calm (hooks/mod/calm.tsx, hooks/mod/pane.tsx), run by `claude plugin test .`
// (npm run mod-check): the type styles, the four shapes, the groups and the theme keys. The
// bridge's tick answers come from `$.process.run`, answered here.
import { test, expect, mock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/Users/someone/projects/shop'
const SESSION = '0b6a4e1c-4f3a-4d7e-9a51-2f3c8d9e1a77'
const TICK_MS = 15000
const START = Date.parse('2026-10-19T03:00:50.000Z')
const RUN_RESULT = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const CONTEXT = { window: 200000, tokens: 1000, percent: 0.5 }
const PANE_PROPS = {
  title: 'Wheelhouse', isFocused: false, bodyColumns: 48, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}
// The theme keys the mod may colour with.
const THEME = ['text', 'dimColor', 'subtle', 'suggestion', 'error', 'warning', 'success', 'composerSidebarBackground', 'selectionBg', 'diffRemovedDimmed', 'rate_limit_fill', 'rate_limit_empty']
const STOP_HALTS = 'Halts the whole Crew at once.'
const ONLY_YOU_LIFT = 'Only you can lift it.'

const card = (n: number, ask: string, extra: object = {}) => ({
  id: `card-${n}`, n, header: 'Approve', kind: 'approve', text: `Card ${n}'s question`, hash: `${n}`.repeat(12),
  buttons: [{ label: 'Approve', does: 'record' }], note: null, blocking: false, asked: false, parts: { ask }, ...extra,
})

const model = (over: object = {}) => ({
  v: 1,
  project: 'shop',
  at: '2026-10-19T03:00:50.000Z',
  glance: 'Wheelhouse',
  verdict: 'Two things need you. Nothing is broken.',
  since: 'Since you were last here at 09:10.',
  launch: { resolved: 3, total: 5, gained: 1, next: [{ text: 'Connect payments', yours: true }] },
  ideas: { count: 4, fresh: 1 },
  updated: '14:02',
  stop: { on: false, since: null },
  cards: [card(1, 'Put the banner live?'), card(2, 'how exported files are named', { parts: { ask: 'how exported files are named', optional: 3 } })],
  building: [{ text: 'The banner', see: 'You\'ll see it tomorrow' }],
  health: [],
  healthNote: { allWell: true, protection: 'Standard', week: 'This week: 34% of the allowance' },
  usage: null,
  finished: [],
  incidents: [],
  watcher: 'running',
  missing: [],
  ...over,
})

type Reply = object | { exitCode: number }

// `held.reply` is the bridge's answer to each tick; a test changes it between draws.
function world(on: any, held: { reply: Reply }) {
  const clock = mock.clock(on, { now: START })
  const panes = new Map<string, string>()
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXT, rateLimits: [], cost: undefined } }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => { panes.set(e.id, e.title ?? e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($: any, e: any) => { panes.delete(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [...panes].map(([id, title]) => ({ id, title, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', async ($: any, e: any) => {
    const request = JSON.parse(e.init?.stdin ?? 'null')
    const got: any = request?.cmd === 'tick' ? held.reply : { ok: true }
    if (got.exitCode !== undefined) return { value: { ...RUN_RESULT, exitCode: got.exitCode, stdout: '' } }
    return { value: { ...RUN_RESULT, stdout: `${JSON.stringify(got)}\n` } }
  })
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, origin: e.origin }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('command.run', () => ({ text: 'the engine ran it' }))
  return { clock }
}

const frontDesk = (pane: object) => ({ ok: true, role: 'front-desk', every: TICK_MS, pane, glance: 'Wheelhouse', status: 'Wheelhouse' })
const mount = ($: any, surface: string) => $.ui.mount({ plugin: 'wheelhouse', surface, component: 'Pane', requestId: 'wheelhouse', props: PANE_PROPS })
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
const textOf = async (ui: any, words: string) => (await ui.findAll({ type: 'Text' })).find((t: any) => t.text === words)
// Registers the world once for a test, and draws the pane on a surface with `pane` as the first
// tick's answer, the first tick finished.
function setup(on: any) {
  const held: { reply: Reply } = { reply: frontDesk(model()) }
  const { clock } = world(on, held)
  const drawn = async ($: any, surface: string, pane: object = model()) => {
    held.reply = frontDesk(pane)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
    return mount($, surface)
  }
  return { held, clock, drawn }
}

test('the pane draws STOP outlined with its label in error, and its line beside it in footnote', async ($, on) => {
  const { drawn } = setup(on)
  for (const surface of SURFACES) {
    const ui = await drawn($, surface)
    const stop = await ui.find({ key: 'stop' })
    expect(stop.type).toBe('Button')
    expect(stop.props.variant).toBe('secondary')
    expect(stop.props.label).toBe('All stop')
    expect((await textOf(ui, 'All stop')).props.color).toBe('error')
    const words = await textOf(ui, STOP_HALTS)
    expect(words.props.size).toBe('footnote')
    expect(words.props.dimColor).toBe(true)
    const drawnTexts = await texts(ui)
    expect(drawnTexts.indexOf(STOP_HALTS)).toBe(drawnTexts.indexOf('All stop') + 1)
    // Never beside a filled button.
    expect((await ui.findAll({ type: 'Button' })).filter((b: any) => b.props.variant === 'primary')).toHaveLength(0)
    await ui.unmount()
  }
})

test('under STOP the pane leads with the STOP is on group and a filled Lift STOP', async ($, on) => {
  const stopped = model({ stop: { on: true, since: '2026-10-19T02:00:00.000Z' }, health: [{ level: 'stop', text: 'All stop is on, since 19 October 2026', of: 'stop' }] })
  const { drawn } = setup(on)
  for (const surface of SURFACES) {
    const ui = await drawn($, surface, stopped)
    expect(await ui.find({ key: 'stop' })).toBeUndefined()
    const lift = await ui.find({ key: 'lift-stop' })
    expect(lift.props.variant).toBe('primary')
    expect(lift.props.label).toBe('Lift All stop')
    const lead = (await texts(ui)).slice(0, 3)
    expect(lead).toEqual(['All stop is on', 'Since 19 October 2026', ONLY_YOU_LIFT])
    const heading = await textOf(ui, 'All stop is on')
    expect(heading.props.size).toBe('title')
    expect(heading.props.weight).toBe('semibold')
    await ui.unmount()
  }
})

test('the verdict is a title, and the since line follows it in footnote', async ($, on) => {
  const { drawn } = setup(on)
  for (const surface of SURFACES) {
    const ui = await drawn($, surface)
    const verdict = await textOf(ui, 'Two things need you. Nothing is broken.')
    expect(verdict.props.size).toBe('title')
    expect(verdict.props.weight).toBe('semibold')
    const drawnTexts = await texts(ui)
    const since = await textOf(ui, 'Since you were last here at 09:10.')
    expect(since.props.size).toBe('footnote')
    expect(drawnTexts.indexOf(since.text)).toBe(drawnTexts.indexOf(verdict.text) + 1)
    await ui.unmount()
  }
})

test('Nothing needs you. stands in the card\'s place in success, unless the verdict already says it', async ($, on) => {
  const { drawn } = setup(on)
  for (const surface of SURFACES) {
    const said = await drawn($, surface, model({ cards: [], verdict: 'Nothing needs you. Nothing is broken.' }))
    expect(await texts(said)).not.toContain('Nothing needs you.')
    await said.unmount()
    const ui = await drawn($, surface, model({ cards: [], verdict: 'One thing to watch.' }))
    expect((await textOf(ui, 'Nothing needs you.')).props.color).toBe('success')
    expect((await texts(ui)).some((t: string) => t.startsWith('Card '))).toBe(false)
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    await ui.unmount()
  }
})

test('each part is a raised panel with the quiet line, named above it, and an empty part is left out', async ($, on) => {
  const { drawn } = setup(on)
  for (const surface of SURFACES) {
    const full = await drawn($, surface)
    const groups = (await full.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle !== undefined)
    // The card, Being built, Launch, and Health and this week. The foot stands on the page.
    expect(groups).toHaveLength(4)
    for (const g of groups) {
      expect(g.props.borderStyle).toBe('round')
      expect(g.props.borderColor).toBeUndefined()
      // The terminal draws a fill as a block, so it keeps the line alone.
      expect(g.props.backgroundColor).toBe(surface === 'terminal' ? undefined : 'composerSidebarBackground')
    }
    const name = await textOf(full, 'Being built')
    expect(name.props.size).toBe('footnote')
    expect(name.props.weight).toBe('medium')
    expect(name.props.dimColor).toBe(true)
    await full.unmount()

    const bare = await drawn($, surface, model({ building: [], launch: null, ideas: { count: 0, fresh: 0 }, healthNote: { allWell: false, protection: null, week: null } }))
    const left = await texts(bare)
    for (const gone of ['Being built', 'Launch', 'Health and this week']) expect(left).not.toContain(gone)
    expect((await bare.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle !== undefined)).toHaveLength(1)
    await bare.unmount()
  }
})

test('no element carries a literal colour', async ($, on) => {
  const stopped = model({ stop: { on: true, since: null }, health: [{ level: 'watch', text: 'CI is failing on main', of: null }], healthNote: { allWell: false, protection: 'Standard', week: null } })
  const { drawn } = setup(on)
  for (const surface of SURFACES) {
    for (const pane of [model(), stopped]) {
      const ui = await drawn($, surface, pane)
      let seen = 0
      for (const type of ['Text', 'Box', 'Button']) {
        for (const element of await ui.findAll({ type })) {
          for (const key of ['color', 'borderColor', 'backgroundColor']) {
            const value = element.props[key]
            if (value === undefined) continue
            seen += 1
            expect(THEME).toContain(value)
          }
        }
      }
      expect(seen).toBeGreaterThan(0)
      await ui.unmount()
    }
  }
})

test('the stale line is in warning and the figures are not shown as current', async ($, on) => {
  const { held, clock, drawn } = setup(on)
  for (const surface of SURFACES) {
    const ui = await drawn($, surface)
    expect((await texts(ui)).some((t: string) => t.startsWith('Couldn\'t read'))).toBe(false)
    held.reply = { exitCode: 1 }
    await clock.advance(TICK_MS)
    await ui.redraw()
    const line = (await texts(ui))[0]
    expect(line).toMatch(/^Couldn't read the latest at \d\d:\d\d\. Showing \d\d:\d\d's\.$/)
    expect((await textOf(ui, line)).props.color).toBe('warning')
    await ui.unmount()
  }
})

test('the launch bar is drawn on a surface with fills, one step per blocker', async ($, on) => {
  const { drawn } = setup(on)
  const steps = async (ui: any, key: string) => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.backgroundColor === key)
  const ui = await drawn($, 'desktop')
  expect(await steps(ui, 'rate_limit_fill')).toHaveLength(3)
  expect(await steps(ui, 'rate_limit_empty')).toHaveLength(2)
  await ui.unmount()
  const terminal = await drawn($, 'terminal')
  expect(await steps(terminal, 'rate_limit_fill')).toHaveLength(0)
  await terminal.unmount()
})

test('a card\'s recommendation sits in the soft band, and All stop in its red panel', async ($, on) => {
  const { drawn } = setup(on)
  const held = model({ cards: [card(1, 'Put the banner live?', { parts: { ask: 'Put the banner live?', recommendation: 'Approve, because the checks passed.' } })] })
  const band = async (ui: any, key: string) => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.backgroundColor === key)
  const ui = await drawn($, 'desktop', held)
  expect(await band(ui, 'selectionBg')).toHaveLength(1)
  await ui.unmount()
  const stopped = await drawn($, 'desktop', model({ stop: { on: true, since: null } }))
  expect(await band(stopped, 'diffRemovedDimmed')).toHaveLength(1)
  await stopped.unmount()
  const terminal = await drawn($, 'terminal', held)
  expect(await band(terminal, 'selectionBg')).toHaveLength(0)
  await terminal.unmount()
})

test('Back and Next are small, and the next card\'s subject is shown', async ($, on) => {
  const { drawn } = setup(on)
  for (const surface of SURFACES) {
    const ui = await drawn($, surface)
    expect(await texts(ui)).toContain('Next: how exported files are named · optional · 3 min')
    const next = await ui.find({ key: 'next' })
    expect(next.props.plain).toBe(true)
    expect(next.props.dimColor).toBe(true)
    expect((await textOf(ui, 'Next')).props.size).toBe('footnote')
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.press({ key: 'next' })
    expect(await texts(ui)).not.toContain('Next: how exported files are named · optional · 3 min')
    const back = await ui.find({ key: 'back' })
    expect(back.props.plain).toBe(true)
    expect((await textOf(ui, 'Back')).props.size).toBe('footnote')
    // The session's state outlasts the surface: the next one starts on the first card.
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the foot has Settings alone on the board view, and Done takes the settings view back', async ($, on) => {
  const { drawn } = setup(on)
  for (const surface of SURFACES) {
    const ui = await drawn($, surface)
    expect(await ui.find({ key: 'done' })).toBeUndefined()
    expect((await ui.find({ key: 'settings' }))?.type).toBe('Button')
    await ui.press({ key: 'settings' })
    await ui.redraw()
    expect((await ui.find({ key: 'done' }))?.type).toBe('Button')
    expect(await ui.find({ key: 'settings' })).toBeUndefined()
    await ui.press({ key: 'done' })
    await ui.redraw()
    expect(await ui.find({ key: 'done' })).toBeUndefined()
    expect((await ui.find({ key: 'settings' }))?.type).toBe('Button')
    await ui.unmount()
  }
})

test('the week\'s usage line shows once in Health and this week', async ($, on) => {
  const { drawn } = setup(on)
  const WEEK = 'Usage this week: 1% of your weekly allowance.'
  for (const surface of SURFACES) {
    // The bridge gives the same line as the health note's week and as the usage line.
    const both = await drawn($, surface, model({ usage: WEEK, healthNote: { allWell: true, protection: 'Standard', week: WEEK } }))
    expect((await texts(both)).filter((t: string) => t === WEEK)).toHaveLength(1)
    await both.unmount()
    // A model with no week in its health note still shows the usage line, once.
    const older = await drawn($, surface, model({ usage: WEEK, healthNote: { allWell: true, protection: 'Standard', week: null } }))
    expect((await texts(older)).filter((t: string) => t === WEEK)).toHaveLength(1)
    await older.unmount()
  }
})
