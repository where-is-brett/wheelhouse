// scripts/lib/window-lines.js
// The words of a card as the helper's own window shows them. The set line ("Answer question q-…") and the reply code line are
// for the prompt record, which reads a typed reply in a chat; in the window the director clicks, so they are left out.
const SET_LINE = /^Answer question q-[a-z0-9-]+-[0-9]+$/;
const CODE_LINE = /^Reply code: \S+$/;

export const windowLines = (question) => String(question).split(/\r?\n/).filter((l) => !SET_LINE.test(l) && !CODE_LINE.test(l));
