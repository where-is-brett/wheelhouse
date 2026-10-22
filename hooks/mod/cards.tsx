// hooks/mod/cards.tsx
// The board view's buttons: each card's, and STOP or Lift STOP on the pane's top line. The mod
// decides nothing here: a card gets exactly the buttons the bridge gave it (scripts/mod/buttons.js),
// a press sends the card, its hash and the label pressed, and what the bridge says is shown.
//
// A press says at once that it was taken (a toast, and "Recording…" in place of the button), so
// buttons stay live during a turn. One press is recorded at a time: while one is, every other
// button but STOP is drawn as plain text, so a double press sends once. STOP is never held back.
// The origin `pane` is written only inside the press… functions below and in settings.tsx, each
// passed as a Button's onPress, an Input's onSubmit or a Select's onSelect; scripts/mod/validate.js checks it.
import type { EngineInterface, PluginState, RenderInput } from 'claude-code'
import { ask, FAILED, type Answer, type PaneModel } from './ask'
import { body, caption, filled, footnote, heading, link, outlined, small, stop as stopButton } from './calm'
import type { Table } from './calm'
import { HIDE_WHY, NOT_HANDED, PANE_LEAD, RECORDING, SHOW_ME, SUGGEST, WHAT_WOULD_YOU_CHANGE, WHY, suggestedAt, typeYourChange, WHAT_CHANGED } from './numbers'

// A card of the pane's model. It comes from another process, so each field is read as anything.
type Card = Record<string, unknown>
type Pressing = PluginState['wheelhouse']['pressing']
// What runs once the bridge has answered a press: a tick, or a fresh read of the settings.
export type After = () => Promise<unknown>

const PRESSING = { plugin: 'wheelhouse', key: 'pressing' } as const
const STOPPING = { plugin: 'wheelhouse', key: 'stopping' } as const

// Drawn in place of every button while a turn runs, when pane.tsx's HIDE_WHILE_BUSY is on.
export const WAIT = 'Wait for Claude to finish, or type stop'
// A Shape 2 foreman's watcher lines that couldn't be handed to the foreman. NOT_HANDED, for a
// prompt that couldn't be handed to the front desk, is in numbers.ts.
export const NOT_HANDED_FOREMAN = 'The watcher\'s news didn\'t reach the foreman.'
const LIFT = 'lift-stop'
const WHY_OPEN = { plugin: 'wheelhouse', key: 'why' } as const
const SUGGESTING = { plugin: 'wheelhouse', key: 'suggesting' } as const
const SUGGEST_BOX = (id: string) => `suggest:${id}`

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
  await $.state.set(SUGGESTING, null)
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
  await carry($, { cmd: 'press', origin: 'pane', card: id, hash: card.hash, label }, RECORDING, () => release($), after)
}

// Why? on a card. One the bridge gave as `why` opens or closes the reasons in place, and opening
// tells the bridge quietly, never waiting for it and showing nothing. One it gave as `turn` (a
// card whose parts can't be trusted to show) hands the front desk a prompt naming the card, after
// the same quiet word, and opens nothing.
async function pressWhy($: EngineInterface, card: Card, turn: boolean) {
  const id = card.id as string
  const cwd = await $.session.root()
  const quiet = { cmd: 'why', origin: 'pane', cwd, card: id, hash: card.hash }
  if (turn) {
    if (!(await claim($, { on: id, label: WHY }))) return
    void ask($, quiet)
    try {
      await submitAll($, [`${PANE_LEAD} the director pressed ${WHY} on card ${typeof card.n === 'number' ? card.n : id} (${id}).`])
    } finally {
      await release($)
    }
    return
  }
  const open = (await $.state.get(WHY_OPEN)).value === id
  if (!open) void ask($, quiet)
  await $.state.set(WHY_OPEN, open ? null : id)
}

// Suggest a change… on a card opens its box (or, where the surface has no box, the note to type
// the change in the chat). The words already typed for that card stay.
async function openSuggest($: EngineInterface, card: Card) {
  const kept = (await $.state.get(SUGGESTING)).value
  if (kept?.card === card.id) return
  await $.state.set(SUGGESTING, { card: card.id as string, words: '' })
}

// The words typed in the box, kept in the session's state while the box is open.
async function keepWords($: EngineInterface, id: string, words: string) {
  await $.state.set(SUGGESTING, { card: id, words })
}

// Cancel: the box closes and its words are gone. Nothing is sent.
async function closeSuggest($: EngineInterface) {
  await $.state.set(SUGGESTING, null)
}

// Send, or Enter in the box (which hands over the words as typed): the words steer a new proposal
// and never approve anything. Nothing is sent while the words are empty or another press is being
// recorded. The box closes once the bridge has answered, and its `submit` prompt goes to the front desk.
async function pressSuggest($: EngineInterface, card: Card, after: After, typed?: string) {
  const id = card.id as string
  const kept = (await $.state.get(SUGGESTING)).value
  const words = (typed ?? (kept?.card === id ? kept.words : '')).trim()
  if (words === '') return
  if (!(await claim($, { on: id, label: SUGGEST }))) return
  await carry($, { cmd: 'suggest', origin: 'pane', card: id, hash: card.hash, words }, RECORDING, async () => {
    await closeSuggest($)
    await release($)
  }, after)
}

// STOP: never held back by another press, only by its own.
async function pressStop($: EngineInterface, after: After) {
  const held = await $.state.get(STOPPING)
  if (held.value === true) return
  if (!(await $.state.set(STOPPING, true, { ifVersion: held.version })).isSet) return
  await carry($, { cmd: 'stop', origin: 'pane' }, RECORDING, () => $.state.set(STOPPING, false), after)
}

// Lift STOP, carrying the start of the STOP the pane drew: the bridge lifts only that one.
async function pressLift($: EngineInterface, since: unknown, after: After) {
  if (!(await claim($, { on: LIFT, label: 'Lift STOP' }))) return
  await carry($, { cmd: 'go', origin: 'pane', since: typeof since === 'string' ? since : null }, RECORDING, () => release($), after)
}

// The labels of the buttons the bridge gave a card, in its order, each once.
function labelsOf(card: Card): string[] {
  const given = Array.isArray(card.buttons) ? card.buttons : []
  return [...new Set(given.map((b) => (isRecord(b) && typeof b.label === 'string' ? b.label : '')).filter((label) => label !== ''))]
}

// STOP's control, which the pane lays out: STOP while STOP is off, Lift STOP while it is on, or
// the word that the press is being recorded. `live` is false while HIDE_WHILE_BUSY holds every
// button back.
export async function drawStop($: EngineInterface, e: RenderInput<'Pane'>, model: PaneModel, pressing: Pressing, live: boolean, after: After) {
  const t = $.ui.resolve(e)
  if (!live) return footnote(t, WAIT)
  const stop = isRecord(model.stop) ? model.stop : {}
  if (stop.on === true) {
    if (pressing?.on === LIFT) return body(t, RECORDING)
    if (pressing !== null) return footnote(t, 'Lift STOP')
    const since = stop.since
    return filled(t, LIFT, 'Lift STOP', () => pressLift($, since, after))
  }
  if ((await $.state.get(STOPPING)).value === true) return body(t, RECORDING)
  return stopButton(t, () => pressStop($, after))
}

const isShape = (shape: unknown): shape is 'filled' | 'outlined' | 'small' | 'link' =>
  shape === 'filled' || shape === 'outlined' || shape === 'small' || shape === 'link'

// A button the bridge gave a card, as the mod reads it.
type Given = { label: string, does: string, shape: 'filled' | 'outlined' | 'small' | 'link', href: string | null, corner: boolean }

// The buttons the bridge gave a card, in its order, each label once. A shape the mod doesn't know
// is drawn small.
function givenOf(card: Card): Given[] {
  const given = Array.isArray(card.buttons) ? card.buttons : []
  const seen = new Set<string>()
  const out: Given[] = []
  for (const b of given) {
    if (!isRecord(b) || typeof b.label !== 'string' || b.label === '' || seen.has(b.label)) continue
    seen.add(b.label)
    out.push({
      label: b.label,
      does: typeof b.does === 'string' ? b.does : 'record',
      shape: isShape(b.shape) ? b.shape : 'small',
      href: typeof b.href === 'string' && /^https:/.test(b.href) ? b.href : null,
      corner: b.corner === true,
    })
  }
  return out
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

// A card with no parts: its text whole as plain text, its note under it, and one button per entry
// of its buttons, keyed by the card's id and the label. Its Why? has no reasons to open, so it hands
// the front desk a prompt naming the card, as Why? does on a card failing its check.
function drawWhole($: EngineInterface, e: RenderInput<'Pane'>, card: Card, pressing: Pressing, live: boolean, after: After) {
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
            if (label === WHY) return <Button key={`card:${id}:${label}`} label={label} onPress={() => pressWhy($, card, true)} />
            return <Button key={`card:${id}:${label}`} label={label} onPress={() => pressButton($, card, label, after)} />
          })}
        </Box>
      )}
    </Box>
  )
}

// One of a card's buttons in the shape the bridge gave it, or its plain word while another press
// is recorded.
function drawButton($: EngineInterface, t: Table, card: Card, id: string, b: Given, pressing: Pressing, open: boolean, after: After) {
  if (b.shape === 'link' && b.href !== null) return link(t, b.href, b.label)
  if (pressing?.on === id && pressing.label === b.label) return body(t, RECORDING)
  if (pressing !== null) return footnote(t, b.label)
  const key = `card:${id}:${b.label}`
  if (b.does === 'suggest') {
    const open = () => openSuggest($, card)
    if (b.shape === 'filled') return filled(t, key, b.label, open)
    if (b.shape === 'outlined') return outlined(t, key, b.label, open)
    return small(t, key, b.label, open)
  }
  const label = b.does === 'why' && open ? HIDE_WHY : b.label
  // Each press is written out beside its shape, since scripts/mod/validate.js reads a press only as
  // the last argument of filled, outlined or small.
  const why = b.does === 'why' || (b.does === 'turn' && b.label === WHY)
  const turn = b.does === 'turn'
  if (b.shape === 'filled') return why ? filled(t, key, label, () => pressWhy($, card, turn)) : filled(t, key, label, () => pressButton($, card, b.label, after))
  if (b.shape === 'outlined') return why ? outlined(t, key, label, () => pressWhy($, card, turn)) : outlined(t, key, label, () => pressButton($, card, b.label, after))
  return why ? small(t, key, label, () => pressWhy($, card, turn)) : small(t, key, label, () => pressButton($, card, b.label, after))
}

// The box for a suggested change: the words typed so far, Send (plain while there are none or
// another press is recorded) and Cancel. Where the surface has no Input, the note says to type it
// in the chat instead.
function drawSuggest($: EngineInterface, t: Table, typeable: boolean, card: Card, id: string, words: string, pressing: Pressing, after: After) {
  if (!typeable) return footnote(t, typeYourChange(typeof card.n === 'number' ? card.n : id))
  const recording = pressing?.on === id && pressing.label === SUGGEST
  const send = words.trim() === '' || pressing !== null ? (recording ? body(t, RECORDING) : footnote(t, 'Send')) : filled(t, 'suggest-send', 'Send', () => pressSuggest($, card, after))
  return (
    <t.Box flexDirection="column" gap="xs">
      <t.Input
        key={SUGGEST_BOX(id)}
        label={WHAT_WOULD_YOU_CHANGE}
        value={words}
        autoFocus
        onInput={(v: string) => keepWords($, id, v)}
        onSubmit={(v: string) => pressSuggest($, card, after, v)}
      />
      <t.Box flexDirection="row" gap="sm">
        {send}
        {outlined(t, 'suggest-cancel', 'Cancel', () => closeSuggest($))}
      </t.Box>
    </t.Box>
  )
}

// A card with parts, part by part (design section 23.3). `place` is "1 of 2". Nothing in its words
// is a link or a heading but the ask. `suggesting` is the words typed in its Suggest a change… box
// while that is open, else null.
function drawParts($: EngineInterface, e: RenderInput<'Pane'>, card: Card, parts: Card, place: string | null, pressing: Pressing, open: boolean, suggesting: string | null, live: boolean, after: After) {
  const t = $.ui.resolve(e)
  const { Box } = t
  const id = typeof card.id === 'string' ? card.id : null
  const header = text(parts.header) ?? text(card.header)
  const where = card.revised === true ? 'revised' : place
  const given = id === null || !live ? [] : givenOf(card)
  const draw = (b: Given) => drawButton($, t, card, id as string, b, pressing, open, after)
  const corner = given.find((b) => b.corner)
  const minutes = typeof parts.optional === 'number' && parts.optional > 0 ? `optional · ${parts.optional} min` : null
  const smallLine = [text(parts.small), text(card.waited), minutes].filter((x) => x !== null).join(' · ')
  const options = Array.isArray(parts.options) ? parts.options.filter(isRecord) : []
  const reasons = [text(parts.why), ...options.map((o) => (text(o.label) === null ? null : `${o.label}: ${text(o.says) ?? ''}`.replace(/: $/, ''))), text(parts.meanwhile)]
  const row = given.filter((b) => !b.corner && (b.does === 'why' || b.shape === 'link' || b.label === SHOW_ME))
  const answers = given.filter((b) => !b.corner && !row.includes(b))
  const checking = [text(parts.line), text(parts.code)].filter((x) => x !== null).join(' · ')
  const changed = text(parts.changed)
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" justifyContent="space-between">
        {footnote(t, [header, where].filter((x) => x !== null).join(' · '))}
        {corner !== undefined && draw(corner)}
      </Box>
      {text(parts.ask) !== null && heading(t, parts.ask as string)}
      {text(parts.what) !== null && text(parts.what) !== text(parts.ask) && body(t, parts.what as string)}
      {smallLine !== '' && footnote(t, smallLine)}
      {text(parts.recommendation) !== null && body(t, parts.recommendation as string)}
      {card.revised === true && changed !== null && body(t, `${WHAT_CHANGED} ${changed}`)}
      {row.length > 0 && <Box flexDirection="row" gap="sm">{row.map(draw)}</Box>}
      {open && reasons.filter((r) => r !== null).map((r) => body(t, r as string))}
      {typeof card.steered === 'string' && footnote(t, suggestedAt(card.steered))}
      {answers.length > 0 && <Box flexDirection="row" gap="sm" flexWrap="wrap">{answers.map(draw)}</Box>}
      {suggesting !== null && id !== null && given.some((b) => b.does === 'suggest') && drawSuggest($, t, e.surface !== 'mobile', card, id, suggesting, pressing, after)}
      {typeof card.note === 'string' && footnote(t, card.note)}
      {checking !== '' && caption(t, checking)}
    </Box>
  )
}

// A card, drawn as its parts, or as its text whole when it has none. `place` is "1 of 2".
export async function drawCard($: EngineInterface, e: RenderInput<'Pane'>, card: Card, place: string | null, pressing: Pressing, live: boolean, after: After) {
  if (!isRecord(card.parts)) return drawWhole($, e, card, pressing, live, after)
  const open = typeof card.id === 'string' && (await $.state.get(WHY_OPEN)).value === card.id
  const suggest = (await $.state.get(SUGGESTING)).value
  const suggesting = typeof card.id === 'string' && suggest?.card === card.id ? suggest.words : null
  return drawParts($, e, card, card.parts, place, pressing, open, suggesting, live, after)
}
