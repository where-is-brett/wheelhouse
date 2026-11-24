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

// The text with its comments and trailing commas taken out, outside strings.
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
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

// The files setup reads as settings, with how the director knows each.
function filesOf({ folder, claudeHome }) {
  return [
    { file: path.join(folder, '.claude', 'settings.local.json'), words: 'this computer\'s settings for the project (.claude/settings.local.json in this folder)' },
    { file: path.join(folder, '.claude', 'settings.json'), words: 'the project\'s settings (.claude/settings.json in this folder)' },
    { file: path.join(folder, '.claude', 'wheelhouse.json'), words: 'the project\'s Wheelhouse settings (.claude/wheelhouse.json in this folder)' },
    ...(typeof claudeHome === 'string' && claudeHome !== '' ? [{ file: path.join(claudeHome, 'settings.json'), words: 'your own Claude Code settings (settings.json in your Claude Code folder)' }] : []),
  ];
}

// The settings files that are there and are not a JSON object: [{ file, words }].
export function damagedSettings({ folder, claudeHome }) {
  return filesOf({ folder, claudeHome }).filter(({ file }) => {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return false;
    }
    return !isObject(parse(text));
  });
}

// The card that says which files can't be read and offers to mend them.
export function mendAsk(damaged) {
  const many = damaged.length > 1;
  const list = damaged.map((d) => d.words).join('; ');
  return {
    id: `mend-${damaged.map((d) => path.basename(d.file)).join('-').replace(/\.json/g, '').replace(/[^A-Za-z0-9-]/g, '-')}`,
    card: {
      level: 2,
      what: `Setup can't read ${many ? 'these files' : 'one of your settings files'}: ${list}. ${many ? 'They are' : 'It is'} not written in the form Claude Code expects, often a stray comma or a missing bracket. Shall setup mend ${many ? 'them' : 'it'}?`,
      why: 'Setup adds settings to these files, and leaves any file it cannot read alone.',
      options: [
        { label: MEND, says: `Setup keeps ${many ? 'each file' : 'your file'} as it is, beside ${many ? 'it' : 'it'} under a new name ending .broken, then writes ${many ? 'each' : 'it'} again with every setting it can read, or empty if it can read none. Nothing else changes.` },
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

// Mends the files: each is copied whole to a new name, then written again with what can be read.
// Gives [{ file, copy, kept }]: `kept` whether any setting could be read.
export function mend(damaged) {
  return damaged.map(({ file }) => {
    const text = fs.readFileSync(file, 'utf8');
    const copy = copyName(file);
    fs.writeFileSync(copy, text, { flag: 'wx' });
    const read = parse(lenient(text));
    const data = isObject(read) ? read : {};
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    return { file, copy, kept: Object.keys(data).length > 0 };
  });
}
