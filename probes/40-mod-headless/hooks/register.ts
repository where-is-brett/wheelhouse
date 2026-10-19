// probes/40-mod-headless/hooks/register.ts
// Throwaway probe mod for check 40: what a mod can do with no screen. It registers a command
// `digest` answering { text: 'probe digest' }; at the session's start it starts
// $.clock.every(5000, ...), logging each fire and, on the third, submitting
// 'probe: timer prompt'; and it imports part.ts, which holds the prompt.submit hook. Two
// ui.render hooks that only pass on are here so the validator shows how it spells their
// matchers. Everything is logged to probe-40-mod.jsonl in the session's working folder.
import type { Register, EngineInterface } from 'claude-code'
import { registerPart } from './part'

const LOG = 'probe-40-mod.jsonl'
let queue: Promise<void> = Promise.resolve()

function append($: EngineInterface, record: object): Promise<void> {
  queue = queue.then(async () => {
    let before = ''
    try { before = await $.fs.read(LOG) } catch { before = '' }
    await $.fs.write(LOG, before + JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n')
  }).catch(() => {})
  return queue
}

export const register: Register = on => {
  registerPart(on)

  on('session.start', async ($, e, next) => {
    await append($, { event: 'session.start' })
    await $.command.register({ name: 'digest', description: 'Probe 40: answers a line of text.' })
    let fires = 0
    $.clock.every(5000, async () => {
      fires += 1
      await append($, { event: 'clock.every', fire: fires })
      if (fires === 3) {
        await append($, { event: 'prompt.submit called' })
        const result = await $.prompt.submit({ text: 'probe: timer prompt' })
        await append($, { event: 'prompt.submit resolved', result: 'drop' in result && result.drop ? { drop: result.drop } : { text: result.text } })
      }
    })
    return next(e)
  })

  on('command.run', { command: 'digest' }, async $ => {
    await append($, { event: 'command.run', command: 'digest' })
    return { text: 'probe digest' }
  })

  on('ui.render', { component: 'Pane', requestId: 'probe40' }, async ($, e, next) => next(e))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => next(e))
}
