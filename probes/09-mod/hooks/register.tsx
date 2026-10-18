// probes/09-mod/hooks/register.tsx
// Throwaway probe mod for checks 6, 8 and 9. Logs the usage figures, where each message came from, and every delivery
// from another session; adds a pane with a test button.
import type { Register } from 'claude-code'

const PANE = 'wheelhouse-probe'

async function append($: any, record: object) {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const path = `${home}/.wheelhouse-probes/09-mod/log.jsonl`
  let before = ''
  try { before = await $.fs.read(path) } catch { before = '' }
  await $.fs.write(path, before + JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    await append($, { event: 'session.start', rateLimits: usage.rateLimits, surface: (e as any).surface })
    void $.ui.open({ id: PANE, title: 'Wheelhouse probe' })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await append($, { event: 'session.measure', changed: (e as any).changed, rateLimits: (e as any).rateLimits })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await append($, { event: 'prompt.submit', origin: (e as any).origin, text: String(e.text).slice(0, 80) })
    return next(e)
  })

  on('session.receive', async ($, e, next) => {
    await append($, { event: 'session.receive', origin: e.origin, text: String(e.text).slice(0, 80) })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const press = async () => {
      void $.ui.toast('probe: button pressed')
      try {
        await append($, { event: 'button', clicked: true })
        await $.prompt.submit({ text: 'probe: mod button' })
      } catch (err) {
        void $.ui.toast('probe: ' + String(err))
        await append($, { event: 'button-error', error: String(err) })
      }
    }
    return (
      <Box flexDirection="column">
        <Text>Wheelhouse probe mod</Text>
        <Button key="probe-button" onPress={press}>Press for the trial</Button>
      </Box>
    )
  })
}
