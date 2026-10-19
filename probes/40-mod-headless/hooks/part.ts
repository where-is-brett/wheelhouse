// probes/40-mod-headless/hooks/part.ts
// Throwaway probe mod for check 40, the part register.ts imports: one prompt.submit hook that
// logs every prompt it sees, with its origin, to probe-40-part.jsonl in the session's working
// folder, and answers { drop: 'probe' } for a text that begins "probe-drop:".
import type { Register, EngineInterface } from 'claude-code'

const LOG = 'probe-40-part.jsonl'
let queue: Promise<void> = Promise.resolve()

// One line at a time, in the order they were made.
function append($: EngineInterface, record: object): Promise<void> {
  queue = queue.then(async () => {
    let before = ''
    try { before = await $.fs.read(LOG) } catch { before = '' }
    await $.fs.write(LOG, before + JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n')
  }).catch(() => {})
  return queue
}

export const registerPart: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const drops = e.text.startsWith('probe-drop:')
    await append($, {
      event: 'prompt.submit',
      text: e.text.slice(0, 80),
      origin: e.origin,
      now: await $.clock.now(),
      isMeta: e.isMeta === true,
      turnId: e.turnId ?? null,
      wait: e.wait,
      command: e.command ?? null,
      answer: drops ? 'drop' : 'next',
    })
    if (drops) return { drop: 'probe' }
    return next(e)
  })
}
