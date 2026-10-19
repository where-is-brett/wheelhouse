// tests/mod/messages.test.ts
// Wheelhouse traffic between sessions, the tick's prompts and /digest, run by `claude plugin test .`
// (npm run mod-check). The bridge's answers come from `$.process.run`, answered here; so do the
// prompts and deliveries that reach the session beneath the mod. The mod decides nothing: these
// tests check only that the front desk keeps another session's Wheelhouse message out and ticks
// instead, that every other message passes on as it came, that each prompt a tick's answer holds
// is handed on once and in order, and that /digest answers with the bridge's text.
import { test, expect, mock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/Users/someone/projects/shop'
const SESSION = '0b6a4e1c-4f3a-4d7e-9a51-2f3c8d9e1a77'
const TICK_MS = 15000
const FOREMAN_TICK_MS = 30000
const START = Date.parse('2026-10-19T03:00:50.000Z')
const RUN_RESULT = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const CONTEXT = { window: 200000, tokens: 1000, percent: 0.5 }
const FAILED = 'Wheelhouse couldn\'t record that'
const KEPT_OUT = 'Wheelhouse traffic, shown in the pane'

// Messages another Wheelhouse session sends: each first line starts with MESSAGE_LEAD.
const TRAFFIC = [
  'Wheelhouse: the banner change is ready for review',
  'Wheelhouse courier: card 3 waits for the director',
  'Wheelhouse builder: slice 2 of 3 finished\nThe tests pass.',
] as const
// Prompts led by the foreman's lead (FOREMAN_PROMPT_LEAD, scripts/foreman/start.js). They match
// MESSAGE_LEAD, but the foreman talks to no one: a session's first such prompt is how an
// app-started foreman learns its role, so it is never traffic (ruling 34).
const FOREMAN = [
  'Wheelhouse foreman: you are the long-lived foreman of shop. At each wake, follow the wheelhouse:foreman skill.',
  'Wheelhouse foreman: CI failed on pull request #4\nThe tests pass locally.',
] as const
// Messages that mention Wheelhouse without its lead on the first line.
const NOT_TRAFFIC = [
  'Please look at the Wheelhouse pane',
  'wheelhouse courier: lower case',
  'Wheelhouse Courier: a capital after the word',
  'A first line\nWheelhouse: on the second',
  ' Wheelhouse: after a space',
]

const model = () => ({
  v: 1, project: 'shop', at: '2026-10-19T03:00:50.000Z', glance: '2 cards wait',
  stop: { on: false, since: null }, cards: [], building: [], health: [], usage: null,
  finished: [], incidents: [], watcher: 'running', missing: [],
})
const frontDesk = (submit: string[] = []) => ({ ok: true, role: 'front-desk', every: TICK_MS, pane: model(), glance: '2 cards wait', status: '2 cards wait', submit })
const foreman = (submit: readonly string[] = []) => ({ ok: true, role: 'foreman', every: FOREMAN_TICK_MS, submit })
const feature = () => ({ ok: true, role: 'feature', every: 0 })
// A session in a folder setup is working on (ruling 38).
const setup = () => ({ ok: true, role: 'setup', every: TICK_MS })

type Reply = object | { exitCode: number } | 'no-start' | { hold: number, then: object }

// Registers the world beneath the mod and returns what it saw. `tick` answers each tick and
// `bridge` every other request: an answer object, a non-zero exit, a failure to start, or an
// answer held on the clock first.
function world(on: any, tick: () => Reply, bridge: (request: any) => Reply = () => ({ ok: true })) {
  const clock = mock.clock(on, { now: START })
  const panes = new Map<string, string>()
  const current = { session: SESSION }
  let sessions = 0
  const seen = {
    ticks: [] as any[], runs: [] as any[], prompts: [] as any[], receives: [] as any[],
    toasts: [] as string[], registered: [] as any[], commands: [] as any[],
  }
  on('session.id', () => ({ value: current.session }))
  on('session.root', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXT, rateLimits: [], cost: undefined } }))
  on('command.register', ($: any, e: any) => { seen.registered.push(e); return { value: { command: e.name } } })
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
      seen.runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs, request })
      got = bridge(request)
    }
    if (got.hold !== undefined) {
      await clock.sleep(got.hold)
      got = got.then
    }
    if (got === 'no-start') return { deny: '$.process.run(node) failed to start: ENOENT: Executable not found in $PATH: "node"' }
    if (got.exitCode !== undefined) return { value: { ...RUN_RESULT, exitCode: got.exitCode, stdout: '' } }
    if (got.stdout !== undefined) return { value: { ...RUN_RESULT, stdout: got.stdout } }
    return { value: { ...RUN_RESULT, stdout: `${JSON.stringify(got)}\n` } }
  })
  on('prompt.submit', ($: any, e: any) => { seen.prompts.push(e); return { text: e.text, origin: e.origin } })
  on('session.receive', ($: any, e: any) => { seen.receives.push(e); return { text: e.text } })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('command.run', ($: any, e: any) => { seen.commands.push(e); return { text: 'the engine ran it' } })
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

const submit = ($: any, text: string, kind: string, extra: object = {}) =>
  $.prompt.submit({ text, origin: { kind }, wait: false, ...extra })
const receive = ($: any, text: string, origin: object, extra: object = {}) =>
  $.session.receive({ text, origin, ...extra })

// Whether any request the mod sent the bridge holds the text.
const sentText = (seen: { runs: any[], ticks: any[] }, text: string) =>
  [...seen.runs.map((r) => r.request), ...seen.ticks].some((request) => JSON.stringify(request).includes(JSON.stringify(text).slice(1, -1)))

test('a peer or sdk message led by Wheelhouse is kept out of the front desk and starts a tick', async ($, on) => {
  const { seen, clear, start, clock } = world(on, () => frontDesk())
  for (const surface of SURFACES) {
    await start($, surface)
    expect(seen.ticks).toHaveLength(1)

    for (const kind of ['sdk', 'peer']) {
      for (const text of TRAFFIC) {
        clear()
        const result = await submit($, text, kind)
        expect(result).toEqual({ drop: KEPT_OUT })
        await clock.settle()
        expect(seen.prompts).toHaveLength(0)
        // The message only starts a tick; it never reaches the bridge.
        expect(seen.ticks).toHaveLength(1)
        expect(seen.runs).toHaveLength(0)
        expect(sentText(seen, text)).toBe(false)
      }
    }

    for (const text of TRAFFIC) {
      clear()
      const result = await receive($, text, { kind: 'peer' })
      expect(result).toEqual({ consumed: KEPT_OUT })
      await clock.settle()
      expect(seen.receives).toHaveLength(0)
      expect(seen.ticks).toHaveLength(1)
      expect(seen.runs).toHaveLength(0)
      expect(sentText(seen, text)).toBe(false)
    }

    // A peer or sdk message without the lead on its first line passes on as it came.
    for (const text of NOT_TRAFFIC) {
      clear()
      for (const kind of ['sdk', 'peer']) expect(await submit($, text, kind)).toMatchObject({ text })
      expect(await receive($, text, { kind: 'peer' })).toEqual({ text })
      await clock.settle()
      expect(seen.prompts.map((p: any) => p.text)).toEqual([text, text])
      expect(seen.prompts.map((p: any) => p.origin.kind)).toEqual(['sdk', 'peer'])
      expect(seen.receives.map((r: any) => r.text)).toEqual([text])
      expect(seen.ticks).toHaveLength(0)
      expect(seen.runs).toHaveLength(0)
    }

    // A delivery for one of the session's agents is not the front desk's conversation: it passes on.
    clear()
    expect(await receive($, TRAFFIC[1], { kind: 'peer' }, { agentId: 'agent-1' })).toEqual({ text: TRAFFIC[1] })
    expect(seen.receives).toHaveLength(1)
    expect(seen.receives[0].agentId).toBe('agent-1')
  }
})

test('a prompt led by the foreman\'s lead passes on unchanged in a front desk\'s session', async ($, on) => {
  const { seen, clear, start, clock } = world(on, () => frontDesk())
  for (const surface of SURFACES) {
    await start($, surface)
    expect(seen.ticks).toHaveLength(1)
    for (const text of FOREMAN) {
      clear()
      for (const kind of ['sdk', 'peer']) expect(await submit($, text, kind)).toMatchObject({ text })
      expect(await receive($, text, { kind: 'peer' })).toEqual({ text })
      await clock.settle()
      expect(seen.prompts.map((p: any) => [p.text, p.origin.kind])).toEqual([[text, 'sdk'], [text, 'peer']])
      expect(seen.receives.map((r: any) => r.text)).toEqual([text])
      expect(seen.ticks).toHaveLength(0)
      expect(seen.runs).toHaveLength(0)
    }
  }
})

test('an app-started foreman\'s first prompt reaches the session after a first tick that answered front desk', async ($, on) => {
  // The foreman's session is known only from its first prompt, which arrives after the mod's
  // first tick; until the role is recorded, that tick answers as the front desk's.
  let reply: object = frontDesk()
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk()
    await start($, surface)
    expect(seen.ticks).toHaveLength(1)
    clear()
    const first = await submit($, FOREMAN[0], 'sdk')
    expect(first).toEqual({ text: FOREMAN[0], origin: { kind: 'sdk' } })
    expect(seen.prompts).toHaveLength(1)
    expect(seen.prompts[0].text).toBe(FOREMAN[0])
    expect(seen.prompts[0].origin).toEqual({ kind: 'sdk' })
    await clock.settle()
    expect(seen.ticks).toHaveLength(0)
    expect(seen.runs).toHaveLength(0)

    // Once the role is recorded, the next tick answers as the foreman's.
    reply = foreman()
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.ticks[0].cmd).toBe('tick')
  }
})

test('the same message reaches a feature session, the foreman or a session still in setup unchanged', async ($, on) => {
  let reply: object = feature()
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    for (const answer of [feature(), foreman(), { ok: true, role: 'foreman', every: 0, submit: [] }, setup()]) {
      reply = answer
      await start($, surface)
      expect(seen.ticks).toHaveLength(1)
      for (const text of TRAFFIC) {
        clear()
        for (const kind of ['sdk', 'peer']) expect(await submit($, text, kind)).toMatchObject({ text })
        expect(await receive($, text, { kind: 'peer' })).toEqual({ text })
        await clock.settle()
        expect(seen.prompts.map((p: any) => [p.text, p.origin.kind])).toEqual([[text, 'sdk'], [text, 'peer']])
        expect(seen.receives.map((r: any) => r.text)).toEqual([text])
        expect(seen.ticks).toHaveLength(0)
        expect(seen.runs).toHaveLength(0)
      }
    }

    // A front desk that later answers as another role passes traffic on from then.
    reply = frontDesk()
    await start($, surface)
    clear()
    expect(await submit($, TRAFFIC[0], 'peer')).toEqual({ drop: KEPT_OUT })
    await clock.settle()
    reply = feature()
    await clock.advance(TICK_MS)
    clear()
    expect(await submit($, TRAFFIC[0], 'peer')).toMatchObject({ text: TRAFFIC[0] })
    expect(seen.prompts.map((p: any) => p.text)).toEqual([TRAFFIC[0]])

    // And one whose folder goes into setup, until setup finishes and it is the front desk again.
    reply = frontDesk()
    await start($, surface)
    reply = setup()
    await clock.advance(TICK_MS)
    clear()
    expect(await submit($, TRAFFIC[1], 'peer')).toMatchObject({ text: TRAFFIC[1] })
    expect(await receive($, TRAFFIC[1], { kind: 'sdk' })).toEqual({ text: TRAFFIC[1] })
    reply = frontDesk()
    await clock.advance(TICK_MS)
    clear()
    expect(await submit($, TRAFFIC[1], 'peer')).toEqual({ drop: KEPT_OUT })
    await clock.settle()
  }
})

// Each surface in a test of its own, so the session's state holds no role from an earlier answer.
for (const surface of SURFACES) {
  test(`a front desk passes traffic on until its first tick answers (${surface})`, async ($, on) => {
    const { seen, clear, start, clock } = world(on, () => ({ hold: 40000, then: frontDesk() }))
    await start($, surface)
    expect(seen.ticks).toHaveLength(1)
    clear()
    for (const kind of ['sdk', 'peer']) expect(await submit($, TRAFFIC[1], kind)).toMatchObject({ text: TRAFFIC[1] })
    expect(await receive($, TRAFFIC[1], { kind: 'peer' })).toEqual({ text: TRAFFIC[1] })
    expect(seen.prompts).toHaveLength(2)
    expect(seen.receives).toHaveLength(1)

    // Once the front desk's answer is in, the same message is kept out.
    await clock.advance(40000)
    clear()
    expect(await submit($, TRAFFIC[1], 'peer')).toEqual({ drop: KEPT_OUT })
    expect(seen.prompts).toHaveLength(0)
  })
}

test('a typed or phoned message led by Wheelhouse passes on unchanged', async ($, on) => {
  const { seen, clear, start, clock } = world(on, () => frontDesk(), () => ({ ok: true, says: 'Recorded: Approve pull request #4' }))
  for (const surface of SURFACES) {
    await start($, surface)
    for (const kind of ['composer', 'bridge']) {
      for (const text of TRAFFIC) {
        clear()
        const result = await submit($, text, kind)
        await clock.settle()
        expect(result).toMatchObject({ text })
        expect(seen.prompts.map((p: any) => [p.text, p.origin.kind])).toEqual([[text, kind]])
        expect(seen.ticks).toHaveLength(0)
        expect(seen.runs).toHaveLength(0)
      }

      // The reply-code path is the same in the front desk's session.
      clear()
      expect(await submit($, 'K7QD Approve', kind)).toMatchObject({ text: 'K7QD Approve' })
      expect(seen.runs.map((r: any) => r.request)).toEqual([{ cmd: 'reply', origin: kind, text: 'K7QD Approve', cwd: ROOT }])
      expect(seen.toasts).toEqual(['Recorded: Approve pull request #4'])
      expect(seen.prompts.map((p: any) => p.text)).toEqual(['K7QD Approve'])
    }

    // A phoned stop still sends stop.
    clear()
    await submit($, 'stop', 'bridge')
    expect(seen.runs.map((r: any) => r.request)).toEqual([{ cmd: 'stop', origin: 'bridge', cwd: ROOT }])
    expect(seen.prompts.map((p: any) => p.text)).toEqual(['stop'])

    // A phoned message delivered to the session passes on as well.
    clear()
    expect(await receive($, TRAFFIC[0], { kind: 'bridge' })).toEqual({ text: TRAFFIC[0] })
    expect(seen.receives).toHaveLength(1)
  }
})

test('a task notification passes on unchanged', async ($, on) => {
  const { seen, clear, start, clock } = world(on, () => frontDesk())
  for (const surface of SURFACES) {
    await start($, surface)
    for (const text of TRAFFIC) {
      clear()
      expect(await submit($, text, 'task-notification')).toMatchObject({ text })
      expect(await $.prompt.submit({ text, origin: { kind: 'plugin', name: 'another-plugin' }, wait: false })).toMatchObject({ text })
      expect(await submit($, text, 'scheduled-trigger')).toMatchObject({ text })
      expect(await receive($, text, { kind: 'task-notification' })).toEqual({ text })
      expect(await receive($, text, { kind: 'coordinator' })).toEqual({ text })
      await clock.settle()
      expect(seen.prompts.map((p: any) => p.origin.kind)).toEqual(['task-notification', 'plugin', 'scheduled-trigger'])
      expect(seen.prompts.every((p: any) => p.text === text)).toBe(true)
      expect(seen.receives.map((r: any) => r.origin.kind)).toEqual(['task-notification', 'coordinator'])
      expect(seen.ticks).toHaveLength(0)
      expect(seen.runs).toHaveLength(0)
    }
  }
})

test('the courier\'s wake is submitted once, in the front desk', async ($, on) => {
  const WAKE = 'Wheelhouse courier: 2 cards wait, and the build stopped.'
  let reply: object = frontDesk([WAKE])
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = frontDesk([WAKE])
    await start($, surface)
    expect(seen.ticks).toHaveLength(1)
    // Handed on as the mod's own prompt: never kept out, and never sent to the bridge.
    expect(seen.prompts.map((p: any) => p.text)).toEqual([WAKE])
    expect(seen.prompts[0].origin.kind).toBe('plugin')
    expect(seen.runs).toHaveLength(0)

    // The bridge has marked it, so the next tick holds none, and nothing is submitted again.
    reply = frontDesk()
    clear()
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.prompts).toHaveLength(0)
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(2)
    expect(seen.prompts).toHaveLength(0)

    // A later wake is handed on in its turn.
    reply = frontDesk([WAKE])
    clear()
    await clock.advance(TICK_MS)
    expect(seen.prompts.map((p: any) => p.text)).toEqual([WAKE])

    // A tick that failed hands on nothing.
    reply = { exitCode: 1 }
    clear()
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.prompts).toHaveLength(0)
  }
})

test('a Shape 2 foreman\'s tick submits each wake line in order', async ($, on) => {
  const LINES = ['Wheelhouse watcher: CI failed on pull request #4', 'Wheelhouse watcher: pull request #5 merged', 'Wheelhouse watcher: review asked on #6'] as const
  let reply: object = foreman(LINES)
  const { seen, clear, start, clock } = world(on, () => reply)
  for (const surface of SURFACES) {
    reply = foreman(LINES)
    await start($, surface)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.prompts.map((p: any) => p.text)).toEqual(LINES)
    expect(seen.runs).toHaveLength(0)

    // The next tick, at the foreman's interval, holds none: nothing is submitted again.
    reply = foreman()
    clear()
    await clock.advance(TICK_MS)
    expect(seen.ticks).toHaveLength(0)
    await clock.advance(FOREMAN_TICK_MS - TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.prompts).toHaveLength(0)

    reply = foreman([LINES[2], LINES[0]])
    clear()
    await clock.advance(FOREMAN_TICK_MS)
    expect(seen.prompts.map((p: any) => p.text)).toEqual([LINES[2], LINES[0]])

    // A foreman's project that needs no watcher stops the ticks.
    reply = { ok: true, role: 'foreman', every: 0, submit: [] }
    clear()
    await clock.advance(FOREMAN_TICK_MS)
    expect(seen.ticks).toHaveLength(1)
    await clock.advance(FOREMAN_TICK_MS * 3)
    expect(seen.ticks).toHaveLength(1)
    expect(seen.prompts).toHaveLength(0)
  }
})

test('/digest answers with the bridge\'s briefing', async ($, on) => {
  const BRIEFING = 'Since you were last here\n\nThe banner change merged. 2 cards wait.'
  let answer: Reply = { ok: true, text: BRIEFING }
  const { seen, clear, start } = world(on, () => feature(), () => answer)
  for (const surface of SURFACES) {
    await start($, surface)
    expect(seen.registered).toEqual([
      { name: 'go', description: 'Lift STOP' },
      { name: 'wheelhouse', description: 'Open Wheelhouse\'s pane' },
      { name: 'digest', description: 'Show the briefing, with no Claude turn' },
    ])

    for (const kind of ['composer', 'bridge'] as const) {
      answer = { ok: true, text: BRIEFING }
      clear()
      const result = await $.command.run({ command: 'digest', args: '', origin: { kind }, presentation: PRESENTATION })
      expect(result).toMatchObject({ text: BRIEFING })
      expect(seen.runs).toHaveLength(1)
      expect(seen.runs[0].argv[0]).toBe('node')
      expect(seen.runs[0].argv[1]).toEndWith('/scripts/mod/bridge.js')
      expect(seen.runs[0].timeoutMs).toBe(6500)
      expect(seen.runs[0].request).toEqual({ cmd: 'digest', origin: kind, cwd: ROOT })
      expect(seen.toasts).toHaveLength(0)
      expect(seen.commands).toHaveLength(0)
    }

    // The bridge's own words when it has no briefing are the answer, and nothing else.
    answer = { ok: false, text: 'This folder isn\'t a Wheelhouse project.' }
    clear()
    expect(await $.command.run({ command: 'digest', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION }))
      .toMatchObject({ text: 'This folder isn\'t a Wheelhouse project.' })
    expect(seen.toasts).toHaveLength(0)

    // No answer at all is the mod's own words and a toast.
    for (const failure of ['no-start', { exitCode: 1 }, { stdout: 'not json\n' }, { stdout: '{"text":"no ok"}\n' }] as Reply[]) {
      answer = failure
      clear()
      expect(await $.command.run({ command: 'digest', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION }))
        .toMatchObject({ text: FAILED })
      expect(seen.toasts).toEqual([FAILED])
      expect(seen.commands).toHaveLength(0)
    }
  }
})
