// hooks/mod/settings.tsx
// The pane's settings view, reached by Settings on the board view and left by Board. The rows are
// the bridge's (scripts/mod/settings-pane.js): each row's label, its current choice and where it
// comes from, and a button per choice, the chosen one primary. A press sends the setting's key and
// the choice's id under the origin `pane`, and the bridge both sets it and signs the director's
// confirmation. A row the pane can't change offers only Ask the front desk, which hands the front
// desk a prompt naming the row and asks the bridge nothing.
import type { EngineInterface, PluginState, RenderInput } from 'claude-code'
import { ask } from './ask'
import { PANE_LEAD } from './numbers'
import { carry, claim, release, submitAll, RECORDING, type After } from './cards'

type Pressing = PluginState['wheelhouse']['pressing']
type Settings = PluginState['wheelhouse']['settings']
type Row = NonNullable<Settings>['rows'][number]
type Choice = NonNullable<Row['choices']>[number]

const VIEW = { plugin: 'wheelhouse', key: 'view' } as const
const SETTINGS = { plugin: 'wheelhouse', key: 'settings' } as const

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

// Settings on the board view: the view changes at once and the rows are read.
export async function showSettings($: EngineInterface) {
  await $.state.set(SETTINGS, null)
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

// Ask the front desk: a prompt naming the row, in the pane's own words. It goes to the front
// desk, not the bridge, so it carries no origin of its own. The press is released once the prompt
// is handed over, not once its turn starts, so the buttons stay live while a turn runs.
async function askFrontDesk($: EngineInterface, key: string, rowLabel: string) {
  if (!(await claim($, { on: `setting:${key}`, label: 'ask' }))) return
  const handed = submitAll($, [`${PANE_LEAD} the director wants to change ${rowLabel}.`])
  try {
    await release($)
  } catch {
    // The next session start releases it.
  }
  await handed
}

// The settings view: the rows, the bridge's line under them, then Board. `live` is false while
// pane.tsx's HIDE_WHILE_BUSY holds every button back.
export function drawSettings($: EngineInterface, e: RenderInput<'Pane'>, settings: Settings | undefined, pressing: Pressing, live: boolean) {
  const { Box, Text, Button } = $.ui.resolve(e)
  if (settings === null || settings === undefined) return <Text>{READING}</Text>
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
    if (pressing !== null) return <Text dimColor>{ASK}</Text>
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
