// tests/mod/register.test.ts
// The mod's hooks, run by `claude plugin test .` (npm run mod-check), not by node --test.
// Everything beneath the mod is answered here: the session's figures, the command and toast
// calls, and `$.process.run`, which stands in for the bridge and never starts a process.
import { test, expect, mock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/Users/someone/projects/shop'
const SESSION = '0b6a4e1c-4f3a-4d7e-9a51-2f3c8d9e1a77'
const FAILED = 'Wheelhouse couldn\'t record that'
const RUN_RESULT = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const CONTEXT = { window: 200000, tokens: 1000, percent: 0.5 }

type Answer = { exitCode?: number, stdout?: string } | 'no-start'

// Registers the world beneath the mod and returns what it saw. `answer` says how the bridge
// answers each request: a line it prints, a non-zero exit, or a failure to start.
function world(on: any, answer: (request: any) => Answer = () => ({ stdout: '{"ok":true}\n' })) {
  const clock = mock.clock(on)
  const hold = { usage: false }
  const seen = { runs: [] as any[], toasts: [] as string[], prompts: [] as any[], commands: [] as any[], registered: [] as any[] }
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: CONTEXT,
    rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-19T05:00:00.000Z' }],
    cost: { usd: 1.25 },
  } }))
  on('command.register', ($: any, e: any) => { seen.registered.push(e); return { value: { command: e.name } } })
  on('ui.toast', ($: any, e: any) => { seen.toasts.push(e.text); return { value: undefined } })
  on('process.run', async ($: any, e: any) => {
    const request = JSON.parse(e.init?.stdin ?? 'null')
    seen.runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs, request })
    if (hold.usage && request?.cmd === 'usage') await clock.sleep(60000)
    const got = answer(request)
    if (got === 'no-start') return { deny: '$.process.run(node) failed to start: ENOENT: Executable not found in $PATH: "node"' }
    return { value: { ...RUN_RESULT, exitCode: got.exitCode ?? 0, stdout: got.stdout ?? '' } }
  })
  on('prompt.submit', ($: any, e: any) => { seen.prompts.push(e); return { text: e.text, origin: e.origin } })
  on('command.run', ($: any, e: any) => { seen.commands.push(e); return { text: 'the engine ran it' } })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  const clear = () => { for (const list of Object.values(seen)) list.length = 0 }
  // The session start sends its usage reading without waiting for it; `start` lets it finish.
  const start = async ($: any, surface: string) => {
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
  }
  return { seen, clear, start, hold, clock }
}

// Starts the session on the surface, then forgets what the start did.
async function startOn($: any, surface: string, w: { clear: () => void, start: ($: any, surface: string) => Promise<void> }) {
  await w.start($, surface)
  w.clear()
}

const submit = ($: any, text: string, kind: string, extra: object = {}) =>
  $.prompt.submit({ text, origin: { kind }, wait: false, ...extra })

const bridgeCall = (run: any) => {
  expect(run.argv).toHaveLength(2)
  expect(run.argv[0]).toBe('node')
  expect(run.argv[1]).toEndWith('/scripts/mod/bridge.js')
  expect(run.timeoutMs).toBe(5000)
  return run.request
}

test('a typed reply code is sent to the bridge with origin composer, and the message passes unchanged', async ($, on) => {
  const { seen, clear, start } = world(on, () => ({ stdout: '{"ok":true,"says":"Recorded: Approve pull request #4"}\n' }))
  for (const surface of SURFACES) {
    await startOn($, surface, { clear, start })
    const result = await submit($, 'K7QD Approve', 'composer')
    expect(seen.runs).toHaveLength(1)
    expect(bridgeCall(seen.runs[0])).toEqual({ cmd: 'reply', origin: 'composer', text: 'K7QD Approve', cwd: ROOT })
    expect(seen.toasts).toEqual(['Recorded: Approve pull request #4'])
    expect(seen.prompts).toHaveLength(1)
    expect(seen.prompts[0].text).toBe('K7QD Approve')
    expect(seen.prompts[0].origin).toEqual({ kind: 'composer' })
    expect(result).toMatchObject({ text: 'K7QD Approve' })

    clear()
    await submit($, 'k7qd  approve.', 'bridge')
    expect(bridgeCall(seen.runs[0])).toEqual({ cmd: 'reply', origin: 'bridge', text: 'k7qd  approve.', cwd: ROOT })
    expect(seen.prompts[0].text).toBe('k7qd  approve.')

    clear()
    await submit($, 'k7qd do it.', 'composer')
    expect(bridgeCall(seen.runs[0])).toEqual({ cmd: 'reply', origin: 'composer', text: 'k7qd do it.', cwd: ROOT })
    expect(seen.prompts[0].text).toBe('k7qd do it.')

    // Ordinary messages, even ones that start with four letters of the code alphabet, and
    // options no signed record answers, send nothing.
    clear()
    const ordinary = ['What do you think', 'Have a look', 'Then carry on', 'K7QD', 'k7qd Maybe', 'K7Q Maybe', 'K7QD1 Maybe', 'Please approve the pull request']
    for (const text of ordinary) await submit($, text, 'composer')
    expect(seen.runs).toHaveLength(0)
    expect(seen.toasts).toHaveLength(0)
    expect(seen.prompts.map((p: any) => p.text)).toEqual(ordinary)
  }
})

test('a code in capitals and any short option is sent, and shown only when it made a record', async ($, on) => {
  let line = '{"ok":false,"says":"That card doesn\'t offer Maybe"}\n'
  const { seen, clear, start } = world(on, () => ({ stdout: line }))
  for (const surface of SURFACES) {
    await startOn($, surface, { clear, start })
    for (const origin of ['composer', 'bridge']) {
      // A refusal is not shown, and neither is a bridge that fails; the message passes on as it was.
      clear()
      line = '{"ok":false,"says":"That card doesn\'t offer Maybe"}\n'
      const refused = await submit($, 'K7QD Maybe', origin)
      expect(bridgeCall(seen.runs[0])).toEqual({ cmd: 'reply', origin, text: 'K7QD Maybe', cwd: ROOT })
      expect(seen.toasts).toHaveLength(0)
      expect(seen.prompts.map((p: any) => p.text)).toEqual(['K7QD Maybe'])
      expect(refused).toMatchObject({ text: 'K7QD Maybe' })

      clear()
      line = 'not json\n'
      await submit($, 'ASAP fix the banner', origin)
      expect(seen.runs).toHaveLength(1)
      expect(seen.toasts).toHaveLength(0)
      expect(seen.prompts.map((p: any) => p.text)).toEqual(['ASAP fix the banner'])

      // A record made is shown.
      clear()
      line = '{"ok":true,"says":"Recorded: Answer: Comma"}\n'
      await submit($, '  K7QD   Comma. ', origin)
      expect(bridgeCall(seen.runs[0])).toEqual({ cmd: 'reply', origin, text: '  K7QD   Comma. ', cwd: ROOT })
      expect(seen.toasts).toEqual(['Recorded: Answer: Comma'])
    }

    // The first form keeps its toasts, a refusal included.
    clear()
    line = '{"ok":false,"says":"That code has been used"}\n'
    await submit($, 'K7QD Approve', 'composer')
    expect(seen.toasts).toEqual(['That code has been used'])

    // An option past 80 characters, or with a control character, and a lowercase code, send nothing.
    clear()
    const unsent = [`K7QD ${'x'.repeat(81)}`, 'K7QD Com\u0007ma', 'K7QD Co\u200bmma', 'k7qd Comma', 'K7QD']
    for (const text of unsent) await submit($, text, 'composer')
    expect(seen.runs).toHaveLength(0)
    expect(seen.toasts).toHaveLength(0)
    expect(seen.prompts.map((p: any) => p.text)).toEqual(unsent)
    clear()
    line = '{"ok":false}\n'
    await submit($, `K7QD ${'x'.repeat(80)}`, 'composer')
    expect(seen.runs).toHaveLength(1)

    // Other origins and hidden messages never reach the bridge.
    clear()
    await submit($, 'K7QD Comma', 'sdk')
    await submit($, 'K7QD Comma', 'composer', { isMeta: true })
    expect(seen.runs).toHaveLength(0)
  }
})

test('a phone message that is just stop sends stop; a typed one does not', async ($, on) => {
  const { seen, clear, start } = world(on, () => ({ stdout: '{"ok":true,"says":"STOP is on."}\n' }))
  for (const surface of SURFACES) {
    await startOn($, surface, { clear, start })
    for (const text of ['stop', 'STOP', ' Stop. ', 'stop!!']) {
      clear()
      await submit($, text, 'bridge')
      expect(seen.runs).toHaveLength(1)
      expect(bridgeCall(seen.runs[0])).toEqual({ cmd: 'stop', origin: 'bridge', cwd: ROOT })
      expect(seen.prompts).toHaveLength(1)
      expect(seen.prompts[0].text).toBe(text)
    }

    clear()
    await submit($, 'stop', 'composer')
    await submit($, 'stop the build', 'bridge')
    expect(seen.runs).toHaveLength(0)
    expect(seen.prompts.map((p: any) => p.text)).toEqual(['stop', 'stop the build'])
  }
})

test('a message from sdk, peer or task-notification sends nothing', async ($, on) => {
  const { seen, clear, start } = world(on)
  for (const surface of SURFACES) {
    await startOn($, surface, { clear, start })
    for (const kind of ['sdk', 'peer', 'task-notification']) {
      await submit($, 'K7QD Approve', kind)
      await submit($, 'stop', kind)
    }
    // The director's origins, but hidden or a command: nothing either.
    await submit($, 'K7QD Approve', 'composer', { isMeta: true })
    await submit($, 'stop', 'bridge', { isMeta: true })
    await submit($, '/go', 'composer', { command: { name: 'go', args: '' } })
    expect(seen.runs).toHaveLength(0)
    expect(seen.toasts).toHaveLength(0)
    expect(seen.prompts).toHaveLength(9)
  }
})

test('/go answers with the bridge\'s words', async ($, on) => {
  let goLine = '{"ok":true,"says":"STOP is off. No build work is in progress."}\n'
  const { seen, clear, start } = world(on, (request) => request.cmd === 'go' ? { stdout: goLine } : { stdout: '{"ok":true}\n' })
  for (const surface of SURFACES) {
    clear()
    await start($, surface)
    expect(seen.registered).toEqual([{ name: 'go', description: 'Lift STOP' }])

    for (const kind of ['composer', 'bridge']) {
      clear()
      const result = await $.command.run({ command: 'go', args: '', origin: { kind }, presentation: PRESENTATION })
      expect(seen.runs).toHaveLength(1)
      expect(bridgeCall(seen.runs[0])).toEqual({ cmd: 'go', origin: kind, cwd: ROOT })
      expect(result).toMatchObject({ text: 'STOP is off. No build work is in progress.' })
      expect(seen.toasts).toHaveLength(0)
      expect(seen.commands).toHaveLength(0)
    }

    // A refusal is the bridge's own words, shown as the answer and nothing else.
    goLine = '{"ok":false,"says":"Only the director can lift STOP"}\n'
    clear()
    const refused = await $.command.run({ command: 'go', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(refused).toMatchObject({ text: 'Only the director can lift STOP' })
    expect(seen.toasts).toHaveLength(0)
    goLine = '{"ok":true,"says":"STOP is off. No build work is in progress."}\n'
  }
})

test('a measure with rateLimits sends the windows; one with only context sends nothing', async ($, on) => {
  const { seen, clear, start, hold, clock } = world(on)
  for (const surface of SURFACES) {
    // The session starts while the bridge is still taking its usage reading.
    clear()
    hold.usage = true
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await clock.settle()
    expect(seen.runs).toHaveLength(1)
    await clock.advance(60000)
    hold.usage = false

    clear()
    await start($, surface)
    const started = seen.runs.map(bridgeCall)
    expect(started).toEqual([{
      cmd: 'usage', session: SESSION, cwd: ROOT, usd: 1.25,
      windows: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-19T05:00:00.000Z' }],
    }])

    clear()
    await $.session.measure({
      context: CONTEXT,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 41, resetsAt: '2026-10-19T05:00:00.000Z' },
        { kind: 'seven_day', percentUsed: 12.5 },
      ],
      cost: { usd: 2.5 },
      changed: ['rateLimits'],
    })
    expect(seen.runs.map(bridgeCall)).toEqual([{
      cmd: 'usage', session: SESSION, cwd: ROOT, usd: 2.5,
      windows: [
        { kind: 'five_hour', percentUsed: 41, resetsAt: '2026-10-19T05:00:00.000Z' },
        { kind: 'seven_day', percentUsed: 12.5 },
      ],
    }])

    clear()
    await $.session.measure({ context: CONTEXT, rateLimits: [], cost: { usd: 3 }, changed: ['cost'] })
    expect(seen.runs.map(bridgeCall)).toEqual([{ cmd: 'usage', session: SESSION, cwd: ROOT, usd: 3 }])

    clear()
    await $.session.measure({ context: CONTEXT, rateLimits: [{ kind: 'five_hour', percentUsed: 41 }], cost: { usd: 3 }, changed: ['context'] })
    expect(seen.runs).toHaveLength(0)
    expect(seen.toasts).toHaveLength(0)
  }
})

test('a bridge failure toasts and never blocks the prompt', async ($, on) => {
  let answer: Answer = 'no-start'
  const { seen, clear, start } = world(on, () => answer)
  for (const surface of SURFACES) {
    for (const failure of ['no-start', { exitCode: 1, stdout: '' }, { stdout: 'not json\n' }, { stdout: '{"says":"no ok"}\n' }] as Answer[]) {
      answer = failure
      await startOn($, surface, { clear, start })

      const reply = await submit($, 'K7QD Approve', 'composer')
      expect(seen.toasts).toEqual([FAILED])
      expect(seen.prompts.map((p: any) => p.text)).toEqual(['K7QD Approve'])
      expect(reply).toMatchObject({ text: 'K7QD Approve' })

      clear()
      await submit($, 'stop', 'bridge')
      expect(seen.toasts).toEqual([FAILED])
      expect(seen.prompts.map((p: any) => p.text)).toEqual(['stop'])

      clear()
      const go = await $.command.run({ command: 'go', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
      expect(go).toMatchObject({ text: FAILED })
      expect(seen.toasts).toEqual([FAILED])

      // A usage reading that can't be kept says nothing: it is tried again at the next measure.
      clear()
      await $.session.measure({ context: CONTEXT, rateLimits: [{ kind: 'five_hour', percentUsed: 50 }], changed: ['rateLimits'] })
      expect(seen.runs).toHaveLength(1)
      expect(seen.toasts).toHaveLength(0)
    }
  }
})
