// hooks/mod/settings.tsx
// The pane's settings view, reached by Settings on the board view and left by Board. The rows are
// the bridge's (scripts/mod/settings-pane.js): each row's label, its current choice and where it
// comes from, and a button per choice, the chosen one primary. A press sends the setting's key and
// the choice's id under the origin `pane`, and the bridge both sets it and signs the director's
// confirmation. A row the pane can't change offers only Ask the front desk, which hands the front
// desk a prompt naming the row and asks the bridge nothing.
import type { EngineInterface, PluginState, RenderInput } from 'claude-code'
import { ask } from './ask'
import { PANE_LEAD, RECORDING } from './numbers'
import { carry, claim, release, submitAll, type After } from './cards'

type Pressing = PluginState['wheelhouse']['pressing']
type Settings = PluginState['wheelhouse']['settings']
type Row = NonNullable<Settings>['rows'][number]
type Choice = NonNullable<Row['choices']>[number]

const VIEW = { plugin: 'wheelhouse', key: 'view' } as const
const SETTINGS = { plugin: 'wheelhouse', key: 'settings' } as const
const ASKED = { plugin: 'wheelhouse', key: 'asked' } as const

const READING = 'Reading the settings…'
const NOT_READ = 'Wheelhouse couldn\'t read the settings'
const ASK = 'Ask the front desk'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// Reads the rows again. A read that fails keeps the rows last read, under a line saying so.
export async function readSettings($: EngineInterface) {
  const before = (await $.state.get(SETTINGS)).value ?? null
  let answer = null
  try {
    answer = await ask($, { cmd: 'settings', cwd: await $.session.root() })
  } catch {
    answer = null
  }
  if (answer?.ok === true && answer.rows !== undefined) {
    await $.state.set(SETTINGS, { rows: answer.rows as Row[], text: answer.text ?? null, failed: false })
  } else {
    await $.state.set(SETTINGS, { rows: before?.rows ?? [], text: before?.text ?? null, failed: true })
  }
}

// Settings on the board view: the view changes at once and the rows are read. Each row's Ask the
// front desk is live again.
export async function showSettings($: EngineInterface) {
  await $.state.set(SETTINGS, null)
  await $.state.set(ASKED, [])
  await $.state.set(VIEW, 'settings')
  await readSettings($)
}

export async function showBoard($: EngineInterface) {
  await $.state.set(VIEW, 'board')
}

// A choice in a row.
async function pressChoice($: EngineInterface, key: string, rowLabel: string, choice: Choice) {
  const id = choice.id as string
  if (!(await claim($, { on: `setting:${key}`, label: id }))) return
  const taken = `Recording ${typeof choice.label === 'string' ? choice.label : id} for ${rowLabel}`
  await carry($, { cmd: 'setting', origin: 'pane', key, choice: id }, taken, () => release($), () => readSettings($))
}

// A session's start, a reload's included: every row's Ask the front desk is live again.
export async function forgetAsks($: EngineInterface) {
  await $.state.set(ASKED, [])
}

// Marks a row asked, or unmarks it. Written at the version read, again on a miss, so a row
// another press marked meanwhile is kept. True when the write landed.
async function markAsked($: EngineInterface, key: string, on: boolean): Promise<boolean> {
  for (let tries = 0; tries < 3; tries += 1) {
    const held = await $.state.get(ASKED)
    const asked = held.value ?? []
    if (on && asked.includes(key)) return false
    const next = on ? [...asked, key] : asked.filter((k) => k !== key)
    if ((await $.state.set(ASKED, next, { ifVersion: held.version })).isSet) return true
  }
  return false
}

// Ask the front desk: a prompt naming the row, in the pane's own words. It goes to the front
// desk, not the bridge, so it carries no origin of its own. The row is marked asked once the
// press is taken, and the mark stays until the settings view is opened again (or the session
// starts again), so its Ask is plain text till then and a double click, however far apart, asks
// once. The press itself is released once the prompt is handed over, not once its turn starts,
// so the other buttons stay live while a turn runs. A prompt that can't be handed unmarks the
// row, so it can be asked again.
async function askFrontDesk($: EngineInterface, key: string, rowLabel: string) {
  if (!(await claim($, { on: `setting:${key}`, label: 'ask' }))) return
  let marked = false
  try {
    marked = await markAsked($, key, true)
  } catch {
    marked = false
  }
  const handed = marked ? submitAll($, [`${PANE_LEAD} the director wants to change ${rowLabel}.`]) : Promise.resolve(true)
  try {
    await release($)
  } catch {
    // The next session start releases it.
  }
  if (!(await handed)) {
    try {
      await markAsked($, key, false)
    } catch {
      // Opening the settings view again unmarks it.
    }
  }
}

// The settings view: the rows, the bridge's line under them, then Board. `live` is false while
// pane.tsx's HIDE_WHILE_BUSY holds every button back.
export async function drawSettings($: EngineInterface, e: RenderInput<'Pane'>, settings: Settings | undefined, pressing: Pressing, live: boolean) {
  const { Box, Text, Button } = $.ui.resolve(e)
  if (settings === null || settings === undefined) return <Text>{READING}</Text>
  const asked = (await $.state.get(ASKED)).value ?? []
  const rows = settings.rows.filter((row) => isRecord(row) && typeof row.key === 'string' && typeof row.label === 'string')

  // A choice's button, or what stands in its place while a press is recorded.
  const choiceOf = (key: string, rowLabel: string, choice: Choice) => {
    const id = choice.id as string
    const label = typeof choice.label === 'string' ? choice.label : id
    if (pressing?.on === `setting:${key}` && pressing.label === id) return <Text>{RECORDING}</Text>
    if (pressing !== null) return <Text dimColor>{label}</Text>
    return choice.chosen === true
      ? <Button key={`setting:${key}:${id}`} label={label} variant="primary" onPress={() => pressChoice($, key, rowLabel, choice)} />
      : <Button key={`setting:${key}:${id}`} label={label} onPress={() => pressChoice($, key, rowLabel, choice)} />
  }

  const askOf = (key: string, rowLabel: string) => {
    if (pressing?.on === `setting:${key}` && pressing.label === 'ask') return <Text>{RECORDING}</Text>
    if (pressing !== null || asked.includes(key)) return <Text dimColor>{ASK}</Text>
    return <Button key={`setting:${key}:ask`} label={ASK} onPress={() => askFrontDesk($, key, rowLabel)} />
  }

  return (
    <Box flexDirection="column">
      {settings.failed && <Text bold>{NOT_READ}</Text>}
      {rows.map((row) => {
        const key = row.key as string
        const label = row.label as string
        const said = [typeof row.current === 'string' ? `${label}: ${row.current}` : label, typeof row.from === 'string' ? ` (${row.from})` : ''].join('')
        const choices = (Array.isArray(row.choices) ? row.choices : []).filter((c) => isRecord(c) && typeof c.id === 'string' && c.id !== '')
        return (
          <Box flexDirection="column">
            <Text>{said}</Text>
            {row.here === false && typeof row.why === 'string' && <Text dimColor>{row.why}</Text>}
            {live && row.here !== false && choices.length > 0 && (
              <Box flexDirection="row" flexWrap="wrap">{choices.map((choice) => choiceOf(key, label, choice))}</Box>
            )}
            {live && row.here === false && askOf(key, label)}
          </Box>
        )
      })}
      {typeof settings.text === 'string' && <Text dimColor>{settings.text}</Text>}
      {live && <Button key="board" label="Board" onPress={() => showBoard($)} />}
    </Box>
  )
}
