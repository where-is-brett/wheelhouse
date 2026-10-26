// scripts/setup/host.js
// Setup's step 3, the host and the connection (design sections 11 and 15).
//
// Its plan first asks its questions, one at a time, through the answer path (rulings R30, R37):
// whether the product has real users (`real-users`), then, on a Mac with real users, the offer of
// Locked (`locked`); for a new product, whether it is kept on GitHub or GitLab (`host`); then how
// agents reach it (`connection-<digest>`). Step 4 reads `3.real-users` and `3.locked` and does not
// ask them again. The connection question's words name the repository, and its id carries a digest
// of the card, so an answer given for one remote, one set of options or one level is never used for
// another (ruling R51). A Locked project is never offered Quick; on GitLab it is not asked at all,
// since Narrow is all there is.
//
// Then its Go-ahead card lists what apply does, in this order (ruling R34):
//   1. the director's own sign-in to the host, through the browser, unless `gh` or `glab` already
//      is signed in (no account yet: the host's sign-up page first);
//   2. for a new product, a private repository with a first commit on `main` (a README), and the
//      product's folder, which exists from step 1, connected to it in place: git init -b main,
//      remote add, fetch, the branch named main and reset to origin/main, so the folder's own files
//      stay as they were; an existing product keeps its repository, which must already hold a
//      branch of the product's, or its state branch would become the default;
//   3. the private profile repository, wheelhouse-profile, always on the director's own account
//      (never the product's organisation or group), while this computer has no profile (made only
//      when the account has none), then ~/.wheelhouse/profile.json and the profile's clone;
//   4. the connection: Quick needs nothing more. Narrow on GitHub is a code typed on GitHub, then
//      the app's Install page, where setup recommends the project and the profile, not All
//      repositories; the installation is looked up and its reach read back and said. A later
//      project, with the app's keys kept, needs no new code: a tick on the settings page, or the
//      Install page an earlier attempt left. Narrow on GitLab is a project key at Developer level,
//      made with the director's own sign-in; where GitLab refuses it (401 or 403), the token page
//      is opened and the token typed into the system's own box, straight to the keys file, never
//      the chat. Their own GitHub App (own-app.js) comes first where it is chosen and not yet
//      recorded: made from the filled-in new-app page on the account that holds the project, or
//      found there by its name, read back and refused when it asks for more than Wheelhouse's
//      manifest; read again before each code sign-in with it; and, once connected, recorded in
//      the profile, where it takes effect on the director's Confirm (ruling R56). An app of their
//      own on an organisation can't reach the profile on their own account, so a profile made
//      with it is reached Quick;
//   5. Wheelhouse's record of the project (writeProject), then its state clone (cloneState);
//   6. this computer's key put in the profile as enrolments/<computer>.json, pushed by its exact
//      commit with the director's own sign-in, so their other computers can trust it on a click
//      there (computers.js, ruling R79).
// Each change is recorded in the journal just before it is made. The step is long (ruling R40): it
// runs in its own process, and says each thing the director must do (a code, the Install page) as
// a line, through ctx.say, which /setup/status shows. It waits for step 2 (`after: [2]`, ruling
// R47), since it needs git and the host's tool, but its questions are asked while step 2's
// installers run (`asksDuring: [2]`, ruling R54); its plan never fails while they are missing.
// STOP stops it between its parts and in each of its waits.
//
// Setup's own git and host calls use the director's own sign-in, never the narrow key: `gh` or
// `glab` as the director has it, and for git their tool as its credential helper, through the
// environment (directorGitEnv). git is run by the path step 2 found, so a git installed since the
// helper started is found on Windows too.
//
// The GitLab director's token, which makes the project keys, is read by the helper alone from
// `glab auth status --show-token`, as check 22's trial did, held in memory, and sent only in the
// request's header (gitlabApi, bearer): never in an argument, an output or the journal.
//
// Protection is planned here and named on the card; it is switched on at the end of step 7, once
// the setup commit is up, with the director's own sign-in (switchOnAsDirector, Task 13).
//
// A second computer joins a project from an empty folder (design section 15, ruling R77). In a
// folder holding nothing but step 1's .claude/ and with no `origin`, the plan first asks `join`:
// A new product, or `<folder name>, from my other computer`, or a typed owner/name; recommended A
// new product when this computer has profile.json, else the other computer. Joining asks neither
// the real-users nor the Locked question (the first computer's; a joining Mac's step 8 asks Locked
// when the project is launched), but the host and the connection as usual, since each computer
// signs in for itself. Its Go-ahead list is: the sign-in; the repository named by the answer found
// on the director's account or one of their organisations (GitLab: groups), the one holding a
// `wheelhouse-state` branch; this folder checked out to it in place (git init, the remote, the
// default branch fetched, checkout -f), the committed .claude/settings.json in place of the
// install's, which is recorded first; the profile, found, and its clone; the state clone, whose
// `phase` setting refuses Quick on a launched project before anything is connected or registered;
// the narrow connection; and the project's record. No protection: the first computer's step 7
// switched it on. Apply records step 3's `answer` change { joined: <name> } before it does anything
// else, so the run reads as joining (scripts/lib/setup-run.js, stepsFor) before step 4's or step
// 5's questions could come (both wait for the project's records, which come later); it records
// { joined, missed } and refuses, saying to type owner/name, when none or several are found, and
// the plan then asks `join` again under an id naming what was missed; once connected it records
// { joined: '<owner/name>' }. A new product chosen after a joining attempt records { joined: null }.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as realRun } from '../lib/run.js';
import { wheelhouseHome, profileDir, stateDir, projectSlug } from '../lib/paths.js';
import { toolPath } from '../lib/host-tools.js';
import { canonicalJson } from '../lib/canonical.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { QUICK_LINE } from '../lib/host-lines.js';
import { detectHost } from '../host/adapter.js';
import { startDeviceSignIn, waitForSignIn, installUrl } from '../host/github-app.js';
import { installationCovers } from '../host/connection.js';
import { gitlabApi, makeProjectKey, isKeysSwitchedOff, checkBaseUrl, projectPath } from '../host/gitlab-key.js';
import { tokenUrl } from '../host/token-url.js';
import { composeCard, isTooLong } from '../cards/compose.js';
import { DEFAULT_GITLAB, gitlabBase, readGitlabHosts } from '../host/gitlab-base.js';
import { readKey, writeKey } from '../host/keys.js';
import { switchOnProtection, protectionStatus, readGitlabProtection } from '../host/protection.js';
import { askSecret as realAskSecret } from '../secrets/secret-box.js';
import { writeProject } from '../lib/projects.js';
import { cloneState, STATE_BRANCH } from '../state/clone.js';
import { sameRemote } from '../state/git.js';
import { listEvents } from '../state/events.js';
import { joinedRepo, runClosed, JOIN_STEP } from '../lib/setup-run.js';
import { profileRemote, ensureProfileClone, readProfileViews, PROFILE_BRANCH } from '../profile/store.js';
import { toolsStatus, originUrl, applyCompanyCa } from './tools.js';
import { caFile, probeCertificate, companyGitEnv, gitlabBaseOf } from '../host/company-ca.js';
import {
  appName, appSlug, checkOwnApp, ensureOwnApp, ownAppCode, ownAppFrom, readOwnApp, recordOwnApp, helperProfile, sameLogin, shadowedOwnApp,
  PROFILE_TARGET,
} from './own-app.js';
import { readJournal, newId } from './journal.js';
import { enrolmentChange, ENROLMENT_PART, publishEnrolment } from './computers.js';
import { setupGit, setupGitEnv, refuseUnlistedSettings, reaching } from './git.js';

// The Wheelhouse organisation's GitHub App: null fields until the organisation is made and the app
// registered (Card 1).
export const APP_FILE = fileURLToPath(new URL('../host/app.json', import.meta.url));
export const PROFILE_REPO = 'wheelhouse-profile';
// Wheelhouse's own branches, which are never the product's.
const WHEELHOUSE_BRANCHES = [STATE_BRANCH, 'wheelhouse-lock', PROFILE_BRANCH];

// The answers' labels: step 4 (Task 9) reads the first two from `3.real-users` and `3.locked`.
export const REAL_USERS = Object.freeze({ yes: 'Yes, real users', no: 'Not yet' });
export const LEVELS = Object.freeze({ locked: 'Locked', standard: 'Standard' });
export const HOST_LABELS = Object.freeze({ github: 'GitHub', gitlab: 'GitLab' });
export const WAYS = Object.freeze({ wheelhouse: 'The Wheelhouse app', own: 'My own app', narrow: 'Narrow', quick: 'Quick' });

const NAME = { github: 'GitHub', gitlab: 'GitLab' };
const ADDRESS = { github: 'github.com', gitlab: new URL(DEFAULT_GITLAB).host };
// The host's address as `glab` and `gh` name it: GitHub's, or the GitLab's host with its port when it has one.
const addressOf = (host, base = DEFAULT_GITLAB) => (host === 'gitlab' ? new URL(base).host : ADDRESS[host]);
const TOOL = { github: 'gh', gitlab: 'glab' };
export const SIGN_UP = Object.freeze({ github: 'https://github.com/signup', gitlab: `${DEFAULT_GITLAB}/users/sign_up` });
// Where to make an account: GitHub's page, or the sign-up page of the GitLab at `base`.
export const signUpUrl = (host, base = DEFAULT_GITLAB) => (host === 'gitlab' ? `${base.replace(/\/+$/, '')}/users/sign_up` : SIGN_UP[host]);

// How long the browser sign-in may take (GitHub's codes last 15 minutes), and how long and how often
// setup looks for the app's installation and its reach once the Install page is open.
export const SIGN_IN_WAIT_MS = 15 * 60 * 1000;
// How long `glab` may take to take a typed token.
export const SIGN_IN_TOKEN_WAIT_MS = 60 * 1000;
export const INSTALL_WAIT_MS = 8 * 60 * 1000;
export const INSTALL_POLL_MS = 5 * 1000;
// The project keys: a name GitLab shows, and the longest life it allows (check 22).
export const KEY_NAME = 'Wheelhouse agents';
export const KEY_DAYS = 365;

// Said when the person's own app, as their profile records it, belongs to another account than the
// project's: a private app reaches only its own account's repositories, and a second app of their
// own waits for a later update (rulings R58, R83). The step waits, with this line, rather than show
// a Go ahead apply could only refuse.
export const ownAppElsewhere = (app, where) => `Your own GitHub App, ${app.slug}, belongs to ${app.owner}, and an app of your own reaches only its own account's repositories, so it can't reach ${where}: choose the Wheelhouse app or Quick for it`;
// Their own app, accepted in their profile, hidden by a newer change to it that waits for the
// director's Confirm (rulings R84, R115). When that change is setup's own proposal of the same app,
// the step waits for its Confirm with `ownAppWaiting`; any other change gets a card whose one change
// proposes the accepted app again (`ownAppAgainCard`), never a new app; its apply ends with
// `ownAppProposedAgain`, so step 3 is asked again once the director has confirmed.
const appNamed = (app) => `${app.slug} on ${app.owner}`;
const sameApp = (a, b) => a !== null && b !== null && a.clientId === b.clientId && a.slug === b.slug && sameLogin(a.owner, b.owner);
export const ownAppWaiting = ({ accepted }) => `Your own GitHub App, ${appNamed(accepted)}, waits for your Confirm again in your profile, so step 3 waits: click Confirm on its card, then ask again`;
export const ownAppProposedAgain = (app) => `Your own GitHub App, ${appNamed(app)}, is proposed again in your profile: click Confirm on its card, and step 3 goes on from there`;
const ownAppAgainCard = ({ accepted, waiting }) => ({
  kind: 'setup',
  level: 3,
  what: `Setup step 3, ${SETUP_TITLES[3]}: your own GitHub App ${appNamed(accepted)} proposed again in your profile, since a newer change to it waits for your Confirm (${waiting === null ? 'no app of your own' : appNamed(waiting)}) and hides it. Nothing is made and nothing signed in.`,
  why: 'Confirm that other change only if you made it; Confirm on the new proposal brings your app back.',
  options: [
    { label: SETUP_LABEL, says: 'Setup proposes your app again; you confirm it on its card, then step 3 goes on.' },
    { label: 'Not now', says: 'Your app stays hidden, and step 3 waits.' },
  ],
  recommend: SETUP_LABEL,
  because: 'your app comes back only once it is proposed again and confirmed',
  meanwhile: 'Step 3 waits.',
});
export const OWN_APP_WAIT_MS = 10 * 60 * 1000;
// Said when this computer's one `github-app` keys entry holds an installation of another app than
// the one a project would use (ruling R58): signing in to the other would overwrite the keys that
// serve the earlier projects, and the profile. The plan waits with it; apply refuses with it.
export const oneAppLine = ({ kept, using, where }) => `This computer keeps one GitHub App's keys, and they serve your other projects through ${kept}, so ${where} can't be connected through ${using} until a later Wheelhouse update`;
export const NO_APP_LISTED = 'Step 3\'s list names no GitHub App';
// Said when setup has given this computer the company's certificate: a program already running
// reads its trusted certificates when it starts, so the step goes on in a fresh process.
export const CERTIFICATE_GIVEN = (base) => `Setup has given this computer your company's certificate for ${base}, for that address only. Step 3 stopped here so the certificate takes effect: ask for step 3's card again`;
export const STOPPED = 'STOP came on, so setup stopped here; once STOP is lifted, a fresh Go ahead carries on';
// How often the browser sign-in looks at STOP while it waits.
export const STOP_LOOK_MS = 1000;
export const HISTORY_LINE = 'This folder has its own git history but no GitHub or GitLab address, so setup has left it as it is: connect it to its repository (git remote add origin <address>), then ask again';
// The join question's first option; the second names the folder (ruling R77).
export const NEW_PRODUCT = 'A new product';
export const fromOtherComputer = (name) => `${name}, from my other computer`;
// What a folder may hold beside step 1's .claude/ and still be empty: the system's own files.
const SYSTEM_FILES = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
// Said when Quick is chosen for a launched project a computer joins (design section 11).
export const quickLaunched = (repo) => `${repo} is launched (it has real users), and a launched product is reached only through a narrow connection, so Quick is refused: ask for step 3's card again and choose a narrow way`;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const digest = (value) => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 10);

async function quietly(run, file, args, options) {
  try {
    return await run(file, args, options);
  } catch {
    return { code: 1, stdout: '', stderr: '' };
  }
}

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- The app ----

// The Wheelhouse organisation's app as scripts/host/app.json holds it, or null while its client ID
// is not there (the app not registered yet), or the file is unreadable.
export function wheelhouseApp({ appFile = APP_FILE } = {}) {
  const found = json((() => {
    try {
      return fs.readFileSync(appFile, 'utf8');
    } catch {
      return '';
    }
  })());
  if (!found || typeof found !== 'object') return null;
  const { clientId, slug, owner } = found;
  if (typeof clientId !== 'string' || clientId.trim() === '' || typeof slug !== 'string' || !SLUG.test(slug)) return null;
  return { clientId, slug, owner: typeof owner === 'string' ? owner : null };
}

// The person's own app, as their profile's views on this computer hold it, confirmed by the
// director (ruling R56): { clientId, slug, owner }, or null. An unconfirmed entry, or views that
// can't be read, is no app. `views` reads them (readProfileViews).
export function ownApp({ views = readProfileViews } = {}) {
  try {
    return ownAppFrom(views());
  } catch {
    return null;
  }
}

// Their own app as accepted in their profile, when it is hidden only by a newer change to it that
// waits for the director's Confirm (ruling R84): { accepted, waiting }, or null.
function ownAppShadowed({ views = readProfileViews } = {}) {
  try {
    return shadowedOwnApp(views());
  } catch {
    return null;
  }
}

// The app the narrow GitHub connection signs in to: the person's own when they recorded one, else
// Wheelhouse's when it is registered, else null.
export function appFor({ appFile, views } = {}) {
  const own = ownApp({ views });
  if (own) return { ...own, own: true };
  const app = wheelhouseApp({ appFile });
  return app ? { ...app, own: false } : null;
}

// Narrow is always offered, on GitHub as on GitLab: on GitHub the person's own app is always
// possible (Card 1's answer keeps a way in without Wheelhouse's app).
export function narrowOffered(host) {
  return host === 'github' || host === 'gitlab';
}

// Whether the Wheelhouse app option is offered: only while app.json holds its client ID.
export function wheelhouseAppOffered({ appFile } = {}) {
  return wheelhouseApp({ appFile }) !== null;
}

// ---- The product ----

// The repository's owner/name in a remote address: its path, without .git or slashes at either end.
export function repoOf(remoteUrl) {
  const text = String(remoteUrl ?? '').trim();
  const scp = /^[^@/\s]+@[^:/\s]+:(?!\/)(.+)$/.exec(text);
  let found = scp ? scp[1] : null;
  if (found === null) {
    try {
      found = new URL(text).pathname;
    } catch {
      found = '';
    }
  }
  const repo = decodeURIComponent(found).replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.][A-Za-z0-9_.-]*)+$/.test(repo)) throw new Error('The folder\'s repository address does not name a repository setup can read');
  return repo;
}

// A new product's repository name, from its folder's name: letters, digits, dots, dashes and
// underscores, accents dropped, anything else a dash.
export function repoName(folder) {
  const name = path.basename(folder).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+/, '')
    .slice(0, 50).replace(/[-.]+$/, '');
  return name === '' ? 'product' : name;
}

// Whether the folder's git has a commit on its current branch, read from its files (git may not be
// on this computer yet).
function hasHistory(folder) {
  const dir = path.join(folder, '.git');
  let head;
  try {
    head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
  } catch {
    return false;
  }
  const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
  if (!ref) return /^[0-9a-f]{40,64}$/.test(head);
  if (fs.existsSync(path.join(dir, ...ref.split('/')))) return true;
  try {
    return fs.readFileSync(path.join(dir, 'packed-refs'), 'utf8').split(/\r?\n/).some((line) => line.endsWith(` ${ref}`));
  } catch {
    return false;
  }
}

// The product: an existing one, whose folder's `origin` names its repository, or a new one.
// A company's own GitLab, named in `config.gitlabHosts`, gives its address as `base`; the public
// service's is the default and is left out.
export function productOf(folder, { config } = {}) {
  const origin = originUrl(folder);
  if (origin !== null) {
    const host = detectHost(origin, { gitlabHosts: config?.gitlabHosts });
    const repo = repoOf(origin);
    const base = host === 'gitlab' ? gitlabBase({ config, remoteUrl: origin }) : DEFAULT_GITLAB;
    return { isNew: false, host, repo, name: repo.split('/').at(-1), ...(base === DEFAULT_GITLAB ? {} : { base }) };
  }
  if (hasHistory(folder)) throw new Error(HISTORY_LINE);
  return { isNew: true, host: null, repo: null, name: repoName(folder) };
}

// Whether a folder holds nothing but step 1's .claude/ (and the system's own files), with no git of
// its own: where step 3 asks whether this computer is joining a product (ruling R77).
export function onlyInstall(folder) {
  let names;
  try {
    names = fs.readdirSync(folder);
  } catch {
    return false;
  }
  return names.every((n) => n === '.claude' || SYSTEM_FILES.includes(n)) && originUrl(folder) === null;
}

// Whether the project's state, as cloned on this computer, says the product is launched (its
// `phase` setting, ruling R38). A computer joining a project does not yet trust the other
// computers' keys (Task 14's trust card), so it can't tell a confirmed setting from a proposal, or
// a later one written to weaken it: any `phase` setting saying launched counts. It only ever takes
// Quick away, or asks Locked, so a state that can't be listed counts as launched (it fails closed).
export function launchedIn(project) {
  let events;
  try {
    events = listEvents(stateDir(project), { report: () => {} });
  } catch {
    return true;
  }
  return events.some((e) => e.kind === 'setting' && e.data?.key === 'phase' && e.data.value === 'launched');
}

// The https address of a repository, which the record and the clones use.
export const httpsRemote = ({ host, repo, base = DEFAULT_GITLAB }) => (host === 'gitlab' ? `${base.replace(/\/+$/, '')}/${repo}.git` : `https://${ADDRESS[host]}/${repo}.git`);

// The project's folder name under ~/.wheelhouse/projects/: owner__name (nested groups joined the same way).
export function slugFor(repo) {
  const parts = repo.split('/');
  return projectSlug(parts.slice(0, -1).join('__'), parts.at(-1));
}

const projectFile = (slug) => path.join(stateDir(slug), '..', 'project.json');
const profileFile = () => path.join(wheelhouseHome(), 'profile.json');

// ---- The questions ----

const MEANWHILE = 'Setup waits for this answer; anything installing carries on.';

function realUsersAsk(name) {
  return {
    id: 'real-users',
    card: {
      level: 2,
      what: `Does ${name} have real users yet: people who rely on it, beyond you and anyone testing it?`,
      why: 'A product with real users gets the narrow connection, and on a Mac the offer of Locked.',
      options: [
        { label: REAL_USERS.yes, says: 'Setup treats it as launched: the narrow connection, and on a Mac the offer of Locked.' },
        { label: REAL_USERS.no, says: 'Setup treats it as before launch; you can say so later, when it has users.' },
      ],
      recommend: REAL_USERS.no,
      because: 'most products start before launch; say yes only if people use it now',
      meanwhile: MEANWHILE,
    },
  };
}

// The Locked question: step 3's, and on a computer joining a launched project, step 8's.
export function lockedAsk(name) {
  return {
    id: 'locked',
    card: {
      level: 3,
      what: `${name} has real users, so Wheelhouse can lock its checks into a computer-wide file only an administrator can change: Locked. You type your computer password once, at its step.`,
      why: 'Locked guards against an agent trying to get round the checks, not only mistakes; it needs the narrow connection.',
      options: [
        { label: LEVELS.locked, says: 'The checks go into the administrator-only file, and Quick is not offered.' },
        { label: LEVELS.standard, says: 'The checks stay in the project and the plugin, which covers mistakes and misdirection.' },
      ],
      recommend: LEVELS.locked,
      because: 'a product with real users is one you can\'t afford to lose',
      meanwhile: MEANWHILE,
    },
  };
}

function hostAsk(name) {
  return {
    id: 'host',
    card: {
      level: 2,
      what: `Where should ${name} be kept: GitHub or GitLab? No account on either yet? You can make one at the sign-in, from the host's sign-up page.`,
      why: 'Setup makes the new product a private repository there, and connects this folder to it.',
      options: [
        { label: HOST_LABELS.github, says: 'A private repository on your GitHub account.' },
        { label: HOST_LABELS.gitlab, says: 'A private project on your GitLab account.' },
      ],
      recommend: HOST_LABELS.github,
      because: 'it is the one most people use, and Wheelhouse\'s app works there',
      meanwhile: MEANWHILE,
    },
  };
}

// The join question (ruling R77), asked first in a folder holding only step 1's install. `missed`
// is why it is asked again: { name, missed }, where `missed` is 'none', the repositories found
// when there were several, or 'not-a-name' for typed text that names no repository.
function joinAsk(id, name, { profile, missed }) {
  const other = fromOtherComputer(name);
  let found = '';
  if (missed?.missed === 'not-a-name') found = `"${missed.name}" is not a repository's name. `;
  else if (Array.isArray(missed?.missed)) found = `More than one ${missed.name} holds Wheelhouse's records: ${missed.missed.slice(0, 5).join(', ')}. `;
  else if (missed) found = `Setup found no ${missed.name} holding Wheelhouse's records on your account or organisations. `;
  return {
    id,
    typed: true,
    card: {
      level: 2,
      what: `${found}Is ${name} a new product, or one you set up with Wheelhouse on your other computer? If it is kept under another name, or to say which one, type its owner/name.`,
      why: 'A product set up on another computer is checked out into this folder with its records, never made again.',
      options: [
        { label: NEW_PRODUCT, says: 'Setup makes a private repository for it and connects this folder to it.' },
        { label: other, says: `Setup finds ${name} on your account or organisations, with Wheelhouse's records, and checks it out into this folder.` },
      ],
      recommend: profile ? NEW_PRODUCT : other,
      because: profile
        ? 'this computer is already set up with Wheelhouse, so an empty folder is most likely a new product'
        : 'this computer is new to Wheelhouse, so an empty folder is most likely a product from your other one',
      meanwhile: MEANWHILE,
    },
  };
}

// A typed answer to the join question as a repository's name: owner/name (groups too) or a bare
// name, without .git; null for anything else.
export function repoNamed(text) {
  const named = String(text ?? '').trim().replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.][A-Za-z0-9_.-]*)*$/.test(named)) return null;
  return named.split('/').some((part) => /^\.+$/.test(part)) ? null : named;
}

// Step 3's records of a run's joining (ruling R77), in order: its `answer` changes with `joined`.
const joinRecords = (run) => (Array.isArray(run?.changes) ? run.changes : [])
  .filter((c) => c?.step === JOIN_STEP && c.kind === 'answer' && c.after && typeof c.after === 'object' && Object.hasOwn(c.after, 'joined'));

// Whether `origin` names the repository `repo` (owner/name), whatever the address's form.
function originNames(origin, repo) {
  if (typeof origin !== 'string' || typeof repo !== 'string') return false;
  const named = origin.trim().replace(/\\/g, '/').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
  const wanted = repo.toLowerCase();
  return named.endsWith(`/${wanted}`) || named.endsWith(`:${wanted}`);
}

// The repository this folder is checked out to as a joining computer's (ruling R102), or null: the
// `.git` change step 3's checkout recorded for it, in any run uninstall hasn't closed, or this run's
// repository found by a joining attempt when the folder's `origin` names it. Such a folder stays joined: the join question
// is not asked again, every retry uses that repository, and it is never set up as a new product.
export function joinedFolder(folder, run = null) {
  const target = path.join(folder, '.git');
  const checkout = readJournal().runs.filter((r) => !runClosed(r)).flatMap((r) => r?.changes ?? [])
    .filter((c) => c?.step === JOIN_STEP && c.kind === 'folder' && c.target === target && typeof c.after?.joined === 'string').at(-1);
  if (checkout) return checkout.after.joined;
  const found = joinRecords(run).filter((c) => c.after.found === true).at(-1)?.after.joined ?? null;
  return found !== null && originNames(originUrl(folder), found) ? found : null;
}

// Whether this computer is joining a product, from the join question's answer (ruling R77): { ask }
// while the question is open; { join, known } for a product from another computer, `join` the name
// asked for (a bare name or owner/name) and `known` the owner/name an attempt found, or null (the
// list then names `known`, so a retry checks that repository and never searches again); or
// null for a new product, and in a folder where the question isn't asked (one holding more than
// step 1's install, unless the run is already joining). Each name an attempt missed, and each
// typed text that names no repository, asks the question again under an id naming them (ruling
// R51), so no answer is used again for a name that wasn't found.
function joinChoice(ctx) {
  const run = typeof ctx.runId === 'string' ? readJournal().runs.find((r) => r?.id === ctx.runId) ?? null : null;
  // A folder checked out to a joined repository is joined to it for good (ruling R102).
  const fixed = joinedFolder(ctx.folder, run);
  if (fixed !== null) return { join: fixed, known: fixed };
  const joined = joinedRepo(run);
  if (joined === null && !onlyInstall(ctx.folder)) return null;
  const name = repoName(ctx.folder);
  const records = joinRecords(run);
  const tried = records.filter((c) => c.after.missed !== undefined).map((c) => ({ name: c.after.joined, missed: c.after.missed }));
  // The repository an attempt since the last miss found.
  const known = records.slice(records.findLastIndex((c) => c.after.missed !== undefined) + 1).filter((c) => c.after.found === true).at(-1)?.after.joined ?? null;
  for (;;) {
    const id = tried.length === 0 ? 'join' : `join-${digest(tried)}`;
    const got = ctx.answers?.[`3.${id}`] ?? null;
    if (got === null) return { ask: joinAsk(id, name, { profile: fs.existsSync(profileFile()), missed: tried.at(-1) }) };
    if (got.label === NEW_PRODUCT) return null;
    if (typeof got.text === 'string') {
      const wanted = repoNamed(got.text);
      if (wanted === null) {
        tried.push({ name: got.text.trim().slice(0, 100), missed: 'not-a-name' });
        continue;
      }
      return { join: wanted, known };
    }
    return { join: name, known };
  }
}

// Quick's words where narrow is the recommendation (Windows, a Locked or launched project): its cost said plainly.
const QUICK_SAYS = `${QUICK_LINE} For trying Wheelhouse out: if that sign-in leaked, it would open every project you have, and on Windows any agent's command could read it.`;
// The advanced choice on the Mac's card, which leads to the narrow ways (the director's ruling of 24 October 2026).
export const STRICTER = 'Make it stricter';
const STRICTER_SAYS = 'A key to this one project only, instead of your whole account; recommended for teams and products with real users.';
const quickOnMac = (host) => `Your ordinary ${NAME[host]} sign-in. Agents work through Wheelhouse's helper, and on this Mac they can't read it.`;

// The connection's question (Card 1's answer, design section 11), the composer's input without its
// kind. On a Mac, for a project that is neither Locked nor launched, Quick is the default and the
// narrow ways sit behind STRICTER (stricterCard); the sandbox keeps agents from the sign-in there
// (check 73). With real users STRICTER is the recommendation. Elsewhere (Windows has no sandbox), on
// GitHub: the Wheelhouse app (only while it is registered), their own app (always), and Quick; on
// GitLab, Narrow or Quick; a narrow way is the recommendation, with one plain line on why. A Locked
// project is never offered Quick, so with no Wheelhouse app its card has one way, which step 3
// takes without asking (a card needs two options), listing it on its Go-ahead card. `where` names the repository as
// `owner/name on GitHub`. A launched project a computer joins is never offered Quick either
// (`launched`, design section 11), once its state says so.
export function connectionCard({ host, locked = false, launched = false, realUsers = false, platform = null, where, appFile } = {}) {
  if (!narrowOffered(host)) throw new Error('The connection is to GitHub or GitLab');
  const place = where ?? `the project on ${NAME[host]}`;
  if (platform === 'darwin' && !locked && !launched) {
    return {
      level: 3,
      what: `How should Wheelhouse's agents reach ${place}?`,
      why: 'Agents push and open pull requests only through Wheelhouse\'s helper; this chooses whose key it holds.',
      options: [{ label: WAYS.quick, says: quickOnMac(host) }, { label: STRICTER, says: STRICTER_SAYS }],
      recommend: realUsers ? STRICTER : WAYS.quick,
      because: realUsers ? 'the product has real users' : 'it needs nothing more, and you can make it stricter later',
      meanwhile: MEANWHILE,
    };
  }
  const options = [];
  let recommend;
  if (host === 'github') {
    const app = wheelhouseAppOffered({ appFile });
    if (app) options.push({ label: WAYS.wheelhouse, says: 'Narrow: you type a code on GitHub and tick this project and your profile on the app\'s Install page; agents reach only those.' });
    options.push({ label: WAYS.own, says: 'Narrow, through a GitHub App of your own, filled in from Wheelhouse\'s: you tick Enable Device Flow and click Create.' });
    recommend = app ? WAYS.wheelhouse : WAYS.own;
  } else {
    options.push({ label: WAYS.narrow, says: 'A GitLab project key for this project and your profile, made with your sign-in; where GitLab refuses, a token typed into your computer\'s own box.' });
    recommend = WAYS.narrow;
  }
  const quick = !locked && !launched;
  if (quick) options.push({ label: WAYS.quick, says: QUICK_SAYS });
  let noQuick = '';
  if (locked) noQuick = ' Locked needs a narrow connection, so Quick is not offered.';
  else if (launched) noQuick = ' It is launched, and a launched product needs a narrow connection, so Quick is not offered.';
  const reach = platform === 'win32'
    ? 'Windows has no sandbox to keep agents from your sign-in, so a key to this one project keeps the rest of your account out of reach'
    : 'agents then reach only this project and your profile, not your whole account';
  return {
    level: 3,
    what: `How should Wheelhouse's agents reach ${place}?${noQuick}`,
    why: 'Agents push and open pull requests only through Wheelhouse\'s helper; this chooses whose key it holds.',
    options,
    recommend,
    because: quick ? `${reach}; Quick is for trying Wheelhouse out` : reach,
    meanwhile: MEANWHILE,
  };
}

// The narrow way STRICTER leads to: on GitLab its project key, on GitHub their own app while the
// Wheelhouse app is not registered; otherwise null, and stricterCard asks which.
export function stricterWay({ host, appFile } = {}) {
  if (host === 'gitlab') return WAYS.narrow;
  return wheelhouseAppOffered({ appFile }) ? null : WAYS.own;
}

// After STRICTER on GitHub with the Wheelhouse app registered: the app, or their own.
export function stricterCard({ where, appFile } = {}) {
  const card = connectionCard({ host: 'github', locked: true, where, appFile });
  return { ...card, what: `Which key should Wheelhouse's helper hold for ${where ?? 'the project on GitHub'}?`, because: 'agents then reach only this project and your profile, not your whole account' };
}

// ---- Signing in ----

// `glab` is told a company's GitLab through GITLAB_HOST, which takes a port; `--hostname` refuses one
// on `glab api` (check 71). The public service needs no telling.
const ask = (run, host, args, base = DEFAULT_GITLAB) => quietly(run, toolPath(TOOL[host]), args, host === 'gitlab' && base !== DEFAULT_GITLAB ? { env: { GITLAB_HOST: addressOf(host, base) } } : {});

// Who the host's tool is signed in as, or null.
async function whoAmI({ host, run, base }) {
  const got = await ask(run, host, ['api', 'user'], base);
  if (got.code !== 0) return null;
  const body = json(got.stdout);
  const user = host === 'github' ? body?.login : body?.username;
  return typeof user === 'string' && user !== '' ? user : null;
}

// Whether `gh` or `glab` is signed in to the host, and as whom. Reads only; never fails: a tool not
// there yet is not signed in.
export async function signInStatus({ host, run = realRun, base = DEFAULT_GITLAB }) {
  const status = await ask(run, host, ['auth', 'status', '--hostname', addressOf(host, base)], base);
  if (status.code !== 0) return { signedIn: false, user: null };
  const user = await whoAmI({ host, run, base });
  return { signedIn: user !== null, user };
}

// Which way a sign-in to the host goes. The public service and a company's GitLab where the company
// has registered an OAuth application (`glab`'s `client_id` is set for the host) use the browser; a
// company's GitLab with none has no browser route, so the director types a token (check 71, where
// `glab` said "Set 'client_id' first"). The browser route needs the company's GitLab admin to register
// an application, which is the company's item, not setup's; the typed token works without one.
export async function signInRoute({ run = realRun, base = DEFAULT_GITLAB } = {}) {
  if (base === DEFAULT_GITLAB) return 'browser';
  const got = await ask(run, 'gitlab', ['config', 'get', 'client_id', '-g', '--host', addressOf('gitlab', base)], base);
  return got.code === 0 && String(got.stdout ?? '').trim() !== '' ? 'browser' : 'token';
}

// The token route: a page on the company's GitLab opens for a token to be made, the director pastes
// it into the computer's own hidden box (never the chat), and it goes to `glab auth login --stdin` on
// standard input: never an argument, the environment, a line said or an error. `glab` keeps it where
// its default keeps it, as for the browser route (the operating system's keyring; no option that
// puts it in a file is used), and setup reads it back only as it does today, with
// `glab auth status --show-token`.
const SIGN_IN_TOKEN_NAME = 'Wheelhouse sign-in';
const NO_TOKEN = 'No GitLab token was given, so setup could not sign in; a fresh Go ahead asks again';
async function signInWithToken({ run, base, say, stopped, open, askSecret, platform }) {
  const address = addressOf('gitlab', base);
  say(`Your company's GitLab, ${address}, has no sign-in through the browser set up, so make a token on the page that opens, then paste it into the box your computer shows: never into the chat`);
  say(`For your company's GitLab admin, if the browser sign-in is wanted instead: register an application for Wheelhouse with the permissions api, read_user, write_repository, openid and profile, then give its id to glab on this computer (glab config set client_id <id> -g --host ${address}). Registering it alone changes nothing here: setup uses the browser only once glab on this computer holds that id. That is the company's job, not setup's`);
  await open(tokenUrl({ host: 'gitlab', owner: '', repos: [], name: SIGN_IN_TOKEN_NAME, base }));
  let token;
  try {
    token = await askSecret({ title: 'Wheelhouse: GitLab token', prompt: 'Paste the GitLab token you just made. It goes straight to your computer\'s own sign-in for GitLab, never the chat.' }, platform);
  } catch {
    throw new Error(NO_TOKEN);
  }
  if (typeof token !== 'string' || token.trim() === '') throw new Error(NO_TOKEN);
  if (stopped()) throw new Error(STOPPED);
  await quietly(run, toolPath('glab'), ['auth', 'login', '--hostname', address, '--stdin', '--git-protocol', 'https'], {
    input: `${token.trim()}\n`, timeoutMs: SIGN_IN_TOKEN_WAIT_MS, env: { GITLAB_HOST: address },
  });
  if (stopped()) throw new Error(STOPPED);
  const after = await signInStatus({ host: 'gitlab', run, base });
  if (!after.signedIn) throw new Error(`Setup could not sign in to GitLab: ${address} did not accept the token. Make a new one with the api scope and a fresh Go ahead asks again`);
  return after;
}

// The existing sign-in, with no browser step; otherwise the tool's own browser sign-in, run with the
// director's environment, whose one-time code is said as it is shown, or on a company's GitLab with no
// OAuth application a typed token (`signInRoute`). STOP coming on while it waits (`stopped`) ends it,
// and the step stops.
export async function signIn({
  host, run = realRun, say = () => {}, stopped = () => false, base = DEFAULT_GITLAB,
  open = (url) => openPage(url, { run }), askSecret = realAskSecret, platform = process.platform,
}) {
  // glab defaults to ssh for git; a company's GitLab is set to https, as setup's git uses (check 71).
  const withHttps = async (found) => {
    if (host === 'gitlab' && base !== DEFAULT_GITLAB) await ask(run, host, ['config', 'set', 'git_protocol', 'https', '--host', addressOf(host, base)], base);
    return found;
  };
  const before = await signInStatus({ host, run, base });
  if (before.signedIn) return withHttps(before);
  if (host === 'gitlab' && await signInRoute({ run, base }) === 'token') {
    return withHttps(await signInWithToken({ run, base, say, stopped, open, askSecret, platform }));
  }
  say(`Sign in to ${NAME[host]} in the browser page that opens. No account yet? Make one first at ${signUpUrl(host, base)}`);
  let said = false;
  const onOutput = (text) => {
    const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(text)?.[1];
    if (code && !said) {
      said = true;
      say(`Type ${code.toUpperCase()} on ${NAME[host]}'s page in your browser, then click Authorise`);
    }
  };
  const args = host === 'github'
    ? ['auth', 'login', '--hostname', ADDRESS.github, '--git-protocol', 'https', '--web']
    : ['auth', 'login', '--hostname', addressOf('gitlab', base), '--git-protocol', 'https', '--web'];
  const controller = new AbortController();
  const watch = setInterval(() => { if (stopped()) controller.abort(); }, STOP_LOOK_MS);
  try {
    await quietly(run, toolPath(TOOL[host]), args, { input: '\n', timeoutMs: SIGN_IN_WAIT_MS, onOutput, signal: controller.signal, ...(host === 'gitlab' && base !== DEFAULT_GITLAB ? { env: { GITLAB_HOST: addressOf(host, base) } } : {}) });
  } finally {
    clearInterval(watch);
  }
  if (stopped()) throw new Error(STOPPED);
  const after = await signInStatus({ host, run, base });
  if (!after.signedIn) throw new Error(`Setup could not sign in to ${NAME[host]}: the sign-in in the browser was not finished. A fresh Go ahead tries again`);
  return withHttps(after);
}

// Opens a page in the director's browser; one that won't open is not fatal, since the line said
// with it names the page.
export async function openPage(url, { platform = process.platform, run = realRun } = {}) {
  const page = new URL(url);
  if (page.protocol !== 'https:' || page.username || page.password) throw new Error('Setup opens only https pages');
  if (platform === 'darwin') return quietly(run, 'open', [page.href]);
  if (platform === 'win32') return quietly(run, 'rundll32', ['url.dll,FileProtocolHandler', page.href]);
  return quietly(run, 'xdg-open', [page.href]);
}

// The director's GitLab sign-in, as glab holds it, read as check 22's trial read it: the token on
// the "Token found:" line of `glab auth status --show-token`, or a glpat- value there. Held in
// memory only; null when glab has none.
async function directorGitlabToken({ run, host = ADDRESS.gitlab, base = DEFAULT_GITLAB }) {
  const got = await quietly(run, toolPath('glab'), ['auth', 'status', '--hostname', host, '--show-token'], base !== DEFAULT_GITLAB ? { env: { GITLAB_HOST: host } } : {});
  const text = `${got.stdout ?? ''}\n${got.stderr ?? ''}`;
  const shown = /^[ \t]*\S*[ \t]*Token found\b[^:\n]*:[ \t]*(\S+)/im.exec(text)?.[1];
  return (shown && !/^\*+$/.test(shown) ? shown : null) ?? /\bglpat-[\w-]+/.exec(text)?.[0] ?? null;
}

// GitLab's API with the director's own sign-in, for making repositories and project keys, and for
// protection (Task 13). The token goes only into the request's header.
export async function directorGitlabApi({ run = realRun, fetch = globalThis.fetch, baseUrl = DEFAULT_GITLAB } = {}) {
  const root = checkBaseUrl(baseUrl);
  const token = await directorGitlabToken({ run, host: new URL(root).host, base: root });
  if (token === null) throw new Error('glab is not signed in to GitLab, so setup cannot use your GitLab sign-in');
  return gitlabApi({ baseUrl: root, token, bearer: true, fetch });
}

// The environment setup's git runs with: the director's own sign-in, through their host tool as
// git's only credential helper, never the narrow key, with git's global and system config shut
// out and no hooks (ruling R109, scripts/setup/git.js, setupGitEnv).
export function directorGitEnv({ host, gitPath = 'git', env = process.env, platform = process.platform, base } = {}) {
  // With the company's certificate for a company GitLab's address, once setup has made it (company-ca.js).
  return companyGitEnv(setupGitEnv({ host, gitPath, env, platform }), { host, base }, { platform });
}

// ---- The repositories ----

// A folder of Wheelhouse's own for git calls that need no repository (ls-remote).
function outsideAny() {
  fs.mkdirSync(wheelhouseHome(), { recursive: true });
  return wheelhouseHome();
}

// Refuses, as every setup git call does, when a clone of Wheelhouse's own that git is about to run
// in (scripts/state/, scripts/profile/) holds a setting not on setup's allowed list (rulings R109
// to R112).
async function refuseSettingsIn({ dir, run, gitPath }) {
  if (fs.existsSync(path.join(dir, '.git'))) await refuseUnlistedSettings({ run, gitPath, cwd: dir });
}

// A repository on the host as the director's sign-in sees it: { repo, id, defaultBranch, private },
// or null when there is none. `private` is true only when the host says so (a `visibility` of
// `private`, or GitHub's `private` where it gives no visibility), false when it says otherwise (an
// `internal` repository counts as not private: everyone in the enterprise, or signed in to that
// GitLab, can read it), and null when it says nothing.
// Anything but "not found" stops the step, said plainly.
async function repoInfo({ host, repo, run, api }) {
  if (host === 'github') {
    const got = await ask(run, host, ['api', `repos/${repo}`]);
    if (got.code !== 0) {
      if (/HTTP 404|Not Found/i.test(`${got.stderr}${got.stdout}`)) return null;
      throw new Error(`GitHub could not be asked about ${repo} with your sign-in`);
    }
    const body = json(got.stdout);
    if (typeof body?.full_name !== 'string') throw new Error(`GitHub's answer about ${repo} could not be read`);
    // GitHub's `visibility` (public, private or internal, where every member of an enterprise can read
    // it) says more than its `private`, which is true for an internal repository too.
    const shut = typeof body.visibility === 'string' ? body.visibility === 'private' : typeof body.private === 'boolean' ? body.private : null;
    return { repo: body.full_name, id: body.id ?? null, defaultBranch: body.default_branch ?? null, private: shut };
  }
  const got = await api.get(projectPath(repo));
  if (got.status === 404) return null;
  if (got.status !== 200 || typeof got.body?.path_with_namespace !== 'string') throw new Error(`GitLab could not be asked about ${repo} with your sign-in (HTTP ${got.status})`);
  const visibility = got.body.visibility;
  return { repo: got.body.path_with_namespace, id: got.body.id, defaultBranch: got.body.default_branch ?? null, private: typeof visibility === 'string' ? visibility === 'private' : null };
}

// Wheelhouse's records (the state and lock branches on the product's repository, and the profile
// repository) hold the director's own words, the cards, the briefs, the survey and the names of
// work not yet pushed, so they are never put where anyone can read them: a repository the host
// doesn't say is private is refused, with no card, and nothing is pushed to it
// (docs/research/self-hosting-2026-10.md, design section 22).
export const notPrivate = ({ host, repo, profile = false }) => (profile
  ? `${repo} on ${NAME[host]} is not private, and Wheelhouse keeps your settings and backups in it, so setup has stopped: make it private in its settings on ${NAME[host]}, then a fresh Go ahead tries again`
  : `${repo} on ${NAME[host]} is not private, and Wheelhouse keeps its records (your answers, its cards and its plans) on the project's own repository, so setup has stopped before putting anything there: a public project can't use Wheelhouse yet`);

function mustBePrivate(info, { host, profile = false }) {
  if (info.private !== true) throw new Error(notPrivate({ host, repo: info.repo, profile }));
  return info;
}

// Makes a private repository on the director's own account; `readme` gives it a first commit on main.
async function createRepo({ host, owner, name, readme, run, api }) {
  const repo = `${owner}/${name}`;
  if (host === 'github') {
    const args = ['repo', 'create', repo, '--private', ...(readme ? ['--add-readme'] : ['--description', 'Wheelhouse\'s profile: settings and backups, kept by Wheelhouse'])];
    const made = await ask(run, host, args);
    if (made.code !== 0) throw new Error(`GitHub did not make the private repository ${repo}`);
  } else {
    const made = await api.post('/projects', {
      name, path: name, visibility: 'private', ...(readme ? { initialize_with_readme: true, default_branch: 'main' } : {}),
    });
    if (made.status < 200 || made.status >= 300) throw new Error(`GitLab did not make the private project ${repo} (HTTP ${made.status})`);
  }
  const info = await repoInfo({ host, repo, run, api });
  if (info === null) throw new Error(`${repo} on ${NAME[host]} was made but can't be found`);
  return mustBePrivate(info, { host, profile: !readme });
}

// Whether setup made this repository itself, in any run uninstall hasn't closed: a retry then
// carries on with it.
export const madeBySetup = (target) => readJournal().runs.filter((r) => !runClosed(r)).flatMap((r) => r?.changes ?? [])
  .some((c) => c?.kind === 'host' && c.target === target && c.after?.made === true);

// Connects the product's folder to its new repository in place (ruling R34): git init -b main when
// it has no git, the remote added and fetched, the branch named main (whatever an unborn branch was
// called) and reset to origin/main without touching the folder's files; any of the repository's
// files the folder lacks (the README) are written out. It is fetched by its https address, never by
// the address the folder's origin names (ruling R111), which may be an ssh one of the same
// repository, or one an agent wrote. The folder's .git is recorded once, when
// setup adds the remote. Safe to repeat from any point: a retry finishes what an earlier attempt
// left, and records nothing again.
async function connectFolder({ folder, remoteUrl, gitPath, env, run, record }) {
  const git = setupGit({ run, gitPath, env: reaching(env, remoteUrl), cwd: folder, workTree: folder });
  const must = async (args, why) => {
    const done = await git(args);
    if (done.code !== 0) throw new Error(why);
    return done;
  };
  const hadGit = fs.existsSync(path.join(folder, '.git'));
  const origin = originUrl(folder);
  if (origin !== null && !sameRemote(origin, remoteUrl)) throw new Error('This folder is connected to another repository, so setup has left it as it is');
  if (origin === null) {
    record({ id: newId('chg'), kind: 'folder', target: path.join(folder, '.git'), before: hadGit ? { origin: null } : null, after: { origin: remoteUrl, branch: 'main' } });
    if (!hadGit) await must(['init', '-q', '-b', 'main'], 'git could not start in this folder');
    await must(['remote', 'add', 'origin', remoteUrl], 'git could not name the repository in this folder');
  }
  await must(['fetch', '-q', remoteUrl, '+refs/heads/main:refs/remotes/origin/main'], 'git could not fetch the new repository');
  const theirs = (await must(['rev-parse', '--verify', 'refs/remotes/origin/main'], 'git could not read the new repository\'s main')).stdout.trim();
  const head = await git(['rev-parse', '-q', '--verify', 'HEAD']);
  if (head.code !== 0) {
    // Unborn: whatever its branch was called (a default `git init` may say master), it is main.
    await must(['symbolic-ref', 'HEAD', 'refs/heads/main'], 'git could not name this folder\'s branch main');
    await must(['reset', '-q', 'origin/main'], 'git could not take the repository\'s first commit into this folder');
  }
  await must(['branch', '-q', '--set-upstream-to=origin/main'], 'git could not link the folder\'s branch to the repository');
  // The repository's files the folder lacks are written out while the folder is at the repository's
  // first commit; once the director has gone on from it, a file missing is theirs to have removed.
  if (head.code !== 0 || head.stdout.trim() === theirs) {
    const missing = (await must(['ls-files', '--deleted', '-z'], 'git could not read the folder')).stdout.split('\0').filter(Boolean);
    if (missing.length > 0) await must(['checkout', '-q', '--', ...missing], 'git could not write out the repository\'s files');
  }
}

// Whether the profile's clone on this computer is whole: its branch's upstream set, the last thing
// ensureProfileClone does. Read from its files.
export function profileCloneWhole() {
  const text = readText(path.join(profileDir(), '.git', 'config')) ?? '';
  const section = new RegExp(`^\\s*\\[branch\\s+"${PROFILE_BRANCH}"\\]\\s*$([\\s\\S]*?)(?=^\\s*\\[|(?![\\s\\S]))`, 'm').exec(text)?.[1] ?? '';
  return new RegExp(`^\\s*merge\\s*=\\s*refs/heads/${PROFILE_BRANCH}\\s*$`, 'm').test(section);
}

// Refuses an existing product whose repository has no branch of its own yet (an empty repository):
// the state branch, pushed next, would become its default branch (ruling R34).
async function productBranchOn({ host, repo, remoteUrl, gitPath, env, run }) {
  const listed = await setupGit({ run, gitPath, env: reaching(env, remoteUrl), cwd: outsideAny() })(['ls-remote', '--heads', remoteUrl]);
  if (listed.code !== 0) throw new Error(`${repo} on ${NAME[host]} could not be reached with your sign-in`);
  const own = String(listed.stdout).split(/\r?\n/).map((line) => /\trefs\/heads\/(.+)$/.exec(line)?.[1]).filter(Boolean)
    .filter((branch) => !WHEELHOUSE_BRANCHES.includes(branch));
  if (own.length === 0) {
    throw new Error(`${repo} on ${NAME[host]} has no branch of the product's yet, so Wheelhouse's state branch would become its default: push the product's main branch to it first, then ask again`);
  }
}

// ---- Joining a product set up on another computer (ruling R77) ----

export const ORGS_UNREAD = 'GitHub could not list your organisations with your sign-in, so setup has not looked for the project: a fresh Go ahead tries again, or type its owner/name on step 3\'s question';

// The director's organisations on GitHub, or groups on GitLab, as their sign-in sees them.
async function accountsOf({ host, run, api }) {
  if (host === 'github') {
    const got = await ask(run, host, ['api', 'user/memberships/orgs?state=active&per_page=100']);
    const list = got.code === 0 ? json(got.stdout) : null;
    // A listing that fails is never read as no organisations (ruling R102): the step stops.
    if (!Array.isArray(list)) throw new Error(ORGS_UNREAD);
    return list.filter((m) => m?.state === 'active').map((m) => m?.organization?.login)
      .filter((login) => typeof login === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(login));
  }
  const got = await api.get('/groups?min_access_level=10&per_page=100');
  if (got.status !== 200 || !Array.isArray(got.body)) throw new Error(`GitLab could not list your groups with your sign-in (HTTP ${got.status}), so setup has not looked for the project: a fresh Go ahead tries again, or type its owner/name on step 3's question`);
  return got.body.map((g) => g?.full_path).filter((p) => typeof p === 'string' && repoNamed(p) === p);
}

// Whether a repository holds Wheelhouse's state branch, read with the director's own sign-in.
async function holdsState({ remoteUrl, gitPath, env, run }) {
  const listed = await setupGit({ run, gitPath, env: reaching(env, remoteUrl), cwd: outsideAny() })(['ls-remote', '--heads', remoteUrl, `refs/heads/${STATE_BRANCH}`]);
  if (listed.code !== 0) return false;
  return String(listed.stdout).split(/\r?\n/).some((line) => line.endsWith(`\trefs/heads/${STATE_BRANCH}`));
}

// The repositories a joining computer's answer names that hold Wheelhouse's state branch: the
// typed owner/name, or a bare name on the director's own account and each of their organisations
// (GitLab: groups). Each as repoInfo gives it.
async function findJoined({ host, wanted, user, run, api, gitPath, env, hostUrl }) {
  const accounts = wanted.includes('/') ? [] : [user, ...(await accountsOf({ host, run, api }))];
  const candidates = wanted.includes('/') ? [wanted] : accounts.map((a) => `${a}/${wanted}`);
  const seen = new Set();
  const found = [];
  for (const repo of candidates) {
    if (seen.has(repo.toLowerCase())) continue;
    seen.add(repo.toLowerCase());
    const info = await repoInfo({ host, repo, run, api });
    if (info === null || found.some((f) => f.repo.toLowerCase() === info.repo.toLowerCase())) continue;
    if (await holdsState({ remoteUrl: hostUrl({ host, repo: info.repo }), gitPath, env, run })) found.push(info);
  }
  return found;
}

// Why a joining computer's answer found no repository, or several: said with what to type.
export function joinMissLine({ host, wanted, found }) {
  const where = host === 'gitlab' ? 'your GitLab account or your groups' : 'your GitHub account or your organisations';
  if (found.length === 0) return `Setup found no repository ${wanted} holding Wheelhouse's records on ${where}, so nothing was checked out: type the project's owner/name on step 3's question, which asks again`;
  return `More than one repository named ${wanted} holds Wheelhouse's records (${found.map((f) => f.repo).join(', ')}), so nothing was checked out: type the one you mean as owner/name on step 3's question, which asks again`;
}

// Checks the project out into this folder in place (ruling R77, as R34 connects a new product's):
// git init on its default branch, the remote added, that branch fetched, then checked out over the
// folder (checkout -f), so the committed .claude/settings.json replaces the one step 1's install
// wrote; that one is recorded first, its text as the value before. Files the project doesn't hold
// (this computer's settings.local.json) stay. Safe to repeat: once the folder has a commit it is
// left as it is. Fetched by its https address, never by the one the folder's origin names (R111).
export async function checkOutJoined({ folder, repo, remoteUrl, branch, gitPath, env, run, record }) {
  const git = setupGit({ run, gitPath, env: reaching(env, remoteUrl), cwd: folder, workTree: folder });
  const must = async (args, why) => {
    const done = await git(args);
    if (done.code !== 0) throw new Error(why);
    return done;
  };
  const origin = originUrl(folder);
  if (origin !== null && !sameRemote(origin, remoteUrl)) throw new Error('This folder is connected to another repository, so setup has left it as it is');
  if (origin === null) {
    const hadGit = fs.existsSync(path.join(folder, '.git'));
    record({ id: newId('chg'), kind: 'folder', target: path.join(folder, '.git'), before: hadGit ? { origin: null } : null, after: { origin: remoteUrl, branch, joined: repo } });
    if (!hadGit) await must(['init', '-q', '-b', branch], 'git could not start in this folder');
    await must(['remote', 'add', 'origin', remoteUrl], 'git could not name the project\'s repository in this folder');
  }
  await must(['fetch', '-q', remoteUrl, `+refs/heads/${branch}:refs/remotes/origin/${branch}`], 'git could not fetch the project');
  const head = await git(['rev-parse', '-q', '--verify', 'HEAD']);
  if (head.code !== 0) {
    // checkout -f writes over what is in its way, so the folder must still hold only step 1's
    // install (and the .git begun here): a file of the director's added since, at the top or among
    // the project's own files in .claude/, stops the step instead.
    const tracked = (await must(['ls-tree', '-r', '--name-only', `refs/remotes/origin/${branch}`, '--', '.claude'], 'git could not read the project')).stdout
      .split(/\r?\n/).filter(Boolean);
    const theirs = [
      ...fs.readdirSync(folder).filter((n) => n !== '.claude' && n !== '.git' && !SYSTEM_FILES.includes(n)),
      ...tracked.filter((f) => f !== '.claude/settings.json' && fs.existsSync(path.join(folder, ...f.split('/')))),
    ];
    if (theirs.length > 0) throw new Error(`This folder now holds files beside step 1's install (${theirs.slice(0, 5).join(', ')}), so setup has not checked the project out over them: move them aside, then ask again`);
    const settings = path.join(folder, '.claude', 'settings.json');
    const installed = readText(settings);
    const committed = await git(['show', `refs/remotes/origin/${branch}:.claude/settings.json`]);
    if (installed !== null && committed.code === 0 && committed.stdout !== installed) {
      record({ id: newId('chg'), kind: 'file', target: settings, before: installed, after: committed.stdout });
    }
    await must(['checkout', '-q', '-f', '-B', branch, `refs/remotes/origin/${branch}`], 'git could not check the project out into this folder');
  }
  await must(['branch', '-q', `--set-upstream-to=origin/${branch}`], 'git could not link the folder\'s branch to the project\'s');
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// The connection a repository is reached with, as the project record and profile.json keep it; on
// GitHub narrow, the project record's carries the app's installation on the project's account.
function connectionFor({ host, mode, repo, id, locked = false, installationId = null, base = DEFAULT_GITLAB }) {
  return {
    host,
    mode,
    project: repo,
    ...(host === 'gitlab' ? { baseUrl: base, ...(mode === 'narrow' ? { projectId: id } : {}) } : {}),
    ...(locked ? { locked: true } : {}),
    ...(host === 'github' && mode === 'narrow' && validId(installationId) ? { installationId } : {}),
  };
}

// Makes the repositories step 3 needs, each a `host` change recorded before it is made, so uninstall
// can offer to remove it: a private repository for a new product (a first commit on main), with the
// product's folder connected to it in place; then, while this computer has no profile, the private
// profile repository, always on the director's own account `user` (never the product's
// organisation or group), made only when the account has none, then profile.json in the shape
// scripts/profile/store.js reads, and the profile's clone, made again when an earlier attempt left
// it part-way. An existing product keeps its repository. `owner` is the product's owner (for a new
// product, `user`); `api` is GitLab's with the director's sign-in; `env` the director's git
// environment; `hostUrl` gives a repository's address on the GitLab at `base`. Gives the changes made.
export async function makeRepos({
  host, owner, user = owner, name, isNew, run = realRun, api, folder, record = () => {}, gitPath = 'git', env = {},
  hostUrl = httpsRemote, mode = 'quick', base = DEFAULT_GITLAB,
}) {
  const made = [];
  const keep = (change) => {
    record(change);
    made.push(change);
  };
  const ensure = async (account, repoName, readme) => {
    const repo = `${account}/${repoName}`;
    const target = `${host}:${repo}`;
    const found = await repoInfo({ host, repo, run, api });
    if (found !== null) {
      // A new product's name already taken on the account, by a repository setup didn't make, is not
      // taken over; the profile repository, made on another computer, is used as it is.
      if (readme && !madeBySetup(target)) throw new Error(`${repo} on ${NAME[host]} already exists, so setup has not used it for a new product: rename this folder, or connect it to that repository, then ask again`);
      return mustBePrivate(found, { host, profile: !readme });
    }
    keep({ id: newId('chg'), kind: 'host', target, before: null, after: { repository: repo, private: true, made: true } });
    return createRepo({ host, owner: account, name: repoName, readme, run, api });
  };
  if (isNew) {
    if (owner !== user) throw new Error('A new product\'s repository is made on your own account');
    const info = await ensure(user, name, true);
    await connectFolder({ folder, remoteUrl: hostUrl({ host, repo: info.repo, base }), gitPath, env, run, record: keep });
  }
  let profile = profileRemote();
  if (profile === null) {
    const info = await ensure(user, PROFILE_REPO, false);
    profile = { remoteUrl: hostUrl({ host, repo: info.repo, base }), host, repo: info.repo, connection: connectionFor({ host, mode, repo: info.repo, id: info.id, base }) };
    const file = profileFile();
    const text = `${JSON.stringify(profile, null, 2)}\n`;
    keep({ id: newId('chg'), kind: 'file', target: file, before: readText(file), after: text });
    writeText(file, text);
  }
  if (!profileCloneWhole()) {
    keep({ id: newId('chg'), kind: 'folder', target: profileDir(), before: fs.existsSync(profileDir()) ? {} : null, after: { clone: profile.remoteUrl, branch: PROFILE_BRANCH } });
    await refuseSettingsIn({ dir: profileDir(), run, gitPath });
    await ensureProfileClone({ remote: profile, env: reaching(env, profile.remoteUrl) });
  }
  return made;
}

// ---- The narrow connection ----

const GITHUB_API = 'https://api.github.com';

const validId = (id) => Number.isInteger(id) && id > 0;
// A GitHub repository's account, in lower case: the app's installation that reaches it is that
// account's.
const accountOf = (repo) => repo.split('/')[0].toLowerCase();

// The app's installations the signed-in director can reach (GET /user/installations), by the app's
// client ID or its name: { <account, lower case>: id }.
async function listInstallations({ accessToken, app, fetch }) {
  let response;
  try {
    response = await fetch(`${GITHUB_API}/user/installations?per_page=100`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch {
    throw new Error('Could not reach GitHub to find the app\'s installation');
  }
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to the list of the app's installations`);
  let body = null;
  try {
    body = await response.json();
  } catch { /* read below as no list */ }
  if (!Array.isArray(body?.installations)) throw new Error('GitHub\'s list of the app\'s installations could not be read');
  const found = {};
  for (const i of body.installations) {
    const login = i?.account?.login;
    if ((i?.client_id === app.clientId || i?.app_slug === app.slug) && typeof login === 'string' && validId(i.id)) found[login.toLowerCase()] = i.id;
  }
  return found;
}

// The app's installation on `account` (its login, whatever its case), or null while the app isn't
// installed there. Never another account's installation of the app (ruling R83).
export async function findInstallation({ accessToken, app, account, fetch = globalThis.fetch }) {
  if (typeof account !== 'string' || account === '') throw new Error('Setup needs the account to find the app\'s installation on');
  return (await listInstallations({ accessToken, app, fetch }))[account.toLowerCase()] ?? null;
}

// The installations kept keys hold, { <account, lower case>: id }, or null when they keep it only as
// `installationId` (a keys file written before installations were kept per account).
function keptInstallations(kept) {
  const map = kept?.installations;
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return null;
  return Object.fromEntries(Object.entries(map).filter(([, id]) => validId(id)));
}

// Whether kept keys hold an installation of their app, on any account.
const hasInstallation = (kept) => validId(kept?.installationId) || Object.keys(keptInstallations(kept) ?? {}).length > 0;

// Whether a key file is there, without reading what is in it into anything said.
function keyKept(name) {
  try {
    return readKey(name) !== null;
  } catch {
    return true;
  }
}

// The app's keys this computer keeps, when they are for this app; null otherwise. Nothing of the
// keys is said.
function keysFor(app) {
  let kept = null;
  try {
    kept = readKey('github-app');
  } catch { /* a damaged file is signed in again */ }
  return kept && kept.clientId === app?.clientId && typeof kept.accessToken === 'string' && kept.accessToken !== '' ? kept : null;
}

// How far this computer is with the app (design section 15): 'installed', its keys kept with the
// installation on `account` (the project's), so a later project needs only a tick on the
// installation's settings page; 'other-account', its keys kept with installations on other
// accounts only, so the Install page is next for this one, with no new code; 'signed-in', its keys
// kept without an installation (an Install page left unfinished), so the Install page is next, with
// no new code; or null, a code sign-in first. Keys kept before installations were kept per account
// read as 'installed' on any account; apply asks GitHub.
export function appKeysState(app, account = null) {
  const kept = keysFor(app);
  if (kept === null) return null;
  if (!hasInstallation(kept)) return 'signed-in';
  const map = keptInstallations(kept);
  if (typeof account === 'string' && account !== '' && map !== null && !validId(map[account.toLowerCase()])) return 'other-account';
  return 'installed';
}

// The client ID of the app whose keys this computer keeps with an installation (so they serve a
// project), or null. A damaged keys file serves nothing.
export function keptAppInstalled() {
  try {
    const kept = readKey('github-app');
    return kept && typeof kept.clientId === 'string' && hasInstallation(kept) ? kept.clientId : null;
  } catch {
    return null;
  }
}

// The words for the app a client ID names, for oneAppLine.
function appWords(clientId, { appFile, views }) {
  if (clientId === wheelhouseApp({ appFile })?.clientId) return 'the Wheelhouse app';
  const own = ownApp({ views });
  return own && own.clientId === clientId ? `your own app ${own.slug}` : 'another GitHub App';
}

// The app's keys this computer keeps, with the installation, or null.
export function keptAppKeys(app) {
  return appKeysState(app) === 'installed' ? keysFor(app) : null;
}

// An access key with more than this left is used for the Install page as it is; one nearer its end
// is signed in afresh (the code sign-in), since only the helper's connection renews it.
const FRESH_MS = 10 * 60 * 1000;

// Narrow on GitHub. With the app's keys and an installation kept, its reach is read at once.
// Otherwise: the code sign-in, unless keys for the app are kept and fresh (an earlier attempt's,
// whose Install page was not finished); the keys kept, with any installations they held. Each read
// of the reach asks GitHub which accounts the app is installed on and keeps each installation with
// the keys by its account (ruling R83), so a repository is read against its own account's
// installation, never another's. An account the app isn't installed on gets the Install page, with
// the account and its repositories to tick said, and its installation is looked for, for
// INSTALL_WAIT_MS from when the page opens. A repository an installation can't reach opens that
// installation's settings page, where the director ticks it, for INSTALL_WAIT_MS more. The reach is
// read back until every repository is reached, and said as it is. STOP is read in every wait
// (`halt`), and once the code sign-in has returned, before anything is kept. `startCode` asks for
// the sign-in's code: for the person's own app, ownAppCode, which reads the app again first. Gives
// the installation on each account of `repos`, { <account, lower case>: id }.
async function connectGithubApp({ app, repos, fetch, say, open, sleep, now, record, halt = () => {}, startCode }) {
  const named = repos.map((r) => `${r} on GitHub`).join(' and ');
  const onGithub = (list) => list.map((r) => `${r} on GitHub`);
  const waitFrom = () => {
    const until = now().getTime() + INSTALL_WAIT_MS;
    return (what) => {
      halt();
      if (now().getTime() >= until) throw new Error(`${what} after ${INSTALL_WAIT_MS / 60000} minutes; a fresh Go ahead asks again`);
    };
  };
  const previous = keysFor(app);
  let keys = previous;
  // The app's installations as GitHub lists them now, kept with the keys by account; the first one
  // that serves a project stays `installationId`, which readers of keys written before still use.
  const accounts = repos.map(accountOf);
  let listed = {};
  const lookUp = async () => {
    listed = await listInstallations({ accessToken: keys.accessToken, app, fetch });
    const kept = keptInstallations(keys) ?? {};
    const installations = { ...kept, ...listed };
    const first = validId(keys.installationId) ? keys.installationId : accounts.map((a) => installations[a]).find(validId);
    if (canonicalJson(installations) !== canonicalJson(kept) || first !== keys.installationId) {
      keys = { ...keys, clientId: app.clientId, ...(first === undefined ? {} : { installationId: first }), installations };
      writeKey('github-app', keys);
    }
    return listed;
  };
  // What the app can't reach yet: each repository on an account it isn't installed on, then each
  // its account's installation doesn't reach, with that installation's settings page.
  const reach = async () => {
    const found = await lookUp();
    const missing = [];
    for (const repo of repos) {
      const id = found[accountOf(repo)];
      if (!validId(id)) {
        missing.push({ repo, account: accountOf(repo), install: true });
        continue;
      }
      const got = await installationCovers({ host: 'github', mode: 'narrow', project: repo, installationId: id }, { fetch, now });
      if (!got.covered) missing.push({ repo, account: accountOf(repo), settingsUrl: got.settingsUrl });
    }
    return missing;
  };
  let missing = null;
  if (keys !== null && hasInstallation(keys)) {
    try {
      missing = await reach();
    } catch {
      keys = null; // they no longer work: signed in again below
    }
  }
  if (missing === null) {
    const fresh = keys !== null && (keys.accessExpiresAt == null || Date.parse(keys.accessExpiresAt) - now().getTime() > FRESH_MS);
    if (!fresh) {
      const code = await (startCode ?? (() => startDeviceSignIn({ clientId: app.clientId, fetch })))();
      say(`Type ${code.userCode} at ${code.verificationUri}, then click Authorise`);
      await open(code.verificationUri);
      const signed = await waitForSignIn({
        clientId: app.clientId, deviceCode: code.deviceCode, interval: code.interval, fetch, now,
        sleep: async (seconds) => { halt(); await sleep(seconds * 1000); },
      });
      halt();
      record({ id: newId('chg'), kind: 'host', target: 'key github-app', before: keyKept('github-app') ? { kept: true } : null, after: { key: 'github-app', clientId: app.clientId, app: app.slug } });
      // The installations the earlier keys held are the app's still: the new sign-in reaches them.
      const held = previous !== null && hasInstallation(previous)
        ? { ...(validId(previous.installationId) ? { installationId: previous.installationId } : {}), installations: keptInstallations(previous) ?? {} }
        : {};
      keys = { clientId: app.clientId, ...signed, ...held };
      writeKey('github-app', keys);
    }
    missing = await reach();
  }
  while (missing.length > 0) {
    const install = missing.find((m) => m.install);
    if (install) {
      const there = missing.filter((m) => m.install && m.account === install.account).map((m) => m.repo);
      const owner = install.repo.split('/')[0];
      say(`On the app's Install page, install it on ${owner}: choose Only select repositories, tick ${onGithub(there).join(' and ')} (not All repositories), then click Install`);
      await open(installUrl(app.slug));
      const late = waitFrom();
      for (;;) {
        if (validId((await lookUp())[install.account])) break;
        late('The app was not installed');
        await sleep(INSTALL_POLL_MS);
      }
      halt();
    } else {
      const page = missing[0].settingsUrl;
      const here = missing.filter((m) => m.settingsUrl === page).map((m) => m.repo);
      say(`The app can't reach ${onGithub(here).join(' or ')} yet: tick it on the page that opens, then click Save`);
      await open(page);
      const late = waitFrom();
      do {
        late(`The app still can't reach ${here.join(' or ')}`);
        await sleep(INSTALL_POLL_MS);
        missing = await reach();
      } while (missing.some((m) => !m.install && m.settingsUrl === page));
      continue;
    }
    missing = await reach();
  }
  say(`The app can reach ${named}, and nothing else you didn't tick`);
  return Object.fromEntries(repos.map((r) => [accountOf(r), listed[accountOf(r)]]));
}

// Narrow on GitLab: a project key at Developer level for each project, made with the director's own
// sign-in. Where GitLab refuses one (it answers 401 or 403: the sign-in or the plan may not make
// project keys; or the company's group has switched project keys off, makeProjectKey's code), its token page is opened and the token typed into the system's own box, straight to
// the keys file for every project still without a key: never the chat, an argument or a log. Any
// other failure (GitLab not reached, the project not found, a server error) stops the step plainly.
// A project already holding a key is left as it is.
async function connectGitlabKeys({ api, projects, owner, platform, say, open, askSecret, now, record, halt = () => {} }) {
  const keyName = (p) => `gitlab-project-${p.id}`;
  const keep = (p, kind, value) => {
    record({ id: newId('chg'), kind: 'host', target: `key ${keyName(p)}`, before: keyKept(keyName(p)) ? { kept: true } : null, after: { key: keyName(p), project: p.repo, kind } });
    writeKey(keyName(p), value);
  };
  let answered = null;
  const watched = { ...api, post: async (...args) => { answered = null; const got = await api.post(...args); answered = got.status; return got; } };
  const waiting = projects.filter((p) => !keyKept(keyName(p)));
  let refused = false;
  for (const p of [...waiting]) {
    let key;
    try {
      key = await makeProjectKey({ api: watched, projectId: p.id, name: KEY_NAME, days: KEY_DAYS, now });
    } catch (error) {
      if (answered !== 401 && answered !== 403 && !isKeysSwitchedOff(error)) throw error;
      refused = true;
      break;
    }
    keep(p, 'project-key', { kind: 'project-key', token: key.token, expiresAt: key.expiresAt, id: key.id });
    waiting.shift();
  }
  if (!refused || waiting.length === 0) return;
  say('GitLab would not make a project key, so make a token on the page that opens, then paste it into the box your computer shows: never into the chat');
  await open(tokenUrl({ host: 'gitlab', owner, repos: waiting.map((p) => p.repo), name: KEY_NAME, days: KEY_DAYS, base: api.baseUrl }));
  let token;
  try {
    token = await askSecret({ title: 'Wheelhouse: GitLab token', prompt: 'Paste the GitLab token you just made. It goes straight to Wheelhouse\'s keys, never the chat.' }, platform);
  } catch {
    throw new Error('No GitLab token was given, so the narrow connection is not set up; a fresh Go ahead asks again');
  }
  if (typeof token !== 'string' || token.trim() === '') throw new Error('No GitLab token was given, so the narrow connection is not set up; a fresh Go ahead asks again');
  halt();
  for (const p of waiting) keep(p, 'pasted-token', { kind: 'pasted-token', token: token.trim(), expiresAt: null });
}

// ---- Protection (planned here, switched on at step 7: Task 13) ----

// What the card says of protection.
export function protectionPlanLine(host) {
  return host === 'gitlab'
    ? 'protection on at step 7, with your sign-in ("pipelines must succeed" only where there is a pipeline)'
    : 'protection on at step 7, with your sign-in, where your GitHub plan allows';
}

// Switches the host's protection on with the director's own sign-in, never the narrow key (`run`
// with their environment for gh; `api`, GitLab's with their sign-in, for GitLab, where `repo` may
// be the project's number; `realUsers` is whether the project's phase is launched), then reads it back and says it as it is. On GitLab, `askPipelines`
// says the project has no pipeline, so "pipelines must succeed" was left off and the director is
// asked (design section 12.3).
export async function switchOnAsDirector({ host, repo, run = realRun, api, realUsers = false }) {
  await switchOnProtection({ host, repo, run, api, env: {}, realUsers });
  const read = await protectionStatus({ host, repo, run, api, env: {}, realUsers, director: true });
  if (host !== 'gitlab') return { available: read.available, on: read.on, line: read.line };
  const project = await api.get(projectPath(repo));
  const branch = project.body?.default_branch;
  const rule = typeof branch === 'string' ? await readGitlabProtection({ api, projectId: repo, branch }) : null;
  // `gaps` are each thing the read-back found that the director should hear, in plain words.
  return { available: read.available, on: read.on, line: read.line, askPipelines: rule?.pipelinesMustSucceed !== true, gaps: read.gaps ?? [] };
}

// ---- Step 3 ----

// A card is limited in length (CARD.chars), and a company's GitLab adds a certificate and a typed token to
// the list. The full wording is tried first, then the same parts in fewer words, then a last form whose
// length does not grow with the names (the address, the repository, the accounts): they are left off the
// card and stay in the changes, under the plan hash. Every form says that the certificate is for that
// address only with the checks on, and that the token is pasted into the computer's box, never the chat.
export function cardFor(given) {
  let last = null;
  for (const mode of ['full', 'tight', 'bare']) {
    const card = cardParts(given, mode);
    try {
      composeCard({ ...card, target: { step: 3, hash: '0'.repeat(64) } });
      return card;
    } catch (error) {
      if (!isTooLong(error)) throw error;
      last = error;
    }
  }
  throw last;
}

function cardParts({ host, changes, product, owner, user, way, app, signedIn, appKeys, twoAccounts = false, base = DEFAULT_GITLAB }, mode) {
  const tight = mode !== 'full';
  const bare = mode === 'bare';
  const name = NAME[host];
  if (bare) {
    // Names of any length stay off the card; the changes hold them.
    owner = owner == null ? owner : 'the project\'s account';
    user = user == null ? user : 'your own account';
    app = app === null || app === undefined ? app : { ...app, name: undefined, account: undefined };
  }
  const parts = [];
  if (changes.some((c) => c.action === 'certificate')) {
    parts.push(bare
      ? 'your company\'s own certificate for your GitLab\'s address, for that address only (certificate checks stay on)'
      : tight
      ? `your company's own certificate for ${base}, for that address only (certificate checks stay on)`
      : `your company's own certificate for ${base}, copied from this computer's own certificate store and given to Node.js, glab and git for that address only (certificate checks stay on)`);
  }
  const signing = changes.find((c) => c.action === 'sign-in');
  if (signing?.via === 'token') {
    parts.push(tight ? 'sign in with a token pasted into your computer\'s box, never the chat' : `sign in to ${name} with a token pasted into your computer's box, never the chat`);
    parts.push(tight
      ? 'for your company\'s GitLab admin: the browser sign-in, if wanted; not setup\'s job'
      : 'for your company\'s GitLab admin: register an application and give its id to glab here for the browser; the company\'s job, not setup\'s');
  } else if (!signedIn) parts.push(bare ? `sign in to ${name} in your browser` : `sign in to ${name} in your browser (no account? sign up at ${signUpUrl(host, base)})`);
  if (product.isNew) {
    const where = owner ? `${owner}/${product.name} on ${name}` : `${product.name} on your ${name} account`;
    parts.push(bare ? `a private repository on ${name}, connected to this folder` : tight ? `a private repository ${where}, connected to this folder` : `a private repository ${where} with a README, this folder connected to it, its files kept`);
  } else if (product.joining) {
    const accounts = host === 'gitlab' ? 'account or groups' : 'account or organisations';
    parts.push(bare ? `the repository holding Wheelhouse's records, checked out here with its settings`
      : tight ? `${product.repo ?? product.name}, the one holding Wheelhouse's records, checked out here with its settings`
        : `${product.repo ?? product.name} found on your ${name} ${accounts}, the one holding Wheelhouse's records, and checked out into this folder, its committed .claude/settings.json in place of the install's`);
  } else parts.push(bare ? `this project's repository on ${name}, kept as it is` : `${product.repo} on ${name}, kept as it is`);
  if (changes.some((c) => c.action === 'profile-repository')) parts.push(tight ? `your private profile repository ${PROFILE_REPO} if there is none` : `your private profile repository ${user ? `${user}/` : ''}${PROFILE_REPO} if there is none`);
  if (way === WAYS.quick) parts.push('Quick: your own sign-in, which reaches your whole account');
  else if (host === 'gitlab') parts.push(tight ? 'Developer project keys, or a token typed in your computer\'s box' : 'Developer project keys for the project and profile, or where GitLab refuses, a token typed in your computer\'s own box');
  else if (app === null) parts.push('your own GitHub App');
  else if (app.own && typeof app.clientId !== 'string' && product.joining) {
    // A joining computer's profile isn't here yet, so the app the first computer made can't be known.
    parts.push('your own GitHub App, made, or found in your profile: then a code and ticks on its Install page (not All repositories)');
  } else if (app.own && typeof app.clientId !== 'string') {
    parts.push(`your own GitHub App${app.name ? ` ${app.name} on ${app.account}` : ''}, filled in from Wheelhouse's: tick Enable Device Flow, click Create, then a code and ticks on its Install page (not All repositories); kept in your profile`);
  } else if (appKeys === 'installed') parts.push(`${app.own ? 'your own app' : 'the Wheelhouse app'}, as signed in already: tick this project on its settings page if it is not ticked, or on its Install page if the app is not on ${owner ?? 'its account'} yet`);
  else if (appKeys === 'other-account') parts.push(`${app.own ? 'your own app' : 'the Wheelhouse app'}, as signed in already: install it on ${owner} and tick this project on its Install page, not All repositories, or on its settings page if it is there already`);
  else {
    // The project on an organisation and the profile on the director's own account: GitHub installs
    // an app on each account, so the Install page comes once for each.
    const ticks = twoAccounts
      ? `tick the project on its Install page for ${owner}, then the profile on it again for ${user ?? 'your own account'}, not All repositories`
      : 'tick the project and profile on its Install page, not All repositories';
    parts.push(`${app.own ? 'your own app' : 'the Wheelhouse app'}${appKeys === 'signed-in' ? ', as signed in already: ' : ': a code on GitHub, then '}${ticks}`);
  }
  parts.push(tight ? 'the project\'s record' : 'the project\'s record and state branch');
  if (changes.some((c) => c.action === 'enrolment')) parts.push(ENROLMENT_PART);
  // A joining computer's project already has its protection, from the first computer's step 7.
  if (!product.joining) parts.push(tight && host === 'gitlab' ? 'protection on at step 7, with your sign-in' : protectionPlanLine(host));
  return {
    kind: 'setup',
    level: 3,
    what: `Setup step 3, ${SETUP_TITLES[3]}: ${parts.join('; ')}.`,
    why: 'Agents reach the host only through Wheelhouse\'s helper, as chosen.',
    options: [
      { label: SETUP_LABEL, says: 'Setup does what is listed, saying what to do as it comes.' },
      { label: 'Not now', says: 'Nothing is made yet.' },
    ],
    recommend: SETUP_LABEL,
    because: 'the next steps need the project on the host',
    meanwhile: 'Nothing is made yet.',
  };
}

function directorFor({ signedIn, way, host, app, appKeys, joining = false, twoAccounts = false, via = null }) {
  const parts = ['One click'];
  if (!signedIn) parts.push(via === 'token' ? 'a token made on your company\'s GitLab page and pasted into your computer\'s box' : 'your sign-in in the browser');
  if (way !== WAYS.quick && host === 'github' && app !== null) {
    if (app.own && typeof app.clientId !== 'string' && joining) parts.push('a code typed on GitHub, Authorise, and two ticks on the Install page (and, if your app is not in your profile, Enable Device Flow ticked and Create clicked first)');
    else if (app.own && typeof app.clientId !== 'string') parts.push('Enable Device Flow ticked and Create clicked on GitHub, a code typed on GitHub, Authorise, and two ticks on the Install page');
    else if (appKeys === 'installed') parts.push('a tick on the app\'s settings page, if the project is not ticked (or on its Install page, if the app is not on the project\'s account yet)');
    else if (appKeys === 'other-account') parts.push('a tick on the app\'s Install page for the project\'s account (or on its settings page, if the app is there already)');
    else if (appKeys === 'signed-in') parts.push(twoAccounts ? 'a tick on the app\'s Install page for the project\'s account, then one on it for your own account' : 'two ticks on the app\'s Install page');
    else parts.push(twoAccounts ? 'a code typed on GitHub, Authorise, then a tick on the Install page for the project\'s account and one on it for your own account' : 'a code typed on GitHub, Authorise, and two ticks on the Install page');
  }
  return parts.join(', then ');
}

// Step 3. `run`, `fetch`, `sleep`, `open` and `askSecret` are its ways out, for tests; `appFile`
// where Wheelhouse's app is read from; `hostUrl` a repository's address; `findGit` the git step 2
// found; `views` the profile's views the plan reads their own app from, and `profileRoutes` the
// profile's write and views routes apply records it through.
export function hostStep({
  run = realRun, fetch = globalThis.fetch, sleep = pause, open, askSecret = realAskSecret, appFile = APP_FILE,
  hostUrl = httpsRemote, findGit = async ({ platform }) => (await toolsStatus({ platform, run, tools: ['git'] })).git,
  gitlab = ({ run: r, fetch: f, baseUrl }) => directorGitlabApi({ run: r, fetch: f, baseUrl }),
  profileRoutes = null, views = readProfileViews,
  // Whether GitLab's certificate is trusted from here, and how the company's is given to the tools
  // (company-ca.js, tools.js): stand-ins in tests.
  certificateProbe = probeCertificate, trustCertificate = applyCompanyCa,
} = {}) {
  // The profile's routes through the helper, for the person's own app's record: `profileRoutes`
  // stands in for them in tests; otherwise made when apply needs them.
  const profileFor = () => profileRoutes ?? helperProfile();
  return {
    n: 3,
    title: SETUP_TITLES[3],
    long: true,
    after: [2],
    asksDuring: [2],
    async plan(ctx) {
      const platform = ctx.platform ?? process.platform;
      const answers = ctx.answers ?? {};
      const answer = (id) => answers[`3.${id}`] ?? null;
      // A computer joining a product set up on another (ruling R77): asked first, in a folder
      // holding only step 1's install.
      const join = joinChoice(ctx);
      if (join?.ask) return { ask: join.ask };
      const product = join === null ? productOf(ctx.folder, { config: readGitlabHosts(ctx.folder) })
        : { isNew: false, joining: true, host: null, repo: join.join.includes('/') ? join.join : join.known, name: join.join.split('/').at(-1) };
      // Real users and Locked are the first computer's questions; a joining computer reads the
      // phase from the project's state, and its step 8 asks Locked.
      let realUsers = false;
      let locked = false;
      if (!product.joining) {
        if (answer('real-users') === null) return { ask: realUsersAsk(product.name) };
        realUsers = answer('real-users').label === REAL_USERS.yes;
        const lockable = realUsers && platform === 'darwin';
        if (lockable && answer('locked') === null) return { ask: lockedAsk(product.name) };
        locked = lockable && answer('locked').label === LEVELS.locked;
      }
      // A launched project a computer joins is never offered Quick, once its state here says so
      // (an earlier attempt cloned it); before then, apply refuses Quick once it has.
      const launched = product.joining && product.repo !== null && launchedIn(slugFor(product.repo));
      let host = product.host;
      if (host === null) {
        if (answer('host') === null) return { ask: hostAsk(product.name) };
        host = answer('host').label === HOST_LABELS.gitlab ? 'gitlab' : 'github';
      }
      const where = product.isNew ? `the new private repository ${product.name} on ${NAME[host]}` : `${product.repo ?? product.name} on ${NAME[host]}`;
      // On a Mac, Quick first and the narrow ways behind Make it stricter; elsewhere a narrow way
      // recommended. A joining computer can't know the phase before its state is cloned, so its
      // card counts as one with real users. A card with one way (Locked or launched, on GitLab, or
      // on GitHub with no Wheelhouse app) is no choice, and AskUserQuestion can't show it: that way
      // is taken, and step 3's Go-ahead card lists it.
      const card = connectionCard({ host, locked, launched, realUsers: realUsers || launched || product.joining === true, platform, where, appFile });
      let way = card.options[0].label;
      if (card.options.length > 1) {
        const id = `connection-${digest(card)}`;
        const got = answer(id);
        if (got === null || !card.options.some((o) => o.label === got.label)) return { ask: { id, card } };
        way = got.label;
        if (way === STRICTER) {
          way = stricterWay({ host, appFile });
          if (way === null) {
            const stricter = stricterCard({ where, appFile });
            const sid = `connection-stricter-${digest(stricter)}`;
            const chosen = answer(sid);
            if (chosen === null || !stricter.options.some((o) => o.label === chosen.label)) return { ask: { id: sid, card: stricter } };
            way = chosen.label;
          }
        }
      }
      const mode = way === WAYS.quick ? 'quick' : 'narrow';
      const base = product.base ?? DEFAULT_GITLAB;
      const { signedIn, user } = await signInStatus({ host, run, base });
      const owner = product.isNew ? user : (product.repo === null ? null : product.repo.split('/').slice(0, -1).join('/'));
      const repo = product.isNew ? (user ? `${user}/${product.name}` : null) : product.repo;
      let app = null;
      if (mode === 'narrow' && host === 'github') {
        if (way === WAYS.own) {
          // Their own app: the one their profile records, confirmed, when it belongs to the account
          // that holds the project; else one made (or found) on that account at apply. A new
          // product's account is the director's, known once they are signed in.
          const own = ownApp({ views });
          // Their accepted app hidden by a change waiting is never made again (rulings R84, R115):
          // setup's own proposal of it waits for its Confirm; any other change gets a card that
          // proposes the accepted app again, and nothing else.
          const shadowed = own === null ? ownAppShadowed({ views }) : null;
          if (shadowed !== null && sameApp(shadowed.waiting, shadowed.accepted)) return { wait: OWN_APP_WAIT_MS, why: ownAppWaiting(shadowed) };
          if (shadowed !== null) {
            return {
              changes: [{ kind: 'host', target: PROFILE_TARGET, action: 'own-app-again', app: shadowed.accepted, waiting: shadowed.waiting }],
              card: ownAppAgainCard(shadowed),
              director: 'One click, then Confirm on your app\'s card',
            };
          }
          if (own && owner && !sameLogin(own.owner, owner)) return { wait: OWN_APP_WAIT_MS, why: ownAppElsewhere(own, where) };
          app = own ? { clientId: own.clientId, slug: own.slug, own: true, owner: own.owner }
            : { own: true, account: owner ?? null, name: owner ? appName(owner) : null };
        } else {
          const wheelhouse = wheelhouseApp({ appFile });
          // Offered only while it is registered, and a changed card is asked again: never here.
          if (wheelhouse === null) throw new Error(NO_APP_LISTED);
          app = { clientId: wheelhouse.clientId, slug: wheelhouse.slug, own: false };
        }
      }
      // One app's keys per computer (ruling R58): a project on another app than the one whose keys
      // serve the earlier projects waits. On the make route the app is looked up by its name, when
      // the director is signed in; one not made yet is another app.
      const keptId = app === null ? null : keptAppInstalled();
      if (keptId !== null) {
        let using = app.clientId;
        if (typeof using !== 'string' && signedIn && typeof app.name === 'string') {
          try {
            using = (await readOwnApp({ slug: appSlug(app.name), run })).clientId;
          } catch (error) {
            using = error?.code === 'not-found' ? null : undefined;
          }
        }
        if (using !== undefined && using !== keptId) {
          return { wait: OWN_APP_WAIT_MS, why: oneAppLine({ kept: appWords(keptId, { appFile, views }), using: app.own ? 'your own app' : 'the Wheelhouse app', where }) };
        }
      }
      // How far this computer is with the app: a later project needs no new code (design section 15).
      const appKeys = typeof app?.clientId === 'string' ? appKeysState(app, owner) : null;
      // The Wheelhouse app for a project on an organisation, with the profile on the director's own
      // account joining it: an Install page for each account.
      const profileNow = profileRemote();
      const profileJoins = profileNow === null || (profileNow.connection?.mode === 'narrow' && profileNow.host === host);
      const twoAccounts = app !== null && !app.own && typeof owner === 'string' && typeof user === 'string' && !sameLogin(owner, user) && profileJoins;
      const changes = [];
      // A company's GitLab whose certificate this computer does not trust: the company's own is given
      // first, for that address only. With the file made already, the question is whether it covers
      // GitLab's certificate (an authority added since, or glab not having taken it, shows here), and the
      // certificates are read again from the computer's store.
      if (host === 'gitlab' && base !== DEFAULT_GITLAB && await certificateProbe({ fetch, base, home: wheelhouseHome() }) === 'certificate') {
        changes.push({ kind: 'host', target: host, action: 'certificate', base, ...(fs.existsSync(caFile(wheelhouseHome())) ? { refresh: true } : {}) });
      }
      // A company's GitLab with no OAuth application registered has no browser sign-in: the change says
      // the way is a typed token (signInRoute), and the card says what the browser way would need.
      if (!signedIn) {
        const via = host === 'gitlab' && base !== DEFAULT_GITLAB && await signInRoute({ run, base }) === 'token' ? 'token' : null;
        changes.push({ kind: 'host', target: host, action: 'sign-in', ...(via === null ? {} : { via }) });
      }
      if (product.isNew) {
        changes.push({ kind: 'host', target: host, action: 'repository', name: product.name, repo, private: true });
        changes.push({ kind: 'folder', target: ctx.folder, action: 'connect', branch: 'main' });
      }
      if (product.joining) {
        // Once an attempt found the repository, the list names it, so every retry uses it (R102).
        changes.push({ kind: 'host', target: host, action: 'join', name: product.repo ?? join.join });
        changes.push({ kind: 'folder', target: ctx.folder, action: 'checkout' });
      }
      if (profileRemote() === null) {
        changes.push({ kind: 'host', target: host, action: 'profile-repository', repo: user ? `${user}/${PROFILE_REPO}` : null });
        changes.push({ kind: 'file', target: profileFile(), action: 'profile' });
      }
      // The profile's clone, also when an earlier attempt left it part-way.
      if (profileRemote() === null || !profileCloneWhole()) changes.push({ kind: 'folder', target: profileDir(), action: 'profile-clone' });
      // Their own app, made or found, and kept in the profile.
      if (app?.own && typeof app.clientId !== 'string') changes.push({ kind: 'host', target: 'github', action: 'own-app', account: app.account, name: app.name });
      changes.push({
        kind: 'host', target: host, action: 'connection', mode, locked, ...(host === 'gitlab' && base !== DEFAULT_GITLAB ? { base } : {}),
        ...(mode === 'narrow' && host === 'github' ? { app, ...(appKeys === null ? {} : { appKeys }) } : {}),
      });
      const slug = repo === null ? null : slugFor(repo);
      changes.push({ kind: 'file', target: slug === null ? path.join(wheelhouseHome(), 'projects') : projectFile(slug), action: 'project', repo });
      changes.push({ kind: 'folder', target: slug === null ? path.join(wheelhouseHome(), 'projects') : stateDir(slug), action: 'state', repo });
      // This computer's key, in the profile for the director's other computers (ruling R79).
      changes.push(enrolmentChange({ host }));
      return {
        changes,
        card: cardFor({ host, changes, product, owner, user, way, app, signedIn, appKeys, twoAccounts, base }),
        director: directorFor({ signedIn, way, host, app, appKeys, joining: product.joining === true, twoAccounts, via: changes.find((c) => c.action === 'sign-in')?.via ?? null }),
      };
    },

    async apply(ctx, changes) {
      const platform = ctx.platform ?? process.platform;
      const now = ctx.now ?? (() => new Date());
      const say = typeof ctx.say === 'function' ? ctx.say : () => {};
      const { record } = ctx;
      // STOP stops the step between its parts and while it waits; what it made stays recorded.
      const stopped = () => ctx.stopped?.() === true;
      const halt = () => {
        if (stopped()) throw new Error(STOPPED);
      };
      halt();
      const opener = open ?? ((url) => openPage(url, { platform, run }));
      // Their own app proposed again, and nothing else (ruling R115): only while the profile still
      // holds that app as accepted, hidden by a change waiting. The step then stops, saying so, so
      // step 3 is asked again once the director has confirmed.
      const again = changes.find((c) => c.action === 'own-app-again') ?? null;
      if (again !== null) {
        if (changes.length !== 1) throw new Error('Step 3\'s list proposes your own app again beside other changes, so nothing was done: ask for step 3\'s card again');
        const shadow = shadowedOwnApp(await profileFor().views());
        if (shadow === null || !sameApp(shadow.accepted, again.app)) throw new Error('Your profile has changed since the card, so nothing was proposed: ask for step 3\'s card again');
        await recordOwnApp(shadow.accepted, { record, profile: profileFor() });
        throw new Error(ownAppProposedAgain(shadow.accepted));
      }
      const connection = changes.find((c) => c.action === 'connection');
      if (!connection) throw new Error('Step 3\'s list names no connection');
      const host = connection.target;
      const base = host === 'gitlab' && typeof connection.base === 'string' ? checkBaseUrl(connection.base) : DEFAULT_GITLAB;
      const urlFor = (a) => hostUrl({ ...a, base });
      const narrowApp = host === 'github' && connection.mode === 'narrow' ? connection.app : null;
      if (narrowApp !== null && typeof narrowApp?.clientId !== 'string' && !(narrowApp?.own === true && changes.some((c) => c.action === 'own-app'))) throw new Error(NO_APP_LISTED);
      // The product as the list names it, never read again from the folder, which this step changes.
      const made = changes.find((c) => c.action === 'repository') ?? null;
      const recorded = changes.find((c) => c.action === 'project');
      const join = changes.find((c) => c.action === 'join') ?? null;
      if (join !== null && (typeof join.name !== 'string' || repoNamed(join.name) !== join.name)) throw new Error('Step 3\'s list names no repository to join');
      if (made === null && join === null && typeof recorded?.repo !== 'string') throw new Error('Step 3\'s list names no repository');
      // Whether this computer is joining a product, recorded before anything else is done (ruling
      // R77), so the run's steps are a joining computer's from here on, before step 4's or 5's
      // questions could come; a new product chosen after a joining attempt records that it is not.
      const answerRecord = (after) => record({ id: newId('chg'), kind: 'answer', target: `step ${JOIN_STEP}`, before: null, after });
      // A folder checked out to a joined repository stays joined to it (ruling R102): never set up
      // as a new product or an existing one of its own, and never joined to another repository.
      const thisRun = readJournal().runs.find((r) => r?.id === ctx.runId) ?? null;
      const fixed = joinedFolder(ctx.folder, thisRun);
      if (fixed !== null && (join === null || join.name.toLowerCase() !== fixed.toLowerCase())) {
        throw new Error(`This folder is checked out to ${fixed} from your other computer, so setup goes on joining it and nothing else: ask for step 3's card again`);
      }
      if (join !== null) answerRecord({ joined: join.name });
      else if (joinedRepo(thisRun) !== null) answerRecord({ joined: null });
      // The company's certificate comes before anything reaches the host. The address is the connection's
      // own, checked before anything is run; the certificate and glab's setting are made, and the git
      // settings for that address kept in the journal (git gets them in the environment of its calls).
      const certificate = changes.find((c) => c.action === 'certificate') ?? null;
      if (certificate !== null) {
        if (host !== 'gitlab' || certificate.base !== base) throw new Error('Step 3\'s list gives a certificate for an address other than the connection\'s, so nothing was done: ask for step 3\'s card again');
        const given = await trustCertificate({
          base, platform, run, refresh: certificate.refresh === true,
          // The staged certificates alone, tried against GitLab before they are kept (company-ca.js).
          verify: ({ file }) => certificateProbe({ fetch, base, file }),
        });
        record({
          id: newId('chg'), kind: 'answer', target: `step 3: the company's certificate`, before: null,
          after: { certificate: { base, file: given.file, glabHost: given.glabHost, gitConfig: given.gitConfig } },
        });
        throw new Error(CERTIFICATE_GIVEN(base));
      }
      const git = await findGit({ platform, run });
      if (!git?.ok || typeof git.path !== 'string') throw new Error('git is not on this computer yet; step 2 installs it');
      const gitEnv = directorGitEnv({ host, gitPath: git.path, platform, base });
      const { user } = await signIn({ host, run, say, stopped, base, open: opener, askSecret, platform });
      // A repository the card named on one account is never made on another.
      for (const c of changes.filter((x) => (x.action === 'repository' || x.action === 'profile-repository') && typeof x.repo === 'string')) {
        if (c.repo.split('/')[0] !== user) throw new Error(`You are signed in to ${NAME[host]} as ${user}, not the account the card named; ask for step 3's card again`);
      }
      halt();
      const api = host === 'gitlab' ? await gitlab({ run, fetch, baseUrl: base }) : null;
      // The product a joining computer's answer names: exactly one repository holding Wheelhouse's
      // records, or a refusal saying to type owner/name, recorded so the question asks again.
      let joined = null;
      if (join !== null) {
        const found = await findJoined({ host, wanted: join.name, user, run, api, gitPath: git.path, env: gitEnv, hostUrl: urlFor });
        // The repository this folder is checked out to is checked again, never searched for.
        if (fixed !== null && found.length !== 1) {
          throw new Error(`${fixed} on ${NAME[host]} can't be found with your sign-in, or no longer holds Wheelhouse's records, so setup has stopped: this folder is checked out to it and joins nothing else; check the repository on ${NAME[host]}, then a fresh Go ahead tries again`);
        }
        if (found.length !== 1) {
          answerRecord({ joined: join.name, missed: found.length === 0 ? 'none' : found.map((f) => f.repo) });
          throw new Error(joinMissLine({ host, wanted: join.name, found }));
        }
        [joined] = found;
        // A public project is refused before this folder is checked out or the profile made.
        mustBePrivate(joined, { host });
        answerRecord({ joined: joined.repo, found: true });
        halt();
      }
      const projectRepo = joined !== null ? joined.repo : made === null ? recorded.repo : `${user}/${made.name}`;
      const projectOwner = made === null ? projectRepo.split('/').slice(0, -1).join('/') : user;
      // Their own app, as recorded, belongs to the project's account; one to make is made on the
      // account the card named.
      if (narrowApp?.own && typeof narrowApp.clientId === 'string' && !sameLogin(narrowApp.owner, projectOwner)) {
        throw new Error(ownAppElsewhere(narrowApp, `${projectRepo} on ${NAME[host]}`));
      }
      if (narrowApp?.own && typeof narrowApp.account === 'string' && !sameLogin(narrowApp.account, projectOwner)) {
        throw new Error(`You are signed in to ${NAME[host]} as ${user}, not the account the card named; ask for step 3's card again`);
      }
      // An app of their own on an organisation reaches only that organisation's repositories, never
      // the profile on the director's own account.
      const appReachesProfile = !narrowApp?.own || sameLogin(narrowApp.owner ?? projectOwner, user);
      // An existing product's repository must be private before anything of Wheelhouse's goes near
      // it, and must hold a branch of its own before the state branch goes up, or the state branch
      // would become its default (ruling R34).
      if (made === null && joined === null) {
        const existing = await repoInfo({ host, repo: projectRepo, run, api });
        if (existing !== null) mustBePrivate(existing, { host });
      }
      if (made === null && joined === null) await productBranchOn({ host, repo: projectRepo, remoteUrl: urlFor({ host, repo: projectRepo }), gitPath: git.path, env: gitEnv, run });
      // A joining computer's folder, checked out to the project in place, on its default branch.
      if (joined !== null) {
        const branch = joined.defaultBranch;
        if (typeof branch !== 'string' || branch === '' || WHEELHOUSE_BRANCHES.includes(branch)) {
          throw new Error(`${joined.repo}'s default branch on ${NAME[host]} is ${branch || 'not set'}, not a branch of the product's, so setup has not checked it out: make the product's own branch the default in the repository's settings, then ask again`);
        }
        await checkOutJoined({ folder: ctx.folder, repo: joined.repo, remoteUrl: urlFor({ host, repo: joined.repo }), branch, gitPath: git.path, env: gitEnv, run, record });
        halt();
      }
      // The product under its owner; the profile always on the director's own account.
      await makeRepos({
        host, owner: projectOwner, user, name: projectRepo.split('/').at(-1), isNew: made !== null,
        run, api, folder: ctx.folder, record, gitPath: git.path, env: gitEnv, hostUrl, mode: appReachesProfile ? connection.mode : 'quick', base,
      });
      const project = await repoInfo({ host, repo: projectRepo, run, api });
      if (project === null) throw new Error(`${projectRepo} on ${NAME[host]} can't be found with your sign-in`);
      mustBePrivate(project, { host });
      const profile = profileRemote();
      if (profile === null) throw new Error('The profile could not be read back after it was written');
      halt();
      const slug = slugFor(project.repo);
      const remoteUrl = urlFor({ host, repo: project.repo });
      const cloneRecords = async () => {
        record({ id: newId('chg'), kind: 'folder', target: stateDir(slug), before: fs.existsSync(stateDir(slug)) ? {} : null, after: { clone: remoteUrl, branch: STATE_BRANCH } });
        await refuseSettingsIn({ dir: stateDir(slug), run, gitPath: git.path });
        await cloneState({ project: slug, remoteUrl, env: reaching(gitEnv, remoteUrl) });
      };
      // A joining computer clones the project's state before anything is connected or registered,
      // and its `phase` refuses Quick on a launched project (design section 11).
      if (joined !== null) {
        await cloneRecords();
        if (connection.mode === 'quick' && launchedIn(slug)) throw new Error(quickLaunched(project.repo));
        halt();
      }
      // The app's installation on the project's account, kept in its record (ruling R83).
      let installationId = null;
      if (connection.mode === 'narrow') {
        // The profile's own repository joins when its connection is narrow on this host too.
        const withProfile = profile.connection?.mode === 'narrow' && profile.host === host && profile.repo !== project.repo;
        if (host === 'github') {
          // The app the card named, by its client ID and name; or their own, made or found now.
          let app = narrowApp;
          const own = app.own === true;
          if (own && typeof app.clientId !== 'string') {
            let recorded = null;
            try {
              recorded = ownAppFrom(await profileFor().views());
            } catch { /* found again on GitHub by its name */ }
            const found = await ensureOwnApp({
              account: projectOwner, user, name: app.name ?? appName(projectOwner), recorded, run, say, open: opener, sleep, now, halt,
            });
            app = { clientId: found.clientId, slug: found.slug, own: true, owner: found.owner };
          } else if (own) {
            // The recorded app, at use: GitHub's owner must be the record's and the project's (R57).
            await checkOwnApp({ app, account: projectOwner, run });
          }
          if (typeof app.slug !== 'string') throw new Error(NO_APP_LISTED);
          // One app's keys per computer (ruling R58): never overwrite keys serving another app.
          const keptId = keptAppInstalled();
          if (keptId !== null && keptId !== app.clientId) {
            throw new Error(oneAppLine({ kept: appWords(keptId, { appFile, views }), using: own ? 'your own app' : 'the Wheelhouse app', where: `${project.repo} on ${NAME[host]}` }));
          }
          const installations = await connectGithubApp({
            app, repos: [project.repo, ...(withProfile && appReachesProfile ? [profile.repo] : [])], fetch, say, open: opener, sleep, now, record, halt,
            ...(own ? { startCode: () => ownAppCode({ app, account: projectOwner, run, fetch, say, open: opener, sleep, now, halt }) } : {}),
          });
          installationId = installations[accountOf(project.repo)] ?? null;
          // Their own app, once connected, kept in the profile for their other computers.
          if (own) {
            halt();
            await recordOwnApp({ clientId: app.clientId, slug: app.slug, owner: app.owner }, { record, profile: profileFor() });
          }
        } else {
          const profileProject = withProfile ? await repoInfo({ host, repo: profile.repo, run, api }) : null;
          await connectGitlabKeys({
            api, projects: [project, ...(profileProject ? [profileProject] : [])], owner: user, platform, say, open: opener, askSecret, now, record, halt,
          });
        }
      }
      halt();
      const kept = { folder: ctx.folder, remoteUrl, host, repo: project.repo, connection: connectionFor({ host, mode: connection.mode, repo: project.repo, id: project.id, locked: connection.locked === true, installationId, base }) };
      const file = projectFile(slug);
      record({ id: newId('chg'), kind: 'file', target: file, before: readText(file), after: `${JSON.stringify(kept, null, 2)}\n` });
      writeProject(slug, kept);
      if (joined === null) await cloneRecords();
      // This computer's key, put in the profile with the director's own sign-in (ruling R79).
      const enrolment = changes.find((c) => c.action === 'enrolment') ?? null;
      if (enrolment !== null) {
        halt();
        await publishEnrolment({
          profile, listed: enrolment, gitPath: git.path, env: directorGitEnv({ host: Object.hasOwn(TOOL, profile.host) ? profile.host : host, gitPath: git.path, platform, base: gitlabBaseOf(profile) ?? undefined }), run, record, now,
        });
      }
      say(`Connected: ${project.repo} on ${NAME[host]}, ${connection.mode === 'quick' ? 'Quick' : 'narrow'}`);
      return [];
    },
  };
}
