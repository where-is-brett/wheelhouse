// scripts/setup/computer.js
// Step 6, the changes to this computer, and step 8, Locked (design section 15).
//
// Step 6 lists on one card every change it makes to this computer, each in plain words, and makes
// them on one click. Each is a key in the user's Claude settings (CLAUDE_CONFIG_DIR/settings.json,
// else ~/.claude/settings.json), written by key through ctx.applyJsonKey, so the journal holds its
// value before and uninstall puts it back, and every other key of the director's stays as it was:
// - telemetry on this computer only (scripts/setup/telemetry.js, by TELEMETRY_ROUTE; the
//   launch-environment route sets variables and a login item instead, and asks for a Desktop restart);
// - transcripts kept RETENTION_DAYS days (`cleanupPeriodDays`), even over a longer one of the
//   director's, with the card saying that older ones are removed for good (ruling R64);
// - Claude Code on its stable channel at or above the manifest's floor (claudeCodeSettings, in the
//   user settings, as check 28 says), never lowering a minimum of the director's own at or above
//   the floor. Wheelhouse itself never updating on its own is a line on the
//   card: its marketplace entry's `autoUpdate: false` is in the project's settings, step 7's;
// - phone notifications (`agentPushNotifEnabled: true`, check 4).
// It also names, without changing it, this computer's signing key (made when setup started, Task
// 6), and each of the director's own settings that weakens Standard (`weakening`), so the director
// decides; a later card can switch one off. With every setting already as Wheelhouse needs (a
// computer set up for another project), the step settles with nothing to do, with no Go ahead
// (ruling R75), and names any of the director's settings that weaken Standard in a line the
// session's status shows (ctx.say, ruling R101).
//
// Step 8 installs Locked (scripts/protection/locked.js), with the system's own password prompt,
// only when the director chose Locked (step 3's answer, ruling R37), only on a Mac, and only once
// the narrow connection (step 3) and the project's settings (step 7) are in place (`after`). A
// change installLocked would refuse (another managed policy, or a computer-wide settings file not
// Wheelhouse's) is refused at the plan, so no card offers it. Its
// change is recorded as a `locked` change before the administrator step; leaving Locked asks for
// the password again, so putting it back is uninstall's own (Task 15, ruling R13). Otherwise the
// step settles with nothing to do (ruling R32). The answer and what step 3 made must agree: the
// project record's connection is marked Locked exactly when the answer is Locked, or the step is
// refused, naming both, so the record and the computer never disagree (ruling R70).
//
// On a computer joining a project set up on another (ruling R77), step 3 asks no Locked question,
// so step 8 asks it itself (`locked`, step 3's words), on a Mac, when the project's state says it
// is launched (its `phase` setting); otherwise it settles as not Locked. A Locked answer installs
// Locked as above, and then marks the project record's connection Locked, recorded first, so the
// record and the computer agree here too.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { run as realRun } from '../lib/run.js';
import { RETENTION_DAYS, TELEMETRY_ROUTE } from '../lib/setup-numbers.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { composeCard } from '../cards/compose.js';
import { CARD } from '../lib/front-desk.js';
import { ownKey } from '../state/signing.js';
import { projectForFolder, writeProject } from '../lib/projects.js';
import { stateDir } from '../lib/paths.js';
import { joinedRepo } from '../lib/setup-run.js';
import { claudeCodeSettings } from '../protection/settings.js';
import { installLocked, ownFile, MAC_ONLY, NEEDS_NARROW, HAS_MDM, NOT_OURS, MDM_PLIST } from '../protection/locked.js';
import { managedDir, lockedProjects } from '../protection/managed.js';
import { MARKETPLACE, UPSTREAMS, readManifest } from '../lineage/manifest.js';
import { receiverPort } from '../telemetry/main.js';
import { telemetryChanges, telemetryOn, isObject, readText } from './telemetry.js';
import { LEVELS, launchedIn, lockedAsk } from './host.js';
import { newId, SAY_CHARS, readJournal } from './journal.js';

// ---- Step 6 ----

// The user's Claude settings file: CLAUDE_CONFIG_DIR's when it is set, else the home's.
export function userSettingsFile({ userHome = os.homedir(), env = process.env } = {}) {
  const config = typeof env.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR !== '' ? env.CLAUDE_CONFIG_DIR : path.join(userHome, '.claude');
  return path.join(config, 'settings.json');
}

// The settings in a file as an object: {} when there is none. Anything that is not a JSON object
// stops the step, naming the file, which is left as it was.
export function readSettings(file) {
  const text = readText(file);
  if (text === null) return {};
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
      if (on === true && !OWN_PLUGINS.has(name)) found.push({ key: 'enabledPlugins', value: name, says: `the plugin ${name} is on, and runs its own code` });
    }
  }
  if (isObject(settings?.extraKnownMarketplaces)) {
    for (const name of Object.keys(settings.extraKnownMarketplaces)) {
      if (name !== MARKETPLACE) found.push({ key: 'extraKnownMarketplaces', value: name, says: `the marketplace ${name} is added, so its plugins can be installed` });
    }
  }
  return found;
}

// A version such as 2.1.100 as numbers, or null when it is not one.
const versionOf = (v) => (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);

// The director's own minimum version, when it is a version at or above the floor; else null.
// Setup never lowers it: with the stable channel, the minimum is what keeps a newer Claude Code
// from being taken back down (check 28).
export function ownMinimum(userSettings, floor) {
  const own = versionOf(userSettings?.minimumVersion);
  const least = versionOf(floor);
  if (own === null || least === null) return null;
  const i = own.findIndex((n, j) => n !== least[j]);
  return i === -1 || own[i] > least[i] ? userSettings.minimumVersion : null;
}

// The list of changes step 6 makes: the telemetry changes (from telemetryChanges), then each of
// setup's keys in the user settings that does not already hold setup's value, except a minimum
// version of the director's own at or above the floor, which is kept. `file` is the user settings
// file, `userSettings` what it holds, `manifest` Wheelhouse's (its Claude Code floor).
export function computerChanges({ userSettings, manifest, file, telemetry = [] }) {
  const floor = manifest?.claudeCode?.floor;
  const keep = ownMinimum(userSettings, floor) !== null;
  const keys = [
    [['cleanupPeriodDays'], RETENTION_DAYS, 'retention'],
    ...Object.entries(claudeCodeSettings({ floor })).filter(([k]) => !(keep && k === 'minimumVersion')).map(([k, v]) => [[k], v, 'updates']),
    [['agentPushNotifEnabled'], true, 'push'],
  ];
  return [
    ...telemetry,
    ...keys.filter(([key, value]) => userSettings?.[key[0]] !== value).map(([key, after, what]) => ({ kind: 'json-key', target: file, key, after, what })),
  ];
}

const RESTART = 'then quit and reopen Claude Desktop';

// " (now <value>)" for a value of the director's that setup changes; nothing when there was none.
const shown = (now) => (now === undefined ? '' : ` (now ${typeof now === 'number' || versionOf(now) !== null ? now : JSON.stringify(now)})`);

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
  // Ruling R64: the limit holds even over a longer one of the director's, and the card says what it costs.
  if (has('retention')) {
    out.push(`transcripts kept ${RETENTION_DAYS} days${shown(userSettings.cleanupPeriodDays)}; older ones are removed, and uninstall can't bring them back`);
  }
  if (has('updates')) {
    const own = ownMinimum(userSettings, floor);
    const minimum = own !== null ? `${own} or later (your own minimum, kept)`
      : `${floor} or later${changes.some((c) => c.key?.[0] === 'minimumVersion') ? shown(userSettings.minimumVersion) : ''}`;
    out.push(`Claude Code on its stable channel at version ${minimum}`);
  }
  if (has('push')) out.push('phone notifications on');
  return out;
}

// The card's sentence for the director's settings that weaken Standard, as long as `fit` allows:
// each with what it does; else each by name; else as many names as fit, and how many more.
function weakeningSentence(found, fit) {
  if (found.length === 0) return '';
  const lead = 'Your own settings that weaken Standard, left as they are for you to decide:';
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
// Only a list with something on it has a card: an empty one settles the step (ruling R75).
export function computerCard({ changes, userSettings = {}, kept = [], route = TELEMETRY_ROUTE, platform = process.platform, floor, key = ownKey() }) {
  const listed = lines({ changes, userSettings, kept, route, platform, floor });
  const head = `Setup step 6, ${SETUP_TITLES[6]}: ${listed.join('; ')}. Wheelhouse never updates itself.`;
  // Named without its id, which a card would read as a commit.
  const signing = key ? ' This computer\'s key for signing your clicks is already made.' : '';
  const variables = route === 'launch-env' && changes.some((c) => c.kind === 'env' || c.kind === 'file');
  const why = variables
    ? `These are Claude Code's own settings, and variables for your account${platform === 'darwin' ? ' and a login item' : ''}, on this computer.`
    : 'These are Claude Code\'s own settings on this computer.';
  const card = (what) => ({
    kind: 'setup',
    level: 3,
    what,
    why,
    options: [
      { label: SETUP_LABEL, says: 'Setup changes these settings only.' },
      { label: 'Not now', says: 'Nothing changes.' },
    ],
    recommend: SETUP_LABEL,
    because: changes.some((c) => c.what === 'retention') ? 'uninstall puts each setting back, but not removed transcripts' : 'uninstall puts each back',
    meanwhile: 'Setup waits; nothing changes.',
  });
  // Whether a card with this sentence fits the composer's limit (CARD.chars): the card without it,
  // as composed, and the sentence, which the card's text holds once, as `what` does.
  const base = composeCard({ ...card(`${head}${signing}`), target: { step: 6, hash: '0'.repeat(64) } }).question.question.length;
  const fit = (sentence) => base + 1 + sentence.length <= CARD.chars;
  const weak = weakeningSentence(weakening(userSettings), fit);
  return card(`${head}${signing}${weak === '' ? '' : ` ${weak}`}`);
}

// What step 6 says when it settles with nothing to change, before the settings that weaken Standard.
export const SETTLED_LEAD = `Setup step 6, ${SETUP_TITLES[6]}: every setting is already as Wheelhouse needs.`;

// Step 6. `run` reads (and on the launch-environment route sets) the account's launch environment;
// `env` is the environment setup runs in (CLAUDE_CONFIG_DIR, and any telemetry variable of the
// director's own); `route`, `port` and `manifest` are for tests, read when the plan is.
export function computerStep({ run = realRun, env = process.env, route = TELEMETRY_ROUTE, port, manifest } = {}) {
  const world = async (ctx) => {
    const platform = ctx.platform ?? process.platform;
    const userHome = ctx.userHome ?? os.homedir();
    const file = userSettingsFile({ userHome, env });
    const userSettings = readSettings(file);
    const floor = (manifest ?? readManifest()).claudeCode?.floor;
    const telemetry = await telemetryChanges({ port: port ?? receiverPort(), route, platform, run, userSettings, file, userHome, environment: env });
    const changes = computerChanges({ userSettings, manifest: { claudeCode: { floor } }, file, telemetry: telemetry.changes });
    return { platform, userSettings, floor, kept: telemetry.kept, changes };
  };
  return {
    n: 6,
    title: SETUP_TITLES[6],
    async plan(ctx) {
      const { platform, userSettings, floor, kept, changes } = await world(ctx);
      // Every setting already as Wheelhouse needs settles the step, with no Go ahead (ruling R75).
      // The director's own settings that weaken Standard are still named, as a line status shows
      // (ruling R101); the signing key, no change, is not.
      if (changes.length === 0) {
        const weak = weakeningSentence(weakening(userSettings), (line) => `${SETTLED_LEAD} ${line}`.length <= SAY_CHARS);
        if (weak !== '') ctx.say?.(`${SETTLED_LEAD} ${weak}`);
        return { settled: { record: { nothing: true } } };
      }
      const card = computerCard({ changes, userSettings, kept, route, platform, floor });
      const restart = changes.some((c) => c.kind === 'env');
      return { changes, card, director: restart ? 'One click, then quit and reopen Claude Desktop' : 'One click' };
    },
    async apply(ctx, changes) {
      const platform = ctx.platform ?? process.platform;
      await telemetryOn({ changes: changes.filter((c) => c.what === 'telemetry'), platform, run, applyJsonKey: ctx.applyJsonKey, record: ctx.record });
      for (const c of changes.filter((x) => x.what !== 'telemetry')) ctx.applyJsonKey({ file: c.target, key: c.key, value: c.after });
      // The director's own settings that weaken Standard, said in one line as the step finishes,
      // since a Go ahead on the one card shows no step 6 card (design section 15.1).
      const weak = weakeningSentence(weakening((await world(ctx)).userSettings), (line) => line.length <= SAY_CHARS);
      if (weak !== '') ctx.say?.(weak);
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

// The project record's file, which a joining computer's Locked marks.
const projectFile = (project) => path.join(stateDir(project), '..', 'project.json');

// Step 8. `run`, `dir` (the managed settings folder), `mdmPlist`, `nodePath` and `address` are
// installLocked's, for tests.
export function lockedStep({ run = realRun, dir, mdmPlist, nodePath, address } = {}) {
  // Locked's list for the project, once a change installLocked would refuse is ruled out: a change
  // installLocked would refuse is never offered on a card. `mark`: the record is marked Locked too.
  const lockedList = (found, mark, platform) => {
    const where = dir ?? managedDir(platform);
    if (fs.existsSync(mdmPlist ?? MDM_PLIST)) throw new Error(HAS_MDM);
    if (!ownFile(where)) throw new Error(NOT_OURS);
    const target = path.join(where, 'managed-settings.json');
    const changes = [{ kind: 'locked', target, project: found.project, folder: found.record.folder, ...(mark ? { mark: true } : {}) }];
    return { changes, card: lockedCard(target, found.record.folder), director: 'Your password, in macOS\'s own window' };
  };
  const needsNarrow = (found) => {
    const mode = found.record.connection?.mode;
    if (mode !== 'narrow') {
      throw new Error(mode === 'quick'
        ? `${NEEDS_NARROW}, and this project has the Quick connection: run step 3 again with the narrow connection`
        : `${NEEDS_NARROW}, and this project has no connection yet: run step 3 first`);
    }
  };
  return {
    n: 8,
    title: SETUP_TITLES[8],
    long: true,
    after: [3, 7],
    async plan(ctx) {
      const platform = ctx.platform ?? process.platform;
      const run = typeof ctx.runId === 'string' ? readJournal().runs.find((r) => r?.id === ctx.runId) ?? null : null;
      // A computer joining a project asks Locked here, when the project is launched (ruling R77).
      if (joinedRepo(run) !== null) {
        if (platform === 'win32') return { settled: { record: { locked: false } } };
        const found = projectForFolder(ctx.folder);
        if (found === null) return { wait: PROJECT_WAIT_MS, why: `step 3 (${SETUP_TITLES[3]}) has not registered the project yet; Locked comes once it has` };
        if (!launchedIn(found.project)) return { settled: { record: { locked: false } } };
        const answered = ctx.answers?.['8.locked'] ?? null;
        if (answered === null) return { ask: lockedAsk(found.record.repo.split('/').at(-1)) };
        if (answered.label !== LEVELS.locked) return { settled: { record: { locked: false } } };
        needsNarrow(found);
        return lockedList(found, found.record.connection?.locked !== true, platform);
      }
      const answered = ctx.answers?.['3.locked'] ?? null;
      const chosen = answered?.label === LEVELS.locked;
      // Step 3 never offers Locked on Windows, so there is nothing to make or to agree with.
      if (platform === 'win32') return { settled: { record: chosen ? { locked: false, why: MAC_ONLY } : { locked: false } } };
      const found = projectForFolder(ctx.folder);
      if (found === null) return { wait: PROJECT_WAIT_MS, why: `step 3 (${SETUP_TITLES[3]}) has not registered the project yet; Locked comes once it has` };
      if (chosen) needsNarrow(found);
      // What step 3 made (its connection, marked Locked) and the latest answer must agree: an
      // answer given again on a card shown again after step 3 changes nothing step 3 connected.
      const connected = found.record.connection?.locked === true;
      if (connected !== chosen) {
        const said = answered === null ? 'its Locked question has no answer' : `the latest answer to its Locked question is ${answered.label ?? answered.text}`;
        throw new Error(`Step 3 connected this project ${connected ? 'for Locked' : 'without Locked'}, but ${said}, so step 8 has not gone on: the two must agree`);
      }
      if (!chosen) return { settled: { record: { locked: false } } };
      return lockedList(found, false, platform);
    },
    async apply(ctx, changes) {
      const platform = ctx.platform ?? process.platform;
      for (const c of changes.filter((x) => x.kind === 'locked')) {
        const where = path.dirname(c.target);
        // Whether a computer-wide settings file was there, and whether it was Wheelhouse's, so
        // uninstall (Task 15) never acts on a file that is not.
        const exists = fs.existsSync(c.target);
        ctx.record({
          id: newId('chg'),
          kind: 'locked',
          target: c.target,
          before: { exists, ours: exists && ownFile(where), projects: lockedProjects({ dir: where }) },
          after: { project: c.project, folder: c.folder },
        });
        const got = await installLocked({ project: c.project, platform, run, now: ctx.now, dir: where, mdmPlist, nodePath, address });
        if (!got.installed) throw new Error(got.line);
        // A joining computer's record, marked Locked once Locked is on, recorded first.
        if (c.mark) {
          const found = projectForFolder(c.folder);
          if (found === null || found.project !== c.project) throw new Error('the project is not registered on this computer; run step 3 first');
          const kept = { ...found.record, connection: { ...found.record.connection, locked: true } };
          const file = projectFile(c.project);
          ctx.record({ id: newId('chg'), kind: 'file', target: file, before: readText(file), after: `${JSON.stringify(kept, null, 2)}\n` });
          writeProject(c.project, kept);
        }
      }
      return [];
    },
  };
}
