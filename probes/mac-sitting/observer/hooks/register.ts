// probes/mac-sitting/observer/hooks/register.ts
// Checks 41 and 42 only, loaded beside Wheelhouse's mod for the sitting and removed after it. It notes
// each delivery from outside (session.receive) and each prompt (prompt.submit): the origin's kind,
// and the first line only for messages that are not the director's own. Then, after passing the
// message on, what the hooks beneath answered: whether the delivery was consumed or the prompt
// dropped. It changes nothing: every hook passes the message on as it came. If it sits beneath
// Wheelhouse's mod, a delivery that mod consumes never reaches it, which the log then shows as no
// line at all.
//
// The log is appended to, never rewritten: the engine's $.fs has no append, so each note is its
// own file in observer.d/ in the scratch folder, named by its time, a counter and a random tail,
// and check.mjs `observer` reads them in name order as one log. Two hooks noting at once write
// two files, so neither loses its line (the first sitting's read-then-write lost one at 09:36:39).
//
// Check 42's seventh question: the command /probe-fill asks Desktop to put a few words into the
// chat's message box ($.prompt.fill, which Wheelhouse's own mod never calls) and says, as the
// command's output, whether Desktop did it or refused, and notes the same.
import type { Register, EngineInterface } from 'claude-code'

const NOTES = '/private/var/folders/qz/h81_7dbx3hdcdr8y9m4y53s00000gn/T/wheelhouse-check-41/observer.d'
const OWN = ['composer', 'bridge']
let count = 0

async function note($: EngineInterface, record: object) {
  const at = new Date().toISOString()
  count += 1
  const name = `${at.replace(/[:.]/g, '-')}-${String(count).padStart(6, '0')}-${Math.random().toString(36).slice(2, 8)}.json`
  try {
    await $.fs.write(`${NOTES}/${name}`, JSON.stringify({ at, ...record }) + '\n')
  } catch {
    // A note that can't be written is lost alone; the message still passes on.
  }
}

const firstLine = (text: string) => String(text).split('\n', 1)[0].slice(0, 120)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'probe-fill', description: 'Check 42: put a few words in the message box' })
    } catch {
      // Without the command, check 42's question 7 is not asked.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'probe-fill' }, async ($) => {
    let outcome = 'filled'
    try {
      const got = await ($ as unknown as { prompt: { fill: (input: { text: string }) => Promise<{ isFilled?: boolean }> } }).prompt.fill({ text: 'Check 42: these words were put here by the probe.' })
      outcome = got?.isFilled === true ? 'filled' : 'not filled: Desktop answered isFilled false'
    } catch (error) {
      outcome = `refused: ${String((error as Error)?.message ?? error).slice(0, 120)}`
    }
    await note($, { event: 'probe-fill', outcome })
    return { text: `probe-fill: ${outcome}` }
  })

  on('session.receive', async ($, e, next) => {
    await note($, { event: 'session.receive', origin: e.origin.kind, agent: e.agentId ?? null, first: firstLine(e.text) })
    const result = await next(e)
    await note($, { event: 'session.receive answered', consumed: result.consumed ?? null })
    return result
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const own = OWN.includes(e.origin.kind)
    await note($, { event: 'prompt.submit', origin: e.origin.kind, first: own ? null : firstLine(e.text) })
    const result = await next(e)
    await note($, { event: 'prompt.submit answered', dropped: result !== undefined && result !== null && 'drop' in result ? (result as { drop: string }).drop : null })
    return result
  }).catch(($, e, next) => next(e))
}
