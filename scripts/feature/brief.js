// scripts/feature/brief.js
// The brief the foreman writes into a feature session's worktree: a JSON block of
// the brief's fields, then Markdown text that begins with the Wheelhouse override,
// whole, so it is read before any lane text and before any skill.
// The text is filled from templates/brief/ (brief.md, override.md and one file
// per lane). This file only builds text: it writes no file and records no hash;
// the foreman does both.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_DIR, parseBrief } from './files.js';
import { FIX_ROUNDS, REPORT_WORDS } from '../lib/build-loop.js';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'brief');

// A template's text with line endings evened to LF and its path comment taken off.
function template(...parts) {
  const text = fs.readFileSync(path.join(TEMPLATES, ...parts), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  return text.replace(/^<!--[^\n]*-->\n(?:\n)?/, '');
}

// Fills each {{name}} from `values` in one pass, so text that is put in is never filled again.
function fill(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`The brief template has a placeholder with no value: ${name}`);
    return values[name];
  });
}

// --- /implement's five lines ---

const IMPLEMENT_BLOCK = /<!-- implement:begin -->\n([\s\S]*?)\n<!-- implement:end -->\n?/;
const evenLines = (text) => String(text).replace(/\r\n?/g, '\n').trim();

// The five lines of Matt Pocock's /implement, as the quick lane's template carries them.
export function implementLines() {
  const match = IMPLEMENT_BLOCK.exec(template('lanes', 'quick.md'));
  if (!match) throw new Error("The quick lane's template has no /implement lines");
  return evenLines(match[1]);
}

// --- Rendering ---

const ROLES = Object.freeze([
  ['builder', 'wheelhouse:builder', 'builds each task'],
  ['mechanical', 'wheelhouse:builder', 'builds a mechanical task'],
  ['reviewer', 'wheelhouse:reviewer', 'reviews each task and the whole branch'],
  ['reviewerCritical', 'wheelhouse:reviewer', 'reviews work in a critical area'],
  ['tester', 'wheelhouse:tester', 'tries the product against the done contract'],
]);

function modelLines(routing) {
  return ROLES.map(([role, agent, job]) => {
    const model = Object.hasOwn(routing, role) && typeof routing[role] === 'string' && routing[role] !== '' ? routing[role] : null;
    return `- ${role} (\`${agent}\`, ${job}): ${model ?? "the session's own default"}`;
  }).join('\n');
}

const numbered = (items) => (items.length === 0 ? 'Nothing is listed.' : items.map((item, i) => `${i + 1}. ${item}`).join('\n'));

function appetiteLine({ sessions, tokens }) {
  return `${sessions} ${sessions === 1 ? 'session' : 'sessions'} and ${tokens} tokens at most. If the work will not fit, stop and report \`partial\` with what is done.`;
}

// The brief's text for `fields`: its JSON block, then the override, the goal and
// done contract, the appetite, the rulings, the lane's loop, how to ask, how to
// finish and the models by role. `pluginRoot` is put into the commands the brief
// names, so the session can run them as written. `implementText`, when given, is
// the installed /implement skill's text after its front matter; it must hold the
// same five lines as the quick lane's template, or this throws.
export function renderBrief({ fields, pluginRoot, implementText } = {}) {
  if (typeof pluginRoot !== 'string' || pluginRoot === '' || /["\r\n\0]/.test(pluginRoot)) {
    throw new Error("The plugin root can't be put into the brief");
  }
  const block = `\`\`\`json\n${JSON.stringify(fields, null, 2)}\n\`\`\`\n`;
  const { fields: f } = parseBrief(block);

  const lines = implementLines();
  if (implementText !== undefined && evenLines(implementText) !== lines) {
    throw new Error("The installed /implement text differs from the five lines the quick lane carries");
  }

  const cli = `node "${path.join(pluginRoot, 'scripts', 'feature', 'cli.js')}"`;
  const shared = { cli, featureDir: FEATURE_DIR, fixRounds: String(FIX_ROUNDS), reportWords: String(REPORT_WORDS), work: f.work, lane: f.lane, implementLines: lines };
  const laneText = fill(template('lanes', `${f.lane}.md`).replace(IMPLEMENT_BLOCK, `${lines}\n`), shared).trim();

  const text = fill(template('brief.md'), {
    ...shared,
    override: template('override.md').trim(),
    planLine: f.plan === undefined ? '' : `\nThe plan is at \`${f.plan}\`; use it rather than writing another.\n`,
    slicesLine: f.slices === undefined ? '' : `\nThis feature has ${f.slices} ${f.slices === 1 ? 'slice' : 'slices'}, each its own plan and its own pull request.\n`,
    shownFirstLine: f.shownFirst
      ? '\nThis change is marked shown first: the director sees it before it ships. Do not alter what users see beyond the goal and the done contract; if you must, ask at decision level 3.\n'
      : '',
    goal: f.goal,
    done: numbered(f.done),
    appetite: appetiteLine(f.appetite),
    rulings: f.rulings.length === 0 ? 'No rulings apply yet.' : f.rulings.map((r) => `- ${r.id}: ${r.words}`).join('\n'),
    laneText,
    models: modelLines(f.routing),
  });
  return `${block}\n${text}`;
}

// --- Amending ---

const MONTHS = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

function dayMonthYear(now) {
  const when = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(when.getTime())) throw new Error('The time given is not a time');
  return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`;
}

// The brief `text` with its version one higher and a "What changed" section at
// the top of the text after the JSON block. A section from an earlier amendment
// is kept, with the latest line first. Returns text only; the caller writes it and
// records its hash. Throws if `text` is not a brief.
export function amendBrief(text, { change, now } = {}) {
  const { fields, body } = parseBrief(text);
  const said = typeof change === 'string' ? change.replace(/\s*\r?\n\s*/g, ' ').trim() : '';
  if (said === '') throw new Error('The change must say what changed');
  const date = dayMonthYear(now);
  const version = fields.version + 1;

  let rest = body.replace(/^\s+/, '');
  let earlier = '';
  const section = /^# What changed\r?\n([\s\S]*?)(?=\r?\n# |$)/.exec(rest);
  if (section) {
    earlier = section[1].trim();
    rest = rest.slice(section[0].length).replace(/^\s+/, '');
  }
  const entries = [`- ${date} (version ${version}): ${said}`, ...(earlier === '' ? [] : [earlier])].join('\n');
  const block = `\`\`\`json\n${JSON.stringify({ ...fields, version }, null, 2)}\n\`\`\`\n`;
  return `${block}\n# What changed\n\n${entries}\n${rest === '' ? '' : `\n${rest}`}`;
}
