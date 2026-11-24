// scripts/lib/ascii-json.js
// JSON for a command that prints to the model: every character outside ASCII is written as \uXXXX. The model reads the
// escape back as the character, so a shell reading the output in an old Windows console code page can't turn the three
// bytes of "…" (or an accent or a dash) into three wrong characters.
export function asciiJson(value, space) {
  return (JSON.stringify(value, null, space) ?? '').replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
