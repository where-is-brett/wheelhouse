// tests/mod/close.test.ts
// The mod's one tool.call hook, run by `claude plugin test .` (npm run mod-check): a Wheelhouse card open in the chat as
// a question closes by itself once it is answered elsewhere. Everything beneath the mod is answered here: the dialog (a
// tool.call that waits for the director), the bridge's `closed` answers, and the clock. The hook may only refuse with
// its plain line; these tests check that it never returns an answer, closes nothing but a call of AskUserQuestion, and
// closes only on proof.
import { test, expect, mock } from 'claude-code/testing'

const ROOT = '/Users/someone/projects/shop'
const SESSION = '0b6a4e1c-4f3a-4d7e-9a51-2f3c8d9e1a77'
const RUN_RESULT = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const CLOSED = 'Answered in the panel; this question is closed'
const CHECK_MS = 1000
const DIALOG_MS = 600000
const CARD = 'Put pull request #42 live?\nIt changes what your users see.\nNothing goes live meanwhile.\nTo know more, just ask.\nApprove pull request #42 at commit 3f9c2a7b81d0\nReply code: K7QD'
const question = (text: string) => ({ question: text, header: 'Approve', multiSelect: false, options: [{ label: 'Approve', description: 'Recommended: Puts it live.' }, { label: 'Not now', description: 'Leaves it waiting.' }] })

type Says = { ok: boolean, cards?: number, closed?: number } | { exitCode: number }

// Registers the world beneath the mod. `dialog` is what the engine's own tool does: it waits for the director for
// DIALOG_MS and then answers. `bridge` answers each `closed` request.
function world(on: any, bridge: (request: any) => Says) {
  const clock = mock.clock(on)
  const seen = { asked: [] as any[], ran: [] as string[], toasts: [] as string[] }
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000, percent: 0.5 }, rateLimits: [], cost: undefined } }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('ui.toast', ($: any, e: any) => { seen.toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: false } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', async ($: any, e: any) => {
    const request = JSON.parse(e.init?.stdin ?? 'null')
    if (request?.cmd === 'tick') return { value: { ...RUN_RESULT, stdout: '{"ok":true,"role":"feature","every":0}\n' } }
    if (request?.cmd !== 'closed') return { value: { ...RUN_RESULT, stdout: '{"ok":true}\n' } }
    seen.asked.push(request)
    const got: any = bridge(request)
    if (got.exitCode !== undefined) return { value: { ...RUN_RESULT, exitCode: got.exitCode, stdout: '' } }
    return { value: { ...RUN_RESULT, stdout: `${JSON.stringify(got)}\n` } }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('tool.call', async ($: any, e: any) => {
    seen.ran.push(e.tool)
    if (e.tool === 'AskUserQuestion') {
      await clock.sleep(DIALOG_MS)
      return { result: { answers: { [e.questions[0].question]: 'Approve' } }, text: 'answered' }
    }
    return { result: 'ran', text: 'ran' }
  })
  return { seen, clock }
}

const open = ($: any, text: string = CARD, over: object = {}) =>
  $.tool.call({ tool: 'AskUserQuestion', questions: [question(text)], ...over })

test('a card answered elsewhere on proof closes the question with the plain line, and nothing else', async ($, on) => {
  const { seen, clock } = world(on, () => ({ ok: true, cards: 1, closed: 1 }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const call = open($)
  await clock.advance(CHECK_MS)
  const got = await call
  expect(got).toEqual({ deny: CLOSED })
  expect(Object.keys(got)).toEqual(['deny'])
  // The bridge was asked with the session's folder and the question's own text.
  expect(seen.asked[0]).toEqual({ cmd: 'closed', cwd: ROOT, questions: [CARD], pressed: [] })
})

test('a card still waiting leaves the question alone, and the director\'s answer passes through untouched', async ($, on) => {
  const { seen, clock } = world(on, () => ({ ok: true, cards: 1, closed: 0 }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const call = open($)
  await clock.advance(CHECK_MS * 12)
  expect(seen.asked.length).toBeGreaterThan(1)
  await clock.advance(DIALOG_MS)
  const got: any = await call
  expect(got.deny).toBeUndefined()
  expect(got.result).toEqual({ answers: { [CARD]: 'Approve' } })
})

test('a question that is no card is asked of the bridge once, then left alone', async ($, on) => {
  const { seen, clock } = world(on, () => ({ ok: true, cards: 0, closed: 0 }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const call = open($, 'Which folder should the report go in?')
  await clock.advance(CHECK_MS * 30)
  expect(seen.asked.length).toBe(1)
  await clock.advance(DIALOG_MS)
  expect((await call as any).deny).toBeUndefined()
})

test('a call with one card closed and one not is left open: it closes only when every question is closed', async ($, on) => {
  const { clock } = world(on, () => ({ ok: true, cards: 2, closed: 1 }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const call = $.tool.call({ tool: 'AskUserQuestion', questions: [question(CARD), question(`${CARD} again`)] })
  await clock.advance(CHECK_MS * 6)
  await clock.advance(DIALOG_MS)
  expect((await call as any).deny).toBeUndefined()
})

for (const says of [{ exitCode: 1 }, { ok: false }, { ok: true }, { ok: true, cards: 'one', closed: 1 }] as Says[]) {
  test(`a bridge that fails or answers nonsense closes nothing: ${JSON.stringify(says)}`, async ($, on) => {
    const { clock } = world(on, () => says)
    await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
    const call = open($)
    await clock.advance(CHECK_MS * 6)
    await clock.advance(DIALOG_MS)
    expect((await call as any).deny).toBeUndefined()
  })
}

test('no other tool is touched: the hook runs for AskUserQuestion alone', async ($, on) => {
  const { seen } = world(on, () => ({ ok: true, cards: 1, closed: 1 }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const got = await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List' })
  expect(got).toMatchObject({ result: 'ran' })
  expect(seen.ran).toEqual(['Bash'])
  expect(seen.asked).toEqual([])
})
