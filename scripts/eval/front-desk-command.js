// scripts/eval/front-desk-command.js
// A stand-in for the front desk's command, for evaluation runs only. The
// front desk plan's `scripts/frontdesk/cli.js` is not built yet; this answers
// the part of it the build loop's intake needs (skills/intake/SKILL.md): the
// duplicate check, the views it is run over, and recording the intake's plain
// events, each through the helper as the real command will (`/state/views`
// and `/state/write`), which in an evaluation is the stand-in helper. It adds
// `hash`, which the planned command does not list: the hash a work event's
// document or an amendment names. It composes no cards; the front desk writes
// a card's line itself, from scripts/state/card-lines.js. A scenario's scratch
// plugin holds a two-line `scripts/frontdesk/cli.js` that runs `main` here.
// Never used by the product, and not run by `npm test` except in its unit test.
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { similar } from '../intake/similar.js';
import { endedBy } from '../foreman/queue.js';
import { makeEvent } from '../state/events.js';
import { briefHash } from '../feature/files.js';

// The kinds the front desk records, as the front desk plan's `record` lists them, with the
// intake's `note` (an incident's no-blame note).
export const RECORD_KINDS = [
  'work', 'amendment', 'incident', 'idea', 'rejection', 'ruling', 'note',
  'glossary', 'decision', 'risk', 'blocker',
];

export const USAGE = `Usage: node cli.js <command>
  similar <request>          the intake's duplicate check: open work, ideas and rejections that share words with it
  views [work|ideas|rejections|questions]
                             what the project's state holds, as short lines
  record <kind> <data>       records a plain event; <data> is its JSON (or give it on standard input)
  hash <file>                the hash a work event's doc, or an amendment, names for a document

What a record carries:
  work       { "id": "<short-slug>", "title": "…", "lane": "quick" | "small" | "feature" | "bug",
               "visible": true | false, "dependsOn": [], "doc": { "path": "<file>", "hash": "<hash>" },
               "place": <number, optional> }
  amendment  { "work": "<work id>", "change": "…", "hash": "<hash of the changed document>" }
  incident   { "id": "<short-slug>", "what": "…" }
  idea       { "key": "<short-slug>", "title": "…", "lane": "…", "when": "now" | "next" | "later", … }
  ruling     { "words": "<the director's own words>", … }
  rejection, note, glossary, decision, risk, blocker: an object of your own fields
`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// A time as a day, month and year: 30 September 2026.
const dayOf = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? String(at) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const short = (hash) => (typeof hash === 'string' ? hash.slice(0, 12) : '');
const titleOf = (data, fallback) => [data?.title, data?.text, data?.what, data?.words].find((x) => typeof x === 'string' && x !== '') ?? fallback;

function workLines(views) {
  const lines = [];
  for (const [id, entry] of Object.entries(views.work ?? {})) {
    if (endedBy(views.reports, id, entry?.work)) continue;
    const data = entry.work?.data ?? {};
    const feature = views.features?.[id]?.data;
    const parts = [
      `${data.lane ?? '?'} lane`,
      entry.approved ? `approved (${short(entry.approval?.hash)})` : 'not approved',
      feature ? `its session is ${feature.step}${feature.worktree ? ` in ${feature.worktree}` : ''}` : 'queued, not started',
      ...(data.doc ? [`document ${data.doc.path} (${short(data.doc.hash)})`] : []),
    ];
    lines.push(`- ${id}: ${titleOf(data, id)}. ${parts.join('; ')}`);
  }
  return lines;
}

function listLines(list, describe) {
  return Object.entries(list ?? {}).map(([key, entry]) => `- ${key}: ${describe(entry.data ?? {}, key, entry)}`);
}

const SECTIONS = {
  work: ['Open work', workLines],
  ideas: ['Ideas', (views) => listLines(views.ideas, (data, key) => titleOf(data, key))],
  rejections: ['Rejections', (views) => listLines(views.rejections, (data, key, entry) => `${titleOf(data, key)} (turned down ${dayOf(entry.at)}${data.reason ? `: ${data.reason}` : ''})`)],
  questions: ['Questions waiting on the director', (views) => Object.values(views.questions ?? {})
    .filter((q) => q.answer === null)
    .map((q) => `- ${q.question.data.id} (${q.question.data.work}, level ${q.question.data.level}): ${q.question.data.what}`)],
};

export function viewLines(views, name) {
  const names = name === undefined ? Object.keys(SECTIONS) : [name];
  return names.flatMap((n) => {
    const [heading, lines] = SECTIONS[n];
    const found = lines(views);
    return [`${heading}:`, ...(found.length > 0 ? found : ['  (none)'])];
  });
}

async function readStdin(stdin) {
  if (!stdin || stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => (typeof c === 'string' ? Buffer.from(c) : c))).toString('utf8');
}

// Runs one command. Resolves with the exit code; writes its answer through `out` and `err`.
export async function main(argv, {
  client = helperClient(), cwd = process.cwd(), stdin = process.stdin, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  const [command, ...rest] = argv;
  const fail = (text, code = 1) => { err(`${text}\n`); return code; };
  const views = async () => {
    const answer = await client.state.views({ cwd });
    if (!answer.ok) throw new Error(`The helper would not give the views: ${answer.refused}`);
    return answer.views;
  };
  try {
    if (command === 'similar') {
      const text = rest.length > 0 ? rest.join(' ') : (await readStdin(stdin)).trim();
      if (text === '') return fail('Give the request: similar <request>', 2);
      const found = similar(text, await views());
      out(found.length === 0
        ? 'Nothing in open work, ideas or rejections shares words with that.\n'
        : `${found.map((f) => `- ${f.kind} ${f.id} (score ${f.score.toFixed(2)}): ${f.title}`).join('\n')}\n`);
      return 0;
    }
    if (command === 'views') {
      if (rest.length > 1 || (rest[0] !== undefined && !Object.hasOwn(SECTIONS, rest[0]))) return fail(`Name one view: ${Object.keys(SECTIONS).join(', ')}`, 2);
      out(`${viewLines(await views(), rest[0]).join('\n')}\n`);
      return 0;
    }
    if (command === 'record') {
      const [kind, ...json] = rest;
      if (!RECORD_KINDS.includes(kind)) return fail(`Record one of: ${RECORD_KINDS.join(', ')}\n\n${USAGE}`, 2);
      const text = json.length > 0 ? json.join(' ') : await readStdin(stdin);
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return fail(`The data is not JSON. ${USAGE}`, 2);
      }
      // The event's shape is checked as the helper checks it; the helper makes the event itself.
      try {
        makeEvent({ kind, data });
      } catch (error) {
        return fail(`Not recorded: ${error.message}.`);
      }
      const written = await client.state.write({ cwd, kind, data });
      if (!written.ok) return fail(`Not recorded: ${written.refused}`);
      out(`Recorded ${kind} ${written.id}.\n`);
      return 0;
    }
    if (command === 'hash') {
      if (rest.length !== 1) return fail('Name one file: hash <file>', 2);
      const file = path.resolve(cwd, rest[0]);
      out(`${briefHash(fs.readFileSync(file, 'utf8'))}\n`);
      return 0;
    }
    if (command === undefined || command === 'help') {
      out(USAGE);
      return 0;
    }
    return fail(USAGE, 2);
  } catch (error) {
    return fail(error.message);
  }
}
