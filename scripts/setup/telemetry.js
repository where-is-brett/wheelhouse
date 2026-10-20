// scripts/setup/telemetry.js
// Telemetry on this computer only, for step 6 (design section 15, check 36, ruling R63): the four
// variables of telemetryEnv(port), which send Claude Code's usage counts to Wheelhouse's receiver
// on this computer, and nothing that records prompts or tool content (contentFree refuses those).
//
// Two routes, both built; setup uses TELEMETRY_ROUTE (scripts/lib/setup-numbers.js) until check
// 36's sitting decides:
// - 'user-settings': each variable under `env` in the user's Claude settings
//   (CLAUDE_CONFIG_DIR/settings.json, else ~/.claude/settings.json), by key, through the step's
//   ctx.applyJsonKey, so the journal holds each one's value before and uninstall puts it back.
// - 'launch-env': the same variables for the account. On macOS `launchctl setenv` for each, and a
//   login item (a LaunchAgent in ~/Library/LaunchAgents) that sets them again at each log-in, since
//   launchctl's do not outlast a restart; on Windows the user's environment variables, through
//   PowerShell. Claude Desktop reads them when it starts, so the card asks for a restart. Each
//   variable is read before it is set and recorded as an `env` change with its value before and
//   where it lives (`where`: 'launchctl' or 'user'); the login item as a `file` change. Putting
//   back the `env` changes is Task 15's (ruling R13): journal.js's reverseChange leaves them to
//   their own step. The login item, a file setup made, it removes while it is as setup wrote it.
//
// A variable the director has already set to a value of their own (their own collector, say) is
// never written over or overridden: then none of the four is set, so telemetry stays wholly as they
// have it, and the card names theirs (check 36: "setup must not overwrite it"). Their own is looked
// for wherever it would take effect: on either route the account's launch environment and the
// environment setup runs in, and on the user-settings route the settings' `env` too (a settings
// key would win over the other two for Claude Code, so writing one would override theirs). A
// launch variable that holds a value of the director's own by the time it is set is refused, not
// written over; setup's own value there (a retry) is set again.
import fs from 'node:fs';
import path from 'node:path';
import { telemetryEnv } from '../telemetry/env.js';
import { newId } from './journal.js';

export const TELEMETRY_ROUTES = Object.freeze(['user-settings', 'launch-env']);

// The login item's label, and so its file's name.
export const LOGIN_ITEM_LABEL = 'wheelhouse.telemetry-env';

// Variables that would have Claude Code send what is typed, what tools do or the raw exchanges:
// the OpenTelemetry log events and their content switches.
const CONTENT = /^OTEL_LOGS?_|PROMPT|TOOL_DETAIL|TOOL_CONTENT|RAW_API/i;

// The variables as given, once none of them would send prompt or tool content; throws naming one that would.
export function contentFree(vars) {
  for (const name of Object.keys(vars)) {
    if (CONTENT.test(name)) throw new Error(`${name} would send prompt or tool content, which Wheelhouse never switches on`);
  }
  return vars;
}

// The login item's file for the account whose home is `userHome`.
export function loginItemFile(userHome) {
  return path.join(userHome, 'Library', 'LaunchAgents', `${LOGIN_ITEM_LABEL}.plist`);
}

const xml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`;

// The login item's text: at each log-in it sets the variables again, as `launchctl setenv` did.
export function loginItem(vars) {
  const script = Object.entries(vars).map(([k, v]) => `launchctl setenv ${k} ${shellQuote(v)}`).join('; ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LOGIN_ITEM_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    '    <string>/bin/sh</string>',
    '    <string>-c</string>',
    `    <string>${xml(script)}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

const psQuote = (text) => `'${String(text).replaceAll("'", "''")}'`;
const powershell = (run, script) => run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);

// A variable of the account's launch environment as read: { value } (null when it is not set), or
// { why } when it could not be read (launchctl or PowerShell failed), so a reader that must tell the
// two apart, such as uninstall's plan, can.
export async function launchVarState(name, { platform, run }) {
  const got = platform === 'win32'
    ? await powershell(run, `[Environment]::GetEnvironmentVariable(${psQuote(name)},'User')`)
    : await run('launchctl', ['getenv', name]);
  if (got?.code !== 0) return { why: `could not read ${name}${got?.stderr ? `: ${String(got.stderr).trim()}` : ''}` };
  const value = String(got?.stdout ?? '').replace(/\r?\n$/, '');
  return { value: value === '' ? null : value };
}

// A variable of the account's launch environment, or null when it is not set or could not be read.
export async function readLaunchVar(name, { platform, run }) {
  const got = await launchVarState(name, { platform, run });
  return got.why === undefined ? got.value : null;
}

async function setLaunchVar(name, value, { platform, run }) {
  const got = platform === 'win32'
    ? await powershell(run, `[Environment]::SetEnvironmentVariable(${psQuote(name)},${psQuote(value)},'User')`)
    : await run('launchctl', ['setenv', name, value]);
  if (got?.code !== 0) throw new Error(`${name} could not be set for this account${got?.stderr ? `: ${String(got.stderr).trim()}` : ''}`);
}

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A file's text, or null when there is none.
export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// The telemetry changes a plan lists, by `route`: { changes, kept }. `changes` sets each of the
// four not already set to Wheelhouse's value; `kept` names the director's own values, and while
// there is one, `changes` is empty. `userSettings` is the user's Claude settings as read, `file`
// where they are; `run` reads the launch environment (it changes nothing); `environment` is the
// environment setup runs in. Each change carries `what: 'telemetry'`, which step 6's card groups by.
export async function telemetryChanges({ port, route, platform, run, userSettings, file, userHome, environment = process.env }) {
  if (!TELEMETRY_ROUTES.includes(route)) throw new Error(`The telemetry route is one of ${TELEMETRY_ROUTES.join(', ')}, not ${JSON.stringify(route)}`);
  const vars = contentFree(telemetryEnv(port));
  const env = userSettings?.env;
  if (route === 'user-settings' && env !== undefined && !isObject(env)) throw new Error(`${file} holds env that is not an object, so setup has left it as it was`);
  const changes = [];
  const kept = [];
  for (const [name, value] of Object.entries(vars)) {
    const launch = await readLaunchVar(name, { platform, run });
    const shell = typeof environment?.[name] === 'string' && environment[name] !== '' ? environment[name] : null;
    const setting = route === 'user-settings' && env?.[name] !== undefined ? env[name] : null;
    const theirs = [setting, launch, shell].find((v) => v !== null && v !== value);
    if (theirs !== undefined) kept.push({ name, value: theirs });
    else if (route === 'user-settings' && setting === null) changes.push({ kind: 'json-key', target: file, key: ['env', name], after: value, what: 'telemetry' });
    else if (route === 'launch-env' && launch === null) changes.push({ kind: 'env', target: name, after: value, what: 'telemetry' });
  }
  if (route === 'launch-env' && platform === 'darwin' && kept.length === 0) {
    const item = loginItemFile(userHome);
    const text = loginItem(vars);
    if (readText(item) !== text) changes.push({ kind: 'file', target: item, after: text, what: 'telemetry' });
  }
  return { changes: kept.length > 0 ? [] : changes, kept };
}

// Makes the telemetry changes a plan listed (`changes`, from telemetryChanges, which it works out
// when not given), each recorded with its value before as it is made: a JSON key through the step's
// `applyJsonKey`; a variable or the login item through `record`, just before it is set or written.
// Gives back the changes made.
export async function telemetryOn({ port, route, platform, run, userSettings, file, userHome, applyJsonKey, record, changes }) {
  const list = changes ?? (await telemetryChanges({ port, route, platform, run, userSettings, file, userHome })).changes;
  const made = [];
  for (const c of list) {
    if (c.kind === 'json-key') {
      made.push(applyJsonKey({ file: c.target, key: c.key, value: c.after }));
    } else if (c.kind === 'env') {
      contentFree({ [c.target]: c.after });
      const before = await readLaunchVar(c.target, { platform, run });
      if (before !== null && before !== c.after) throw new Error(`${c.target} now holds a value of your own, so setup has left it as it was: ask for this step's plan again`);
      const change = { id: newId('chg'), kind: 'env', target: c.target, before, after: c.after, where: platform === 'win32' ? 'user' : 'launchctl' };
      record(change);
      await setLaunchVar(c.target, c.after, { platform, run });
      made.push(change);
    } else if (c.kind === 'file') {
      const change = { id: newId('chg'), kind: 'file', target: c.target, before: readText(c.target), after: c.after };
      record(change);
      fs.mkdirSync(path.dirname(c.target), { recursive: true });
      fs.writeFileSync(c.target, c.after);
      made.push(change);
    } else {
      throw new Error(`A telemetry change of kind ${c.kind} is not one setup makes`);
    }
  }
  return made;
}
