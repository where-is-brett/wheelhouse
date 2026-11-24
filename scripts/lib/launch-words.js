// scripts/lib/launch-words.js
// The launch command: the program a builder start runs `claude` through (a wrapper that sets a gateway, say), kept as an
// array of words and never as one string, so no shell ever reads it (design section 8). The director types it as they
// would in a terminal; splitLaunch splits it by a rule of its own and refuses everything a shell would act on, and
// checkLaunch holds a stored value to the same limits on every read.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_WORDS = 8;
// A word is shorter than this.
export const MAX_WORD_LENGTH = 200;

// The characters no word may hold: `'` `` ` `` `$` `;` `|` `&` `<` `>` `(` `)` `%` `!` `^`, a line break, NUL.
const REFUSED = /['`$;|&<>()%!^\r\n\0]/;
const NAMES = { "'": "a single quote `'`", '`': 'a backtick', $: '`$`', ';': '`;`', '|': '`|`', '&': '`&`', '<': '`<`', '>': '`>`', '(': '`(`', ')': '`)`', '%': '`%`', '!': '`!`', '^': '`^`', '\r': 'a line break', '\n': 'a line break', '\0': 'a character Wheelhouse can\'t pass' };
// Other control characters (a tab, an escape) separate nothing and are never part of a word.
const CONTROL = /[\u0001-\u001f\u007f]/;
const PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// What Wheelhouse sets itself (the mode, the permissions, the tools, the settings and the session), so no later word may
// begin like one.
const OWN_FLAGS = /^(-p|--print|--resume|--session-id|--settings|--setting-sources|--permission-mode|--dangerously-skip-permissions|--allow-dangerously-skip-permissions|--allowedTools|--allowed-tools|--disallowedTools|--disallowed-tools)/;
// cmd.exe reads a backslash just before a word's closing quote as escaping it, so no word may end in one (quoteForCmd).
const TRAILING_BACKSLASH = /\\$/;
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];
const USE_CMD_OR_EXE = 'use the wrapper\'s `.cmd` or `.exe`';

// What the director typed, as words: `{ ok: true, words }`, or `{ ok: false, refused }` with the reason in plain words.
// Spaces separate words and double quotes group one word; a backslash is an ordinary character (Windows paths).
export function splitLaunch(typed) {
  if (typeof typed !== 'string') return { ok: false, refused: 'Type the command as you would in a terminal.' };
  const bad = typed.match(REFUSED);
  if (bad !== null) return { ok: false, refused: `Wheelhouse can't run a command with ${NAMES[bad[0]]} in it. Type the program and its words only, with spaces between them.` };
  if (CONTROL.test(typed)) return { ok: false, refused: 'Wheelhouse can\'t run a command with a tab or another control character in it. Use spaces between words.' };
  const words = [];
  let word = '';
  let started = false;
  let quoted = false;
  for (const ch of typed) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (ch === ' ' && !quoted) {
      if (started) {
        if (word === '') return { ok: false, refused: 'A pair of quotes with nothing between them is not a word.' };
        words.push(word);
      }
      word = '';
      started = false;
    } else {
      word += ch;
      started = true;
    }
  }
  if (quoted) return { ok: false, refused: 'A double quote is left open. Close it, or leave quotes out.' };
  if (started) {
    if (word === '') return { ok: false, refused: 'A pair of quotes with nothing between them is not a word.' };
    words.push(word);
  }
  if (words.length === 0) return { ok: false, refused: 'Type the command as you would in a terminal.' };
  if (words.some((w) => TRAILING_BACKSLASH.test(w))) return { ok: false, refused: 'Wheelhouse can\'t run a command with a word that ends in a backslash. Name the program itself, not its folder.' };
  return { ok: true, words };
}

const isAbsoluteFor = (word, platform) => (platform === 'win32' ? path.win32.isAbsolute(word) : path.posix.isAbsolute(word));
const extensionOf = (word) => path.win32.extname(word).toLowerCase();

// Why `words` can't be a launch command without looking at the computer, in plain words, or null: the shape, the
// characters, the limits, and the first word's form. A stored value is held to this on every read.
export function wordsFault(words, { platform = process.platform } = {}) {
  if (!Array.isArray(words) || words.length === 0) return 'The launch command is a list of words.';
  if (words.length > MAX_WORDS) return `The launch command is at most ${MAX_WORDS} words.`;
  for (const word of words) {
    if (typeof word !== 'string' || word === '') return 'Every word of the launch command is text.';
    if (word.length >= MAX_WORD_LENGTH) return `Every word of the launch command is under ${MAX_WORD_LENGTH} characters.`;
    if (REFUSED.test(word) || word.includes('"') || CONTROL.test(word) || TRAILING_BACKSLASH.test(word)) return 'A word of the launch command holds a character Wheelhouse never passes on.';
  }
  const [first, ...rest] = words;
  if (extensionOf(first) === '.ps1') return `A PowerShell script can't be the launch command: ${USE_CMD_OR_EXE}.`;
  if (!PROGRAM_NAME.test(first) && !isAbsoluteFor(first, platform)) return 'The launch command starts with the name of a program, or its full path.';
  const own = rest.find((word) => OWN_FLAGS.test(word));
  if (own !== undefined) return 'Wheelhouse sets the mode, the settings and the session itself, so the launch command can\'t carry that option.';
  return null;
}

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

// The program `word` names, as `{ kind, file }` (`kind` is 'cmd' for a .cmd or .bat, run through cmd.exe), or null when it
// isn't there. Elsewhere than Windows a full path must be an executable file, and a bare name is looked for in the
// PATH's full folders. On Windows a name or path with no extension is looked for as .exe, then .cmd.
export function resolveWord(word, { platform = process.platform, env = process.env, exists = isFile } = {}) {
  if (typeof word !== 'string' || word === '') return null;
  if (platform !== 'win32') {
    const full = path.posix.isAbsolute(word);
    const candidates = full ? [word] : (env.PATH ?? '').split(':').filter((folder) => folder.startsWith('/')).map((folder) => path.posix.join(folder, word));
    const file = candidates.find((candidate) => exists(candidate));
    return file === undefined ? null : { kind: 'direct', file };
  }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const folders = (pathKey ? env[pathKey] : '').split(';').map((folder) => folder.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const bases = path.win32.isAbsolute(word) ? [word] : folders.map((folder) => path.win32.join(folder, word));
  const names = WINDOWS_EXTENSIONS.includes(extensionOf(word)) ? [''] : ['.exe', '.cmd'];
  for (const name of names) {
    for (const base of bases) {
      const file = `${base}${name}`;
      if (exists(file)) return { kind: ['.cmd', '.bat'].includes(extensionOf(file)) ? 'cmd' : 'direct', file };
    }
  }
  return null;
}

// Whether `words` can be run here: `{ ok: true }` or `{ ok: false, why }`. `which(word)` is whether the first word
// is a program on this computer (a full path or anything truthy), by default resolveWord on the process's PATH.
export function checkLaunch(words, { platform = process.platform, which = (word) => resolveWord(word, { platform }) } = {}) {
  const why = wordsFault(words, { platform });
  if (why !== null) return { ok: false, why };
  if (!which(words[0])) return { ok: false, why: `The launch command's program, \`${words[0]}\`, isn't on this computer's PATH, and isn't a full path to a program that is there.` };
  return { ok: true };
}

// The words in plain words, as the card shows them back: "Wheelhouse will run: `wrap` then `claude`".
export const sayLaunch = (words) => `Wheelhouse will run: ${words.map((word) => `\`${word}\``).join(' then ')}`;
