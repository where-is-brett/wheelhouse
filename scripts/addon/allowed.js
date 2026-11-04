// scripts/addon/allowed.js
// Whether a company's allow list for VS Code extensions lets the Wheelhouse add-on in. It reads only what any user can:
// the AllowedExtensions policy (the registry on Windows, the managed preference on a Mac), then the user's own
// `extensions.allowed` setting. A policy wins over the setting. The answer is false only when a list was read and does not
// name the add-on. Anything that can't be read or understood is null, "can't tell", and never "blocked": the offer still comes,
// and a refused install says that IT may block it.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';

export const ADDON_ID = 'wheelhouse.wheelhouse';
const PUBLISHER = 'wheelhouse';
const WINDOWS_KEY = 'Software\\Policies\\Microsoft\\VSCode';
const MAC_DOMAIN = '/Library/Managed Preferences/com.microsoft.VSCode';
const READ_WAIT_MS = 10000;

const CANT_TELL = (why) => ({ allowed: null, why });

// JSON with the comments and trailing commas VS Code's settings file allows. Strings are respected.
function parseSettings(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1').replace(/^﻿/, ''));
}

// What a list says about the add-on: true, false, or null when a value can't be understood.
function verdictOf(list) {
  if (list === null || typeof list !== 'object' || Array.isArray(list)) return null;
  const byName = new Map(Object.entries(list).map(([k, v]) => [k.toLowerCase(), v]));
  const valueOf = (v) => {
    if (v === true || v === 'stable') return true;
    if (v === false) return false;
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) return true;
    return undefined;
  };
  // The most specific entry decides: the id, then the publisher, then everything.
  for (const key of [ADDON_ID, PUBLISHER, '*']) {
    if (!byName.has(key)) continue;
    const got = valueOf(byName.get(key));
    return got === undefined ? null : got;
  }
  // Nothing names it. Values that can't be understood might have; those are "can't tell".
  if ([...byName.values()].some((v) => valueOf(v) === undefined)) return null;
  return false;
}

// The text after REG_SZ (or REG_EXPAND_SZ) on the value's line.
const regValue = (stdout) => /^\s*AllowedExtensions\s+REG_\w+\s+(.*?)\s*$/m.exec(String(stdout))?.[1] ?? null;

// addonAllowed({ platform, run, readFile, env, home }) -> Promise<{ allowed: true | false | null, why }>. Never throws.
export async function addonAllowed({
  platform = process.platform,
  run = realRun,
  readFile = (file) => fs.readFile(file, 'utf8'),
  env = process.env,
  home = os.homedir(),
} = {}) {
  try {
    // 1. The policy.
    let policy = null;
    if (platform === 'win32') {
      for (const hive of ['HKLM', 'HKCU']) {
        try {
          const got = await run('reg', ['query', `${hive}\\${WINDOWS_KEY}`, '/v', 'AllowedExtensions'], { env, input: '', timeoutMs: READ_WAIT_MS });
          if (got?.code === 0) {
            policy = regValue(got.stdout);
            if (policy !== null) break;
          }
        } catch { /* no registry tool to ask: nothing read from this hive */ }
      }
    } else if (platform === 'darwin') {
      try {
        const got = await run('defaults', ['read', MAC_DOMAIN, 'AllowedExtensions'], { env, input: '', timeoutMs: READ_WAIT_MS });
        if (got?.code === 0 && String(got.stdout).trim() !== '') policy = String(got.stdout).trim();
      } catch { /* no preference tool to ask: nothing read */ }
    }
    if (policy !== null) {
      let list;
      try { list = JSON.parse(policy); } catch { return CANT_TELL('The company policy for extensions is there, but it couldn\'t be read.'); }
      const verdict = verdictOf(list);
      if (verdict === null) return CANT_TELL('The company policy for extensions is there, but it couldn\'t be understood.');
      return { allowed: verdict, why: verdict ? 'The company policy for extensions allows the Wheelhouse add-on.' : 'The company policy for extensions doesn\'t name the Wheelhouse add-on.' };
    }
    // 2. The user's own setting.
    const settingsFile = platform === 'win32'
      ? path.win32.join(env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'settings.json')
      : platform === 'darwin'
        ? path.posix.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json')
        : path.posix.join(env.XDG_CONFIG_HOME ?? path.posix.join(home, '.config'), 'Code', 'User', 'settings.json');
    let text;
    try { text = await readFile(settingsFile); } catch { return CANT_TELL('No allow list was found to read.'); }
    let settings;
    try { settings = parseSettings(String(text)); } catch { return CANT_TELL('VS Code\'s settings file couldn\'t be read.'); }
    const list = settings?.['extensions.allowed'];
    // No list in the settings: the policy may still hold one that couldn't be read here, so this is "can't tell", not "free".
    if (list === undefined) return CANT_TELL('No allow list was found in VS Code\'s settings.');
    const verdict = verdictOf(list);
    if (verdict === null) return CANT_TELL('VS Code\'s allow list couldn\'t be understood.');
    return { allowed: verdict, why: verdict ? 'VS Code\'s settings allow the Wheelhouse add-on.' : 'VS Code\'s settings allow only other extensions.' };
  } catch {
    return CANT_TELL('The allow list couldn\'t be read.');
  }
}
