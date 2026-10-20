// hooks/mod/cards.tsx
// The board view's buttons: each card's, and STOP or Lift STOP on the pane's top line. The mod
// decides nothing here: a card gets exactly the buttons the bridge gave it (scripts/mod/buttons.js),
// a press sends the card, its hash and the label pressed, and what the bridge says is shown.
//
// A press says at once that it was taken (a toast, and "Recording…" in place of the button), so
// buttons stay live during a turn. One press is recorded at a time: while one is, every other
// button but STOP is drawn as plain text, so a double press sends once. STOP is never held back.
// The origin `pane` is written only inside the press… functions below and in settings.tsx, each
// passed as a Button's onPress; scripts/mod/validate.js checks it.
import type { EngineInterface, PluginState, RenderInput } from 'claude-code'
import { ask, FAILED, type Answer, type PaneModel } from './ask'

// A card of the pane's model. It comes from another process, so each field is read as anything.
type Card = Record<string, unknown>
type Pressing = PluginState['wheelhouse']['pressing']
// What runs once the bridge has answered a press: a tick, or a fresh read of the settings.
export type After = () => Promise<unknown>

const PRESSING = { plugin: 'wheelhouse', key: 'pressing' } as const
const STOPPING = { plugin: 'wheelhouse', key: 'stopping' } as const

export const RECORDING = 'Recording…'
// Drawn in place of every button while a turn runs, when pane.tsx's HIDE_WHILE_BUSY is on.
export const WAIT = 'Wait for Claude to finish, or type stop'
// A toast for a prompt that couldn't be handed on: to the front desk, or a Shape 2 foreman's
// watcher lines to the foreman.
export const NOT_HANDED = 'Wheelhouse couldn\'t hand that to the front desk'
export const NOT_HANDED_FOREMAN = 'Wheelhouse couldn\'t hand the watcher\'s news to the foreman'
const LIFT = 'lift-stop'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// The press being recorded, as the drawing read it.
export async function pressingNow($: EngineInterface): Promise<Pressing> {
  return (await $.state.get(PRESSING)).value ?? null
}

// Takes the one press at a time: true when this press is now the one being recorded. Two presses
// at once both read the same version, and only the first write at it lands.
export async function claim($: EngineInterface, pressing: NonNullable<Pressing>): Promise<boolean> {
  const held = await $.state.get(PRESSING)
  if (held.value !== undefined && held.value !== null) return false
  return (await $.state.set(PRESSING, pressing, { ifVersion: held.version })).isSet
}

export async function release($: EngineInterface) {
  await $.state.set(PRESSING, null)
}

// A session's start, a reload's included: a press the last copy of the module was recording
// can't finish, so none is left holding the buttons.
export async function releaseAll($: EngineInterface) {
  await $.state.set(PRESSING, null)
  await $.state.set(STOPPING, false)
}

// Hands the session each prompt, in order, once. Each prompt stands alone: one the engine drops,
// or a call that rejects, isn't handed, and the ones after it still are. However many aren't, the
// toast `notHanded` says so once, unless `quiet`. True when every prompt was handed over.
export async function submitAll($: EngineInterface, prompts: readonly string[], notHanded: string = NOT_HANDED, quiet = false): Promise<boolean> {
  let handed = true
  for (const text of prompts) {
    try {
      if ((await $.prompt.submit({ text })).drop !== undefined) handed = false
    } catch {
      handed = false
    }
  }
  if (!handed && !quiet) $.ui.toast(notHanded)
  return handed
}

// A press once taken: said at once, sent with the session's folder, the bridge's words said (or
// that it couldn't be recorded), the press released so the buttons are live again, `after`
// started, and each prompt the bridge gave handed to the front desk. Never throws.
export async function carry($: EngineInterface, request: Record<string, unknown>, taken: string, done: () => Promise<unknown>, after: After) {
  let answer: Answer | null = null
  try {
    $.ui.toast(taken)
    answer = await ask($, { ...request, cwd: await $.session.root() })
  } catch {
    answer = null
  }
  try {
    await done()
  } catch {
    // The next session start releases it.
  }
  if (answer?.says !== undefined) $.ui.toast(answer.says)
  else if (answer === null || !answer.ok) $.ui.toast(FAILED)
  void after().catch(() => undefined)
  await submitAll($, answer?.submit ?? [])
}

// A press on one of a card's buttons.
async function pressButton($: EngineInterface, card: Card, label: string, after: After) {
  const id = card.id as string
  if (!(await claim($, { on: id, label }))) return
  await carry($, { cmd: 'press', origin: 'pane', card: id, hash: card.hash, label }, `Recording ${label}${typeof card.n === 'number' ? ` on card ${card.n}` : ''}`, () => release($), after)
}

// STOP: never held back by another press, only by its own.
async function pressStop($: EngineInterface, after: After) {
  const held = await $.state.get(STOPPING)
  if (held.value === true) return
  if (!(await $.state.set(STOPPING, true, { ifVersion: held.version })).isSet) return
  await carry($, { cmd: 'stop', origin: 'pane' }, 'Recording STOP', () => $.state.set(STOPPING, false), after)
}

// Lift STOP, carrying the start of the STOP the pane drew: the bridge lifts only that one.
async function pressLift($: EngineInterface, since: unknown, after: After) {
  if (!(await claim($, { on: LIFT, label: 'Lift STOP' }))) return
  await carry($, { cmd: 'go', origin: 'pane', since: typeof since === 'string' ? since : null }, 'Recording Lift STOP', () => release($), after)
}

// The labels of the buttons the bridge gave a card, in its order, each once.
function labelsOf(card: Card): string[] {
  const given = Array.isArray(card.buttons) ? card.buttons : []
  return [...new Set(given.map((b) => (isRecord(b) && typeof b.label === 'string' ? b.label : '')).filter((label) => label !== ''))]
}

// The pane's top line: STOP while STOP is off, Lift STOP while it is on. `live` is false while
// HIDE_WHILE_BUSY holds every button back.
export async function drawStop($: EngineInterface, e: RenderInput<'Pane'>, model: PaneModel, pressing: Pressing, live: boolean, after: After) {
  const { Text, Button } = $.ui.resolve(e)
  if (!live) return <Text dimColor>{WAIT}</Text>
  const stop = isRecord(model.stop) ? model.stop : {}
  if (stop.on === true) {
    if (pressing?.on === LIFT) return <Text>{RECORDING}</Text>
    if (pressing !== null) return <Text dimColor>Lift STOP</Text>
    const since = stop.since
    return <Button key={LIFT} label="Lift STOP" onPress={() => pressLift($, since, after)} />
  }
  if ((await $.state.get(STOPPING)).value === true) return <Text>{RECORDING}</Text>
  return <Button key="stop" label="STOP" onPress={() => pressStop($, after)} />
}

// A card: its text, drawn whole as plain text, its note under it, and one button per entry of
// its buttons, keyed by the card's id and the label.
export function drawCard($: EngineInterface, e: RenderInput<'Pane'>, card: Card, pressing: Pressing, live: boolean, after: After) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const id = typeof card.id === 'string' ? card.id : null
  const labels = id === null || !live ? [] : labelsOf(card)
  return (
    <Box flexDirection="column">
      <Text>{card.text as string}</Text>
      {typeof card.note === 'string' && <Text dimColor>{card.note}</Text>}
      {labels.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap">
          {labels.map((label) => {
            if (pressing?.on === id && pressing.label === label) return <Text>{RECORDING}</Text>
            if (pressing !== null) return <Text dimColor>{label}</Text>
            return <Button key={`card:${id}:${label}`} label={label} onPress={() => pressButton($, card, label, after)} />
          })}
        </Box>
      )}
    </Box>
  )
}
