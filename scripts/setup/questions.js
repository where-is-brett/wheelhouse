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
// A project that looks like it signs Apple apps (an Xcode project or workspace, fastlane, or
// `codesign` in its build scripts: signsAppleApps) is asked one more plain question, whether it
// signs them. Builds can't read the Mac's keychain unless it does, a quiet default no other project
// hears of (the director's ruling of 24 October 2026); step 7 writes `signsApps` from the answer.
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
import { REAL_USERS, LEVELS, productOf, repoName } from './host.js';

export const LIVE_DATA = Object.freeze({ yes: 'Yes, live data', no: 'No live data' });
export const SIGNS_APPS = Object.freeze({ no: 'No', yes: 'Yes, it signs apps' });
export const PRODUCT = Object.freeze({ readme: 'The README\'s words', shaping: 'Still taking shape', later: 'Describe it later' });
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

// Folders a build fills or another package brings, never looked in for signs of Apple apps.
const NOT_THE_PROJECT = new Set(['.git', 'node_modules', 'Pods', 'build', 'dist', 'DerivedData', '.build', 'vendor']);
const SIGNING_SCRIPTS = ['package.json', 'Makefile', 'Gemfile'];
const SCRIPT_BYTES = 64 * 1024;
const MOST_ENTRIES = 5000;

// Whether the project in `folder` looks like it signs Apple apps: an `.xcodeproj` or `.xcworkspace`
// folder, a `fastlane` folder or a Fastfile within three folders of the top, or `codesign` or
// `fastlane` named in its top-level package.json, Makefile or Gemfile. Reads names and the starts of
// those files only, and stops after MOST_ENTRIES names.
export function signsAppleApps(folder) {
  let seen = 0;
  const look = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      seen += 1;
      if (seen > MOST_ENTRIES) return false;
      if (/\.(?:xcodeproj|xcworkspace)$/i.test(e.name) || e.name === 'Fastfile' || (e.isDirectory() && e.name === 'fastlane')) return true;
      if (e.isDirectory() && !e.isSymbolicLink() && depth < 3 && !NOT_THE_PROJECT.has(e.name) && look(path.join(dir, e.name), depth + 1)) return true;
    }
    return false;
  };
  if (look(folder, 1)) return true;
  return SIGNING_SCRIPTS.some((name) => {
    const file = path.join(folder, name);
    const text = isFile(file) ? readStart(file, SCRIPT_BYTES) : null;
    return text !== null && /\b(?:codesign|fastlane)\b/.test(text);
  });
}

// The registered project for the folder, with its records in place, and the product's name:
// { project, record, name }; null until step 3 has set them up.
export function connectedProject(folder) {
  const found = projectForFolder(folder);
  if (found === null || typeof found.record?.repo !== 'string') return null;
  if (!fs.existsSync(path.join(stateDir(found.project), '.git')) || !fs.existsSync(path.join(found.record.folder, '.git'))) return null;
  return { ...found, name: found.record.repo.split('/').at(-1) };
}

// The product's name as step 3 names it: its repository's for an existing project, else the folder's.
export function productName(folder) {
  try {
    return productOf(folder).name;
  } catch {
    return repoName(folder);
  }
}

// What a step whose answers write to the project's records gives until step 3 has set them up.
export function waitForProject(n) {
  return { wait: PROJECT_WAIT_MS, why: `step 3 (${SETUP_TITLES[3]}) has not set up the project's records yet; step ${n}'s questions record their answers there, so they come once it has` };
}

const PHASE = { launched: 'launched', before: 'before-launch' };

// The first question: what the product is and who uses it. Its answer records the product's
// glossary entry and its phase. Its id names the phase, so a real-users answer given again asks
// it again, and the phase recorded follows the answer (Task 9's review). With no README words to
// offer, Still taking shape takes their place, so the card always has two options of its own, as
// AskUserQuestion needs: it records a plain entry saying the product is new.
function productAsk(name, { described, realUsers }) {
  const phase = realUsers ? PHASE.launched : PHASE.before;
  const phaseWrite = { kind: 'setting', data: { key: 'phase', value: phase } };
  const entry = (plain) => ({ kind: 'glossary', data: { term: name, plain } });
  const shaping = 'A new product, still taking shape.';
  const options = [
    described === null ? { label: PRODUCT.shaping, says: `"${shaping}" You can describe it to the front desk once it is clearer.` } : { label: PRODUCT.readme, says: `"${described}"` },
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
      because: described === null ? 'it tells agents the product is new until you describe it' : 'it is how the project already describes itself',
      meanwhile: MEANWHILE,
    },
    writes: {
      labels: {
        ...(described === null ? { [PRODUCT.shaping]: [entry(shaping), phaseWrite] } : { [PRODUCT.readme]: [entry(described), phaseWrite] }),
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

// The third question, only for a project that looks like it signs Apple apps: whether it does.
function appleAppsAsk(name) {
  return {
    id: 'apple-apps',
    card: {
      level: 2,
      what: `Setup step 4: ${name} looks like an iPhone or Mac app. Do its builds sign the app on this computer, for the App Store or TestFlight?`,
      why: 'Signing needs the saved passwords on this Mac, which Wheelhouse otherwise keeps out of every build.',
      options: [
        { label: SIGNS_APPS.no, says: 'Builds can\'t reach your saved passwords. If signing is needed later, it can be changed by a reviewed change you approve.' },
        { label: SIGNS_APPS.yes, says: 'Builds of this project may use your saved passwords to sign the app.' },
      ],
      recommend: SIGNS_APPS.no,
      because: 'it keeps your saved passwords out of reach if you are not sure',
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
      // The questions are asked up front, before step 3 has set up the project (design section
      // 15.1): a look at the choices (ctx.choicesOnly, scripts/setup/choices.js) names the product
      // as step 3 will. The step settles only once the project is set up, since its answers write to
      // the project's records.
      if (project === null && ctx.choicesOnly !== true) return waitForProject(4);
      const name = project?.name ?? productName(ctx.folder);
      const answers = ctx.answers ?? {};
      const real = answers['3.real-users'];
      if (!real) return { wait: PROJECT_WAIT_MS, why: 'step 3 has not asked whether the product has real users yet' };
      const realUsers = real.label === REAL_USERS.yes;
      const asked = productAsk(name, { described: readmeDescription(ctx.folder), realUsers });
      const product = answers[`4.${asked.id}`];
      if (!product) return { ask: asked };
      const live = answers['4.live-data'];
      if (!live) return { ask: liveDataAsk(name) };
      const apple = signsAppleApps(ctx.folder) ? answers['4.apple-apps'] : null;
      if (apple === undefined) return { ask: appleAppsAsk(name) };
      if (project === null) return ctx.choicesOnly === true ? { wait: 0, why: 'every choice of step 4 is made' } : waitForProject(4);
      return {
        settled: {
          record: {
            described: typeof product.text === 'string' || product.label === PRODUCT.readme || product.label === PRODUCT.shaping,
            phase: realUsers ? PHASE.launched : PHASE.before,
            locked: answers['3.locked']?.label === LEVELS.locked,
            liveData: live.label === LIVE_DATA.yes,
            ...(apple ? { signsApps: apple.label === SIGNS_APPS.yes } : {}),
          },
        },
      };
    },
    async apply() {
      return [];
    },
  };
}
