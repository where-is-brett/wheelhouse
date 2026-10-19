// scripts/setup/questions.js
// Step 4, Three questions (design section 15): what the product is and who uses it, and whether it
// has live data (design section 12.6). The third, whether it has real users, and on a Mac with
// real users the offer of Locked, step 3 asks (ruling R37), since its connection card depends on
// them; this step reads those answers, `3.real-users` and `3.locked`, and does not ask them again.
//
// Nothing here goes through a Go ahead (ruling R59). The answer to the first question records the
// product's glossary entry (the director's words, or the README's, as they choose) and the
// product's phase, from the real-users answer (ruling R38): launched with real users, before launch
// without. Its card says so, and the prompt record, which signs, records them from the click, the
// phase with its confirmation (scripts/lib/setup-writes.js). The live-data answer is recorded
// nowhere here: step 7 writes `liveData: true` into the project's configuration from it (ctx.answers,
// ruling R31). Its card tells the director, once, that agents get test data only for now. Once both
// are answered the step settles (ruling R32).
//
// The answers write to the project's records, which step 3 sets up, so until the folder is a
// registered project with its records in place, the step waits rather than ask.
import fs from 'node:fs';
import path from 'node:path';
import { SETUP_TITLES } from '../state/card-lines.js';
import { stateDir } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { scanContent } from '../state/secret-scan.js';
import { hide } from '../lib/clean.js';
import { REAL_USERS, LEVELS } from './host.js';

export const LIVE_DATA = Object.freeze({ yes: 'Yes, live data', no: 'No live data' });
export const PRODUCT = Object.freeze({ readme: 'The README\'s words', later: 'Describe it later' });
// How long a step whose answers write to the project's records waits for step 3 to set them up.
export const PROJECT_WAIT_MS = 30 * 1000;
// The most of the README's first sentence the first question offers.
export const DESCRIPTION_CHARS = 200;
export const MEANWHILE = 'Setup waits for this answer; anything installing carries on.';
const README_BYTES = 64 * 1024;

export const isFile = (file) => {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
};

// The start of a file, as text, or null when it can't be read.
export function readStart(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// The project's README at the top of its folder, whatever its case, or null.
export function readmeOf(folder) {
  let names;
  try {
    names = fs.readdirSync(folder);
  } catch {
    return null;
  }
  const found = names.filter((n) => /^readme(?:\.(?:md|markdown|txt))?$/i.test(n)).sort();
  const md = found.find((n) => /\.md$/i.test(n)) ?? found[0];
  return md && isFile(path.join(folder, md)) ? path.join(folder, md) : null;
}

// The README's first sentence of prose, outside headings, badges, markup and code, at most
// DESCRIPTION_CHARS, cut at a word, with any sign-in in an address hidden, as the card shows it;
// null when there is none or it holds what looks like a secret.
export function readmeDescription(folder) {
  const file = readmeOf(folder);
  const text = file === null ? null : readStart(file, README_BYTES);
  if (text === null) return null;
  let fence = false;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (/^(?:```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || line === '' || /^(?:#|\||<|!\[|\[!|---|===|>)/.test(line)) continue;
    const plain = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
    const first = plain.split(/(?<=[.!?])\s/)[0];
    if (first.split(' ').length < 3) continue;
    const cut = first.length <= DESCRIPTION_CHARS ? first : `${first.slice(0, DESCRIPTION_CHARS).replace(/\s+\S*$/, '')}…`;
    return scanContent(cut).length > 0 ? null : hide(cut, []);
  }
  return null;
}

// The registered project for the folder, with its records in place, and the product's name:
// { project, record, name }; null until step 3 has set them up.
export function connectedProject(folder) {
  const found = projectForFolder(folder);
  if (found === null || typeof found.record?.repo !== 'string') return null;
  if (!fs.existsSync(path.join(stateDir(found.project), '.git')) || !fs.existsSync(path.join(found.record.folder, '.git'))) return null;
  return { ...found, name: found.record.repo.split('/').at(-1) };
}

// What a step whose answers write to the project's records gives until step 3 has set them up.
export function waitForProject(n) {
  return { wait: PROJECT_WAIT_MS, why: `step 3 (${SETUP_TITLES[3]}) has not set up the project's records yet; step ${n}'s questions record their answers there, so they come once it has` };
}

const PHASE = { launched: 'launched', before: 'before-launch' };

// The first question: what the product is and who uses it. Its answer records the product's
// glossary entry and its phase. Its id names the phase, so a real-users answer given again asks
// it again, and the phase recorded follows the answer (Task 9's review).
function productAsk(name, { described, realUsers }) {
  const phase = realUsers ? PHASE.launched : PHASE.before;
  const phaseWrite = { kind: 'setting', data: { key: 'phase', value: phase } };
  const entry = (plain) => ({ kind: 'glossary', data: { term: name, plain } });
  const options = [
    ...(described === null ? [] : [{ label: PRODUCT.readme, says: `"${described}"` }]),
    { label: PRODUCT.later, says: 'Setup records no description of it yet; you can give one to the front desk later.' },
  ];
  return {
    id: `product-${phase}`,
    typed: true,
    card: {
      level: 2,
      what: `Setup step 4: in a sentence, what is ${name}, and who uses it? ${described === null ? 'Type it' : 'Choose the README\'s words, or type your own'} as your answer. Setup keeps it as ${name}'s entry in the glossary, and records ${name} as ${realUsers ? 'launched, since it has real users' : 'before launch, since it has no real users yet'}.`,
      why: 'Wheelhouse explains its work to you in terms of your product, and treats a launched product with more care.',
      options,
      recommend: options[0].label,
      because: described === null ? 'you can describe it later' : 'it is how the project already describes itself',
      meanwhile: MEANWHILE,
    },
    writes: {
      labels: {
        ...(described === null ? {} : { [PRODUCT.readme]: [entry(described), phaseWrite] }),
        [PRODUCT.later]: [phaseWrite],
      },
      typed: [{ ...entry(''), typedInto: 'plain' }, phaseWrite],
    },
  };
}

// The second question: whether the product has live data.
function liveDataAsk(name) {
  return {
    id: 'live-data',
    card: {
      level: 3,
      what: `Setup step 4: does ${name} hold live data, such as real people's accounts, orders or messages, in a database or a service it uses?`,
      why: 'Agents never work on live data: with it, they are kept to a practice copy or test data.',
      options: [
        { label: LIVE_DATA.yes, says: 'Agents get test data only for now, since setup can\'t yet make a practice copy for any provider; this card is where you are told.' },
        { label: LIVE_DATA.no, says: 'Agents work with the product\'s data as it is; tell the front desk if live data comes later.' },
      ],
      recommend: LIVE_DATA.yes,
      because: 'it keeps live data safe if you are not sure',
      meanwhile: MEANWHILE,
    },
  };
}

export function questionsStep() {
  return {
    n: 4,
    title: SETUP_TITLES[4],
    async plan(ctx) {
      const project = connectedProject(ctx.folder);
      if (project === null) return waitForProject(4);
      const answers = ctx.answers ?? {};
      const real = answers['3.real-users'];
      if (!real) return { wait: PROJECT_WAIT_MS, why: 'step 3 has not asked whether the product has real users yet' };
      const realUsers = real.label === REAL_USERS.yes;
      const asked = productAsk(project.name, { described: readmeDescription(ctx.folder), realUsers });
      const product = answers[`4.${asked.id}`];
      if (!product) return { ask: asked };
      const live = answers['4.live-data'];
      if (!live) return { ask: liveDataAsk(project.name) };
      return {
        settled: {
          record: {
            described: typeof product.text === 'string' || product.label === PRODUCT.readme,
            phase: realUsers ? PHASE.launched : PHASE.before,
            locked: answers['3.locked']?.label === LEVELS.locked,
            liveData: live.label === LIVE_DATA.yes,
          },
        },
      };
    },
    async apply() {
      return [];
    },
  };
}
