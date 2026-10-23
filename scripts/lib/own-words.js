// scripts/lib/own-words.js
// The director's own words in a prompt. In a session another session started, the Claude app puts
// system reminders ("Linked sessions now ...") before the line the director typed, so a typed
// "stop" or a reply code is no longer at the start. This reads past whole leading reminder blocks,
// each with its tags on lines of their own, and returns what follows. It only ever reads past the
// app's text before the director's line, never after it, and it says nothing about who typed:
// that is the origin's alone. The mod keeps its own copy (hooks/mod/messages.ts), since it can't
// import scripts; tests/scripts/mod/validate.test.js keeps the two patterns in step.
const BLOCKS = /^(?:<system-reminder>\n(?:(?:(?!<\/system-reminder>)[\s\S])*\n)?<\/system-reminder>(?:\n|$)\n*)*/;

// The text after any leading reminder blocks, or null when what is left still holds a reminder
// tag, which is not the director's own words. With no leading block, the text as it came.
export function ownWords(text) {
  const lead = BLOCKS.exec(text)?.[0] ?? '';
  if (lead === '') return text;
  const rest = text.slice(lead.length);
  return /<\/?system-reminder>/.test(rest) ? null : rest;
}
