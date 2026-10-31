// hooks/mod/settings.tsx
// The pane's settings view, reached by Settings on the board view and left by Done. The bridge
// sends the rows in groups (scripts/mod/settings-pane.js): each group is drawn as a group with its
// note under it, and each row by its kind. A `select` row is its name and a Select (on the phone, a
// Button that opens the choices on their own page); a pick sends the setting's key and the chosen
// value under the origin `pane`, and the bridge both sets it and signs the director's confirmation.
// A `change` row is its name, its value and Change…, which hands the front desk a prompt naming the
// row and asks the bridge nothing. A `value` row is its name and value. A row changed less than a
// minute ago says so and offers Undo, which sends the choice `undo`; the pane is drawn again when
// that minute is up, so Undo leaves then.
import type { EngineInterface, PluginState, RenderInput } from 'claude-code'
import { ask } from './ask'
import { body, ends, filled, footnote, group, heading, outlined, small, tableOf, title } from './calm'
import type { Table } from './calm'
import { PANE_LEAD, RECORDING, UNDO_MS } from './numbers'
import { carry, claim, release, submitAll, type After } from './cards'

type Pressing = PluginState['wheelhouse']['pressing']
type Settings = PluginState['wheelhouse']['settings']
type Group = NonNullable<Settings>['groups'][number]
type Row = NonNullable<Group['rows']>[number]
type Option = NonNullable<Row['options']>[number]

const VIEW = { plugin: 'wheelhouse', key: 'view' } as const
const SETTINGS = { plugin: 'wheelhouse', key: 'settings' } as const
const ASKED = { plugin: 'wheelhouse', key: 'asked' } as const
const CHOOSING = { plugin: 'wheelhouse', key: 'choosing' } as const

const READING = 'Reading the settings…'
const NOT_READ = 'Wheelhouse couldn\'t read the settings'
const CHANGE = 'Change…'
const UNDO = 'undo'
const JUST_NOW = 'Changed just now'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// Reads the settings again. A read that fails keeps the groups last read, under a line saying so.
export async function readSettings($: EngineInterface) {
  const before = (await $.state.get(SETTINGS)).value ?? null
  let answer = null
  try {
    answer = await ask($, { cmd: 'settings', cwd: await $.session.root() })
  } catch {
    answer = null
  }
  if (answer?.ok === true && answer.groups !== undefined) {
    await $.state.set(SETTINGS, { rows: (answer.rows ?? []) as NonNullable<Settings>['rows'], groups: answer.groups as Group[], text: answer.text ?? null, failed: false })
  } else {
    await $.state.set(SETTINGS, { rows: before?.rows ?? [], groups: before?.groups ?? [], text: before?.text ?? null, failed: true })
  }
}

// Settings on the board view: the view changes at once and the settings are read. Each row's
// Change… is live again.
export async function showSettings($: EngineInterface) {
  await $.state.set(SETTINGS, null)
  await $.state.set(ASKED, [])
  await $.state.set(CHOOSING, null)
  await $.state.set(VIEW, 'settings')
  await readSettings($)
}

export async function showBoard($: EngineInterface) {
  await $.state.set(CHOOSING, null)
  await $.state.set(VIEW, 'board')
}

// On the phone, a row's choices open on their own page (the row's key), or the list again (null).
async function choose($: EngineInterface, key: string | null) {
  await $.state.set(CHOOSING, key)
}

// A pick in a row: a Select's, a choice on the phone's page, or Undo (`undo`). One press is
// recorded at a time, as a button's is; a pick the bridge refuses (STOP is on) says so, and the
// read after it draws the row back at the value in force. A pick of the value already in force
// (`held`) sends nothing; Undo is not a pick of a value.
async function pressChoice($: EngineInterface, key: string, choice: string, held: string | null | undefined) {
  if (choice === held) {
    await choose($, null)
    return
  }
  if (!(await claim($, { on: `setting:${key}`, label: choice }))) return
  await choose($, null)
  await carry($, { cmd: 'setting', origin: 'pane', key, choice }, RECORDING, () => release($), () => readSettings($))
}

// A session's start, a reload's included: every row's Change… is live again and no page of choices
// is open.
export async function forgetAsks($: EngineInterface) {
  await $.state.set(ASKED, [])
  await $.state.set(CHOOSING, null)
}

// Marks a row asked, or unmarks it. Written at the version read, again on a miss, so a row
// another press marked meanwhile is kept. True when the write landed.
async function mark($: EngineInterface, key: string, on: boolean): Promise<boolean> {
  for (let tries = 0; tries < 3; tries += 1) {
    const held = await $.state.get(ASKED)
    const asked = held.value ?? []
    if (on && asked.includes(key)) return false
    const next = on ? [...asked, key] : asked.filter((k) => k !== key)
    if ((await $.state.set(ASKED, next, { ifVersion: held.version })).isSet) return true
  }
  return false
}

// Change…: a prompt naming the row, in the pane's own words. It goes to the front desk, not the
// bridge, so it carries no origin of its own. The row is marked asked once the press is taken,
// and the mark stays until the settings view is opened again (or the session starts again), so
// its Change… is plain text till then and a double click, however far apart, asks once. The press
// itself is released once the prompt is handed over, not once its turn starts, so the other
// buttons stay live while a turn runs. A prompt that can't be handed unmarks the row, so it can be
// asked again.
async function askFrontDesk($: EngineInterface, key: string, rowLabel: string) {
  if (!(await claim($, { on: `setting:${key}`, label: 'ask' }))) return
  let marked = false
  try {
    marked = await mark($, key, true)
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
      await mark($, key, false)
    } catch {
      // Opening the settings view again unmarks it.
    }
  }
}

// What a row is, as the bridge sent it: a key and a name, else it isn't drawn.
const drawable = (row: unknown): row is Row => isRecord(row) && typeof row.key === 'string' && typeof row.label === 'string'
const optionsOf = (row: Row): { value: string, label: string }[] =>
  (Array.isArray(row.options) ? row.options : [])
    .filter((o): o is Option => isRecord(o) && typeof o.value === 'string' && o.value !== '')
    .map((o) => ({ value: o.value as string, label: typeof o.label === 'string' ? o.label : (o.value as string) }))

// The value in force, in words: the chosen option's label, else the words the bridge gave
// (a temporary setting matching no option), else the value.
function shownOf(row: Row): string {
  const chosen = optionsOf(row).find((o) => o.value === row.value)
  if (chosen !== undefined) return chosen.label
  if (typeof row.current === 'string') return row.current
  return typeof row.value === 'string' ? row.value : ''
}

// When a row's latest change stops being undoable: NaN for a change that can be undone with no
// time known, null for a row with nothing to undo.
function undoEnds(row: Row): number | null {
  if (!isRecord(row.changed) || row.changed.undo !== true) return null
  const at = typeof row.changed.at === 'number' ? row.changed.at : typeof row.changed.at === 'string' ? Date.parse(row.changed.at) : NaN
  return at + UNDO_MS
}

// Whether a row's latest change is under a minute old and can still be undone.
function justChanged(row: Row, now: number): boolean {
  const until = undoEnds(row)
  return until !== null && (!Number.isFinite(until) || now < until)
}

// The times a redraw is asked for, so an Undo leaves when its minute is up although nothing else
// redraws the pane. A reload starts the module over, and its first draw asks again.
const redraws = new Set<number>()
function redrawAt($: EngineInterface, due: number, now: number) {
  if (redraws.has(due)) return
  redraws.add(due)
  $.clock.after(Math.max(1, due - now), () => {
    redraws.delete(due)
    $.ui.invalidate('ui.render')
  })
}

// The settings view: Settings with Done, each group with its note, then (on the phone) a row's
// choices on their own page. `live` is false while pane.tsx's HIDE_WHILE_BUSY holds every button
// back; `now` is the time the pane is drawn at.
export async function drawSettings($: EngineInterface, e: RenderInput<'Pane'>, settings: Settings | undefined, pressing: Pressing, live: boolean, now: number) {
  const t: Table = tableOf($, e)
  if (settings === null || settings === undefined) return body(t, READING)
  const phone = e.surface === 'mobile'
  const [asked, choosing] = await Promise.all([$.state.get(ASKED), $.state.get(CHOOSING)])
  const groups = (Array.isArray(settings.groups) ? settings.groups : []).filter(isRecord)
  const rowsOf = (g: Group) => (Array.isArray(g.rows) ? g.rows : []).filter(drawable)

  // A row that is being recorded, and whether it is an Undo.
  const recording = (key: string) => pressing?.on === `setting:${key}` && pressing.label !== 'ask'
  const undoing = (key: string) => pressing?.on === `setting:${key}` && pressing.label === UNDO

  // A row's choices on their own page (the phone's, and a row with no value in force anywhere), each a Button with a tick after the one in force.
  if (live && typeof choosing.value === 'string') {
    const open = groups.flatMap(rowsOf).find((row) => row.key === choosing.value)
    if (open !== undefined) {
      const key = open.key as string
      const name = open.label as string
      return (
        <t.Box flexDirection="column" gap="sm">
          {small(t, 'settings-back', '‹ Settings', () => choose($, null))}
          {heading(t, name)}
          {optionsOf(open).map((option) => {
            const label = option.value === open.value ? `${option.label} ✓` : option.label
            return pressing === null
              ? outlined(t, `setting:${key}:${option.value}`, label, () => pressChoice($, key, option.value, open.value))
              : footnote(t, label)
          })}
        </t.Box>
      )
    }
  }

  // A row's value where it can't be changed just now: plain dim words, or Recording… for the row
  // being recorded.
  const valueOf = (row: Row) => (recording(row.key as string) && !undoing(row.key as string) ? body(t, RECORDING) : footnote(t, shownOf(row)))

  const selectOf = (row: Row) => {
    const key = row.key as string
    const name = row.label as string
    const options = optionsOf(row)
    if (!live || pressing !== null || options.length === 0) return valueOf(row)
    if (phone) return outlined(t, `setting:${key}`, `${name}  ${shownOf(row)} ›`, () => choose($, key))
    // No value in force (a temporary setting matching no option): its words, and Change… opens the choices. No Select, which might pick one of itself.
    if (typeof row.value !== 'string') {
      return (
        <t.Box flexDirection="row" gap="sm">
          {footnote(t, shownOf(row))}
          {small(t, `setting:${key}:change`, CHANGE, () => choose($, key))}
        </t.Box>
      )
    }
    return (
      <t.Select
        key={`setting:${key}`}
        options={options}
        value={typeof row.value === 'string' ? row.value : undefined}
        onSelect={(v: string) => pressChoice($, key, v, row.value)}
      />
    )
  }

  const changeOf = (row: Row) => {
    const key = row.key as string
    const name = row.label as string
    if (pressing?.on === `setting:${key}` && pressing.label === 'ask') return body(t, RECORDING)
    if (!live || pressing !== null || asked.value?.includes(key) === true) return footnote(t, CHANGE)
    return small(t, `setting:${key}:change`, CHANGE, () => askFrontDesk($, key, name))
  }

  const undoOf = (row: Row) => {
    const key = row.key as string
    const name = row.label as string
    if (undoing(key)) return body(t, RECORDING)
    if (!live || pressing !== null) return footnote(t, 'Undo')
    return small(t, `setting:${key}:undo`, 'Undo', () => pressChoice($, key, UNDO, row.value))
  }

  const rowOf = (row: Row) => {
    const name = row.label as string
    const until = undoEnds(row)
    if (row.kind === 'select' && until !== null && Number.isFinite(until) && now < until) redrawAt($, until, now)
    const changed = row.kind === 'select' && justChanged(row, now) && (
      <t.Box flexDirection="row" justifyContent="flex-end" alignItems="center" gap="sm">
        {footnote(t, JUST_NOW)}
        {undoOf(row)}
      </t.Box>
    )
    if (row.kind === 'select') {
      // On the phone the row's Button carries the name and value; elsewhere the name stands beside the Select.
      const picker = selectOf(row)
      return (
        <t.Box flexDirection="column">
          {phone && live && pressing === null && optionsOf(row).length > 0
            ? picker
            : ends(t, body(t, name), picker)}
          {changed}
        </t.Box>
      )
    }
    if (row.kind === 'change') {
      return ends(t, body(t, name), (
        <t.Box flexDirection="row" alignItems="center" gap="sm">
          {typeof row.value === 'string' && row.value !== '' && footnote(t, row.value)}
          {changeOf(row)}
        </t.Box>
      ))
    }
    return ends(t, body(t, name), typeof row.value === 'string' && row.value !== '' && footnote(t, row.value))
  }

  return (
    <t.Box flexDirection="column" gap="lg">
      {ends(t, title(t, 'Settings'), live && filled(t, 'done', 'Done', () => showBoard($)))}
      {settings.failed && body(t, NOT_READ)}
      {groups.map((g) => {
        const rows = rowsOf(g)
        // A group of one row of the same name is named by that row.
        const named = typeof g.title === 'string' && !(rows.length === 1 && rows[0].label === g.title)
        return group(t, rows.map(rowOf), named ? (g.title as string) : undefined, typeof g.note === 'string' && g.note !== '' ? g.note : undefined)
      })}
    </t.Box>
  )
}
