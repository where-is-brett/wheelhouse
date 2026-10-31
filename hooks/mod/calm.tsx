// hooks/mod/calm.tsx
// The Calm interface's drawing kit (design sections 23.2 and 23.3). Each function takes the
// surface's resolved table, `$.ui.resolve(e)`, and draws one piece, so every file of the mod draws
// alike. No other file sets a colour or a size: a colour is a theme key, never a literal.
import type { EngineInterface, RenderInput } from 'claude-code'

// The surface's table, and whether the surface draws a fill as a block, as the terminal does: it
// then keeps the quiet line alone and no bar.
export type Table = ReturnType<EngineInterface['ui']['resolve']> & { blocky?: boolean }
export function tableOf($: EngineInterface, e: RenderInput<'Pane'>): Table {
  return { ...$.ui.resolve(e), blocky: e.surface === 'terminal' }
}
// The theme keys a word may take beside its plain words.
export type Level = 'success' | 'warning' | 'error'
// Whatever a group holds: elements, or lists of them.
type Children = unknown

const fill = (t: Table, key: string) => (t.blocky === true ? {} : { backgroundColor: key })

// The five type styles.
export function title(t: Table, text: string) {
  return <t.Text size="title" weight="semibold">{text}</t.Text>
}
export function heading(t: Table, text: string) {
  return <t.Text size="heading" weight="semibold">{text}</t.Text>
}
export function body(t: Table, text: string) {
  return <t.Text size="body">{text}</t.Text>
}
export function footnote(t: Table, text: string) {
  return <t.Text size="footnote" dimColor>{text}</t.Text>
}
// The checking line and the reply code only.
export function caption(t: Table, text: string) {
  return <t.Text size="caption" mono dimColor>{text}</t.Text>
}

// A raised panel with the theme's quiet line. A border set here would be the muted text colour.
export function panel(t: Table, children: Children) {
  return (
    <t.Box flexDirection="column" gap="md" borderStyle="round" padding="lg" {...fill(t, 'composerSidebarBackground')}>
      {children}
    </t.Box>
  )
}

// A panel with its name above it in the footnote voice, and its note under it.
export function group(t: Table, children: Children, name?: string, note?: string) {
  return (
    <t.Box flexDirection="column" gap="xs">
      {name !== undefined && <t.Text size="footnote" weight="medium" dimColor>{name}</t.Text>}
      <t.Box flexDirection="column" gap="md" borderStyle="round" {...fill(t, 'composerSidebarBackground')}>
        {children}
      </t.Box>
      {note !== undefined && footnote(t, note)}
    </t.Box>
  )
}

// The soft blue band a card's recommendation sits in.
export function band(t: Table, children: Children) {
  return (
    <t.Box flexDirection="column" borderStyle="round" borderColor="selectionBg" {...fill(t, 'selectionBg')}>
      {children}
    </t.Box>
  )
}

// The panel All stop leads the pane with while it is on.
export function alarm(t: Table, children: Children) {
  return (
    <t.Box flexDirection="column" gap="sm" borderStyle="round" padding="lg" {...fill(t, 'diffRemovedDimmed')}>
      {children}
    </t.Box>
  )
}

// A name at the left and its value at the right. A value too long to sit beside its name falls to
// the next line whole, so neither breaks inside a word.
export function ends(t: Table, left: Children, right?: Children) {
  return (
    <t.Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap="sm">
      {left}
      {right}
    </t.Box>
  )
}

// The progress bar: one step per blocker, up to BAR_STEPS.
const BAR_STEPS = 24
export function bar(t: Table, done: number, total: number) {
  if (t.blocky === true || total <= 0) return false
  const steps = Math.min(total, BAR_STEPS)
  const lit = Math.round((done / total) * steps)
  return (
    <t.Box flexDirection="row" gap="xs">
      {Array.from({ length: steps }, (_, i) => <t.Box flexGrow={1} height={0.3} backgroundColor={i < lit ? 'rate_limit_fill' : 'rate_limit_empty'} />)}
    </t.Box>
  )
}

// The four shapes. A press is the caller's; the key names the button for the engine. Desktop draws
// a Button's label alone and the terminal draws its children, so the tint shows in the terminal.
export function filled(t: Table, key: string, label: string, onPress: () => unknown) {
  return <t.Button key={key} label={label} variant="primary" onPress={onPress} />
}
export function outlined(t: Table, key: string, label: string, onPress: () => unknown) {
  return (
    <t.Button key={key} label={label} variant="secondary" onPress={onPress}>
      <t.Text color="suggestion">{label}</t.Text>
    </t.Button>
  )
}
// A quiet text button, at full strength under the pointer. The type table gives a Button no size of
// its own, so its label does.
export function small(t: Table, key: string, label: string, onPress: () => unknown) {
  return (
    <t.Button key={key} label={label} plain dimColor onPress={onPress}>
      <t.Text size="footnote" color="suggestion">{label}</t.Text>
    </t.Button>
  )
}
export function link(t: Table, href: string, label: string) {
  return <t.Link href={href} label={`${label} ↗`} />
}

// STOP: outlined, its label in error where the surface draws one, and never beside a filled button.
export function stop(t: Table, onPress: () => unknown) {
  return (
    <t.Button key="stop" label="All stop" variant="secondary" onPress={onPress}>
      <t.Text color="error">All stop</t.Text>
    </t.Button>
  )
}

// A word in success, warning or error, with its plain words under it.
export function status(t: Table, word: string, level: Level, words?: string) {
  if (words === undefined || words === '') return <t.Text color={level}>{word}</t.Text>
  return (
    <t.Box flexDirection="column">
      <t.Text size="footnote" weight="medium" color={level}>{word}</t.Text>
      {body(t, words)}
    </t.Box>
  )
}

// The line saying what is shown is old.
export function alert(t: Table, text: string) {
  return <t.Text size="footnote" color="warning">{text}</t.Text>
}
