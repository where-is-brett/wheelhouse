// probes/32-mod-sandbox/hooks/register.ts
// Throwaway probe mod for check 32. At the session's start it runs child.js with
// $.process.run, then tries $.fs.write and $.fs.read in the folder the scratch
// project's sandbox denies, and logs what happened to a file in the session's
// working directory (the scratch project, which every process may write).
import type { Register } from 'claude-code'

const LOG = 'probe-32-mod.jsonl'
const KEY_TEXT = 'probe-key-32'

async function append($: any, record: object) {
  let before = ''
  try { before = await $.fs.read(LOG) } catch { before = '' }
  await $.fs.write(LOG, before + JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const denied = await $.env.get('PROBE32_DENIED')
    const record: Record<string, unknown> = {
      event: 'session.start',
      root: $.plugin.root,
      denied,
      path: await $.env.get('PATH'),
    }
    try {
      const run = await $.process.run(['node', `${$.plugin.root}/child.js`, 'mod', String(denied)], { timeoutMs: 20000 })
      record.run = { exitCode: run.exitCode, stdout: run.stdout.slice(0, 2000), stderr: run.stderr.slice(0, 2000) }
    } catch (err) {
      record.run = { error: String(err) }
    }
    try {
      await $.fs.write(`${denied}/written-by-mod-fs.txt`, 'probe\n')
      record.fsWrite = 'ok'
    } catch (err) {
      record.fsWrite = String(err)
    }
    try {
      const text = await $.fs.read(`${denied}/key.txt`)
      record.fsRead = text.trim() === KEY_TEXT ? 'ok' : 'other text'
    } catch (err) {
      record.fsRead = String(err)
    }
    await append($, record)
    return next(e)
  })
}
