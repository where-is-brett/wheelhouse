// scripts/setup/computer.js
// Step 6, the changes to this computer, and step 8, Locked (design section 15).
//
// Step 6 lists on one card every change it makes to this computer, each in plain words, and makes
// them on one click. Each is a key in the user's Claude settings (CLAUDE_CONFIG_DIR/settings.json,
// else ~/.claude/settings.json), written by key through ctx.applyJsonKey, so the journal holds its
// value before and uninstall puts it back, and every other key of the director's stays as it was:
// - telemetry on this computer only (scripts/setup/telemetry.js, by TELEMETRY_ROUTE; the
//   launch-environment route sets variables and a login item instead, and asks for a Desktop restart);
// - transcripts kept RETENTION_DAYS days (`cleanupPeriodDays`);
// - Claude Code on its stable channel at or above the manifest's floor (claudeCodeSettings, in the
//   user settings, as check 28 says). Wheelhouse itself never updating on its own is a line on the
//   card: its marketplace entry's `autoUpdate: false` is in the project's settings, step 7's;
// - phone notifications (`agentPushNotifEnabled: true`, check 4).
// It also names, without changing it, this computer's signing key (made when setup started, Task
// 6), and each of the director's own settings that weakens Standard (`weakening`), so the director
// decides; a later card can switch one off.
//
// Step 8 installs Locked (scripts/protection/locked.js), with the system's own password prompt,
// only when the director chose Locked (step 3's answer, ruling R37), only on a Mac, and only once
// the narrow connection (step 3) and the project's settings (step 7) are in place (`after`). Its
// change is recorded as a `locked` change before the administrator step; leaving Locked asks for
// the password again, so putting it back is uninstall's own (Task 15, ruling R13). Otherwise the
// step settles with nothing to do (ruling R32).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { run as realRun } from '../lib/run.js';
import { RETENTION_DAYS, TELEMETRY_ROUTE } from '../lib/setup-numbers.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { composeCard } from '../cards/compose.js';
import { ownKey } from '../state/signing.js';
import { projectForFolder } from '../lib/projects.js';
import { claudeCodeSettings } from '../protection/settings.js';
import { installLocked, MAC_ONLY, NEEDS_NARROW } from '../protection/locked.js';
import { managedDir, lockedProjects } from '../protection/managed.js';
import { MARKETPLACE, UPSTREAMS, readManifest } from '../lineage/manifest.js';
import { receiverPort } from '../telemetry/main.js';
import { telemetryChanges, telemetryOn } from './telemetry.js';
import { LEVELS } from './host.js';
import { newId } from './journal.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- Step 6 ----

// The user's Claude settings file: CLAUDE_CONFIG_DIR's when it is set, else the home's.
export function userSettingsFile({ userHome = os.homedir(), env = process.env } = {}) {
  const config = typeof env.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR !== '' ? env.CLAUDE_CONFIG_DIR : path.join(userHome, '.claude');
  return path.join(config, 'settings.json');
}

// The settings in a file as an object: {} when there is none. Anything that is not a JSON object
// stops the step, naming the file, which is left as it was.
export function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  let data = null;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch { /* named below */ }
  if (!isObject(data)) throw new Error(`${file} is not a JSON object, so setup has left it as it was`);
  return data;
}

// Wheelhouse's own plugins and marketplace, which never count as weakening Standard.
const OWN_PLUGINS = new Set([`wheelhouse@${MARKETPLACE}`, ...UPSTREAMS.map((u) => `${u.plugin}@${MARKETPLACE}`)]);

// Each of the director's own settings that weakens Standard (design sections 12.1 and 12.9), with
// what it does: { key, value, says }. A command let out of the sandbox; a plugin switched on that
// is not Wheelhouse's or one of its pins; a marketplace that is not Wheelhouse's. Setup changes none.
export function weakening(settings) {
  const found = [];
  const excluded = settings?.sandbox?.excludedCommands;
  if (Array.isArray(excluded)) {
    for (const command of excluded) {
      if (typeof command === 'string' && command.trim() !== '') {
        found.push({ key: 'sandbox.excludedCommands', value: command, says: `${command} runs outside the sandbox` });
      }
    }
  }
  if (isObject(settings?.enabledPlugins)) {
    for (const [name, on] of Object.entries(settings.enabledPlugins)) {
      if (on === true && !OWN_PLUGINS.has(name)) found.push({ key: 'enabledPlugins', value: name, says: `the plugin ${name} is on, and runs its own code in your sessions` });
    }
  }
  if (isObject(settings?.extraKnownMarketplaces)) {
    for (const name of Object.keys(settings.extraKnownMarketplaces)) {
      if (name !== MARKETPLACE) found.push({ key: 'extraKnownMarketplaces', value: name, says: `the plugin marketplace ${name} is added, so its plugins can be installed` });
    }
  }
  return found;
}

// The list of changes step 6 makes: the telemetry changes (from telemetryChanges), then each of
// setup's keys in the user settings that does not already hold setup's value. `file` is the user
// settings file, `userSettings` what it holds, `manifest` Wheelhouse's (its Claude Code floor).
export function computerChanges({ userSettings, manifest, file, telemetry = [] }) {
  const keys = [
    [['cleanupPeriodDays'], RETENTION_DAYS, 'retention'],
    ...Object.entries(claudeCodeSettings({ floor: manifest?.claudeCode?.floor })).map(([k, v]) => [[k], v, 'updates']),
    [['agentPushNotifEnabled'], true, 'push'],
  ];
  return [
    ...telemetry,
    ...keys.filter(([key, value]) => userSettings?.[key[0]] !== value).map(([key, after, what]) => ({ kind: 'json-key', target: file, key, after, what })),
  ];
}

const RESTART = 'then quit and reopen Claude Desktop';

// The card's line for each kind of change, in plain words.
function lines({ changes, userSettings, kept, route, platform, floor }) {
  const out = [];
  const has = (what) => changes.some((c) => c.what === what);
  if (kept.length > 0) {
    out.push(`telemetry left as you set it (${kept.map((k) => k.name).join(', ')} ${kept.length === 1 ? 'is' : 'are'} yours), so the board counts no tokens here`);
  } else if (has('telemetry')) {
    const where = route === 'launch-env'
      ? `4 variables for your account${platform === 'darwin' ? ', set again by a login item at log-in' : ''}; ${RESTART}`
      : '4 keys in your Claude settings';
    out.push(`usage counts to Wheelhouse on this computer only, never your prompts or tool content (${where})`);
  }
  if (has('retention')) {
    const now = userSettings.cleanupPeriodDays;
    out.push(`transcripts kept ${RETENTION_DAYS} days${now === undefined ? '' : ` (now ${typeof now === 'number' ? now : JSON.stringify(now)})`}`);
  }
  if (has('updates')) out.push(`Claude Code on its stable channel at version ${floor} or later`);
  if (has('push')) out.push('phone notifications on');
  return out;
}

// The card's sentence for the director's settings that weaken Standard, as long as `fit` allows:
// each with what it does; else each by name; else as many names as fit, and how many more.
function weakeningSentence(found, fit) {
  if (found.length === 0) return '';
  const lead = 'Your own settings that weaken Standard, which setup leaves as they are for you to decide:';
  const full = `${lead} ${found.map((w) => w.says).join('; ')}.`;
  if (fit(full)) return full;
  const names = `${lead} ${found.map((w) => w.value).join(', ')}.`;
  if (fit(names)) return names;
  for (let n = found.length - 1; n >= 1; n -= 1) {
    const some = `${lead} ${found.slice(0, n).map((w) => w.value).join(', ')}, and ${found.length - n} more.`;
    if (fit(some)) return some;
  }
  return `${lead} ${found.length} of them.`;
}

// Step 6's card: each change in plain words, the signing key, and the settings that weaken Standard.
export function computerCard({ changes, userSettings = {}, kept = [], route = TELEMETRY_ROUTE, platform = process.platform, floor, key = ownKey() }) {
  const listed = lines({ changes, userSettings, kept, route, platform, floor });
  const head = `Setup step 6, ${SETUP_TITLES[6]}: ${listed.length > 0 ? `${listed.join('; ')}.` : 'every setting is already as Wheelhouse needs, so nothing changes.'} Wheelhouse itself never updates on its own.`;
  // Named without its id, which a card would read as a commit.
  const signing = key ? ' This computer\'s signing key, which signs your clicks, is already made.' : '';
  const card = (what) => ({
    kind: 'setup',
    level: 3,
    what,
    why: 'These are Claude Code\'s own settings on this computer.',
    options: [
      { label: SETUP_LABEL, says: changes.length === 0 ? 'Setup marks this step done.' : 'Setup changes these settings only.' },
      { label: 'Not now', says: 'Nothing changes.' },
    ],
    recommend: SETUP_LABEL,
    because: changes.length === 0 ? 'nothing changes' : 'uninstall puts each back',
    meanwhile: 'Setup waits; nothing changes.',
  });
  // Whether a card with this sentence fits the composer's limit, measured on the card as composed.
  // Any other fault of the card is thrown as it is.
  const fit = (sentence) => {
    try {
      composeCard({ ...card(`${head}${signing} ${sentence}`), target: { step: 6, hash: '0'.repeat(64) } });
      return true;
    } catch (error) {
      if (/would pass \d+ characters/.test(error?.message ?? '')) return false;
      throw error;
    }
  };
  const weak = weakeningSentence(weakening(userSettings), fit);
  return card(`${head}${signing}${weak === '' ? '' : ` ${weak}`}`);
}

// Step 6. `run` reads (and on the launch-environment route sets) the account's launch environment;
// `env` gives CLAUDE_CONFIG_DIR; `route`, `port` and `manifest` are for tests, read when the plan is.
export function computerStep({ run = realRun, env = process.env, route = TELEMETRY_ROUTE, port, manifest } = {}) {
  const world = async (ctx) => {
    const platform = ctx.platform ?? process.platform;
    const userHome = ctx.userHome ?? os.homedir();
    const file = userSettingsFile({ userHome, env });
    const userSettings = readSettings(file);
    const floor = (manifest ?? readManifest()).claudeCode?.floor;
    const telemetry = await telemetryChanges({ port: port ?? receiverPort(), route, platform, run, userSettings, file, userHome });
    const changes = computerChanges({ userSettings, manifest: { claudeCode: { floor } }, file, telemetry: telemetry.changes });
    return { platform, userSettings, floor, kept: telemetry.kept, changes };
  };
  return {
    n: 6,
    title: SETUP_TITLES[6],
    async plan(ctx) {
      const { platform, userSettings, floor, kept, changes } = await world(ctx);
      const card = computerCard({ changes, userSettings, kept, route, platform, floor });
      const restart = changes.some((c) => c.kind === 'env');
      return { changes, card, director: restart ? 'One click, then quit and reopen Claude Desktop' : 'One click' };
    },
    async apply(ctx, changes) {
      const platform = ctx.platform ?? process.platform;
      await telemetryOn({ changes: changes.filter((c) => c.what === 'telemetry'), platform, run, applyJsonKey: ctx.applyJsonKey, record: ctx.record });
      for (const c of changes.filter((x) => x.what !== 'telemetry')) ctx.applyJsonKey({ file: c.target, key: c.key, value: c.after });
      return [];
    },
  };
}

// ---- Step 8 ----

// How long step 8 waits for step 3 to register the project, when it is asked before.
export const PROJECT_WAIT_MS = 30 * 1000;

function lockedCard(target, folder) {
  return {
    kind: 'setup',
    level: 3,
    what: `Setup step 8, ${SETUP_TITLES[8]}: Wheelhouse's checks go into this computer's administrator-only settings file, ${target}, with this project, ${folder}, on its Locked list. macOS asks for your password once, in its own window.`,
    why: 'Only an administrator can change that file, so no agent can switch Wheelhouse\'s checks off.',
    options: [
      { label: SETUP_LABEL, says: 'macOS asks for your password, then Locked is on for this project.' },
      { label: 'Not now', says: 'Setup waits at this step; nothing changes.' },
    ],
    recommend: SETUP_LABEL,
    because: 'you chose Locked for this project',
    meanwhile: 'Setup waits at this step; nothing changes.',
  };
}

// Step 8. `run`, `dir` (the managed settings folder), `mdmPlist`, `nodePath` and `address` are
// installLocked's, for tests.
export function lockedStep({ run = realRun, dir, mdmPlist, nodePath, address } = {}) {
  return {
    n: 8,
    title: SETUP_TITLES[8],
    long: true,
    after: [3, 7],
    async plan(ctx) {
      const platform = ctx.platform ?? process.platform;
      if (ctx.answers?.['3.locked']?.label !== LEVELS.locked) return { settled: { record: { locked: false } } };
      if (platform === 'win32') return { settled: { record: { locked: false, why: MAC_ONLY } } };
      const found = projectForFolder(ctx.folder);
      if (found === null) return { wait: PROJECT_WAIT_MS, why: `step 3 (${SETUP_TITLES[3]}) has not registered the project yet; Locked comes once it has` };
      if (found.record.connection?.mode !== 'narrow') throw new Error(`${NEEDS_NARROW}, and this project has the Quick connection: run step 3 again with the narrow connection`);
      const target = path.join(dir ?? managedDir(platform), 'managed-settings.json');
      const changes = [{ kind: 'locked', target, project: found.project, folder: found.record.folder }];
      return { changes, card: lockedCard(target, found.record.folder), director: 'Your password, in macOS\'s own window' };
    },
    async apply(ctx, changes) {
      const platform = ctx.platform ?? process.platform;
      for (const c of changes.filter((x) => x.kind === 'locked')) {
        const where = path.dirname(c.target);
        ctx.record({
          id: newId('chg'),
          kind: 'locked',
          target: c.target,
          before: { inPlace: fs.existsSync(c.target), projects: lockedProjects({ dir: where }) },
          after: { project: c.project, folder: c.folder },
        });
        const got = await installLocked({ project: c.project, platform, run, now: ctx.now, dir: where, mdmPlist, nodePath, address });
        if (!got.installed) throw new Error(got.line);
      }
      return [];
    },
  };
}
