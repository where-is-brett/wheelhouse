// hooks/mod/calm.tsx
// The Calm interface's drawing kit (design sections 23.2 and 23.3). Each function takes the
// surface's resolved table, `$.ui.resolve(e)`, and draws one piece, so every file of the mod draws
// alike. No other file sets a colour or a size: a colour is a theme key, never a literal.
import type { EngineInterface } from 'claude-code'

export type Table = ReturnType<EngineInterface['ui']['resolve']>
// The theme keys a word may take beside its plain words.
export type Level = 'success' | 'warning' | 'error'
// Whatever a group holds: elements, or lists of them.
type Children = unknown

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

// A rounded, quiet outline round its children, and its note under it in footnote.
export function group(t: Table, children: Children, note?: string) {
  return (
    <t.Box flexDirection="column">
      <t.Box flexDirection="column" borderStyle="round" borderColor="subtle" padding="sm">
        {children}
      </t.Box>
      {note !== undefined && footnote(t, note)}
    </t.Box>
  )
}

// The four shapes. A press is the caller's; the key names the button for the engine.
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
// Outlined at the footnote's size: the type table gives a Button no size of its own, so its label does.
export function small(t: Table, key: string, label: string, onPress: () => unknown) {
  return (
    <t.Button key={key} label={label} variant="secondary" onPress={onPress}>
      <t.Text size="footnote" color="suggestion">{label}</t.Text>
    </t.Button>
  )
}
export function link(t: Table, href: string, label: string) {
  return <t.Link href={href} label={`${label} ↗`} />
}

// STOP: outlined, its label in error, and never beside a filled button.
export function stop(t: Table, onPress: () => unknown) {
  return (
    <t.Button key="stop" label="STOP" variant="secondary" onPress={onPress}>
      <t.Text color="error">STOP</t.Text>
    </t.Button>
  )
}

// A word in success, warning or error beside its plain words.
export function status(t: Table, word: string, level: Level, words?: string) {
  return (
    <t.Box flexDirection="row" gap="sm">
      <t.Text color={level}>{word}</t.Text>
      {words !== undefined && words !== '' && body(t, words)}
    </t.Box>
  )
}
