// scripts/setup/settings-check.js
// The settings files setup will not change when it can't read them, looked at before the first card: the project's
// .claude/settings.json, settings.local.json and wheelhouse.json, and the director's own Claude Code settings.json. A file
// that is there but is not a JSON object stops steps 2, 6 and 7, so setup says so first, plainly, and offers to mend it:
// the file is kept beside itself under a new name, then written again with whatever can be read (a stray comma or a
// comment is dropped), or empty where nothing can.
import fs from 'node:fs';
import path from 'node:path';

export const MEND = 'Mend it';
export const MEND_MYSELF = 'I\'ll mend it myself';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const parse = (text) => {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
};

// The text with its comments and trailing commas taken out, outside strings: what is inside a string is kept as written.
function lenient(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (c === ',') {
      // A comma with only space, a line's end or a comment before the next } or ] is a trailing one, and is dropped.
      let j = i + 1;
      for (;;) {
        while (j < text.length && /\s/.test(text[j])) j += 1;
        if (text[j] === '/' && text[j + 1] === '/') {
          while (j < text.length && text[j] !== '\n') j += 1;
        } else if (text[j] === '/' && text[j + 1] === '*') {
          const end = text.indexOf('*/', j + 2);
          j = end === -1 ? text.length : end + 2;
        } else break;
      }
      if (text[j] !== '}' && text[j] !== ']') out += c;
    } else out += c;
  }
  return out;
}

// The files setup reads as settings, with how the director knows each.
function filesOf({ folder, claudeHome }) {
  return [
    { base: folder, file: path.join(folder, '.claude', 'settings.local.json'), words: 'this computer\'s settings for the project (.claude/settings.local.json in this folder)' },
    { base: folder, file: path.join(folder, '.claude', 'settings.json'), words: 'the project\'s settings (.claude/settings.json in this folder)' },
    { base: folder, file: path.join(folder, '.claude', 'wheelhouse.json'), words: 'the project\'s Wheelhouse settings (.claude/wheelhouse.json in this folder)' },
    ...(typeof claudeHome === 'string' && claudeHome !== '' ? [{ base: claudeHome, file: path.join(claudeHome, 'settings.json'), words: 'your own Claude Code settings (settings.json in your Claude Code folder)' }] : []),
  ];
}

// Whether the file, followed through any link, is kept outside its folder (the project's, or the Claude Code folder).
function elsewhere(file, base) {
  try {
    const real = fs.realpathSync(file);
    const root = fs.realpathSync(base);
    return path.relative(root, real).startsWith('..') || path.isAbsolute(path.relative(root, real));
  } catch {
    return true;
  }
}

// The settings files that are there and are not a JSON object: [{ file, words, elsewhere }], `elsewhere` for one that is a
// link to a file outside its folder, which setup names but never writes.
export function damagedSettings({ folder, claudeHome }) {
  return filesOf({ folder, claudeHome }).filter(({ file }) => {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return false;
    }
    return !isObject(parse(text));
  }).map(({ base, file, words }) => ({ file, words, elsewhere: elsewhere(file, base) }));
}

// The card that says which files can't be read and offers to mend them.
export function mendAsk(damaged) {
  const many = damaged.length > 1;
  const list = damaged.map((d) => (d.elsewhere ? `${d.words}, a link to a file kept elsewhere, which setup leaves for you to mend` : d.words)).join('; ');
  return {
    id: `mend-${damaged.map((d) => path.basename(d.file)).join('-').replace(/\.json/g, '').replace(/[^A-Za-z0-9-]/g, '-')}`,
    card: {
      level: 2,
      what: `Setup can't read ${many ? 'these files' : 'one of your settings files'}: ${list}. ${many ? 'They are' : 'It is'} not written in the form Claude Code expects, often a stray comma or a missing bracket. Shall setup mend ${many ? 'them' : 'it'}?`,
      why: 'Setup adds settings to these files, and leaves any file it cannot read alone.',
      options: [
        { label: MEND, says: `Setup keeps ${many ? 'each file' : 'your file'} as it is, beside it under a new name ending .broken, then writes ${many ? 'each' : 'it'} again with every setting it can read, or empty if it can read none.${damaged.some((d) => d.elsewhere) ? ' A link to a file kept elsewhere is left for you.' : ''} Nothing else changes.` },
        { label: MEND_MYSELF, says: 'Nothing changes. Setup waits until you have mended it, and carries on when you say "carry on with setup".' },
      ],
      recommend: MEND,
      because: 'nothing is lost',
      meanwhile: 'Nothing runs until you choose.',
    },
  };
}

// The name a damaged file's copy is kept under: file.broken, then file.broken-2 and so on.
function copyName(file) {
  for (let n = 1; ; n += 1) {
    const name = `${file}.broken${n === 1 ? '' : `-${n}`}`;
    if (!fs.existsSync(name)) return name;
  }
}

// Mends the files: each is copied whole to a new name, with its own permissions, then written again with what can be read.
// A link to a file elsewhere is never written, and a file that can't be written is left as it was, its copy taken away again.
// Gives [{ file, mended, copy, kept }]: `kept` whether any setting could be read.
export function mend(damaged) {
  return damaged.map(({ file, elsewhere: away }) => {
    if (away) return { file, mended: false };
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return { file, mended: false };
    }
    // Read again, so a file mended meanwhile is never touched.
    if (isObject(parse(text))) return { file, mended: false };
    const read = parse(lenient(text));
    const data = isObject(read) ? read : {};
    const copy = copyName(file);
    let made = false;
    try {
      fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
      made = true;
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    } catch {
      // Nothing was written, so the copy setup just made goes again; the file itself is as it was.
      if (made) fs.rmSync(copy, { force: true });
      return { file, mended: false };
    }
    return { file, mended: true, copy, kept: Object.keys(data).length > 0 };
  });
}
