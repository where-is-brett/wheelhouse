// scripts/setup/own-app.js
// The person's own GitHub App (design section 11, Card 1's answer; Task 8b), for organisations that
// block third-party apps or people who trust nobody else.
//
// Setup opens GitHub's new-app page with every field filled in by URL parameter from Wheelhouse's
// manifest (scripts/host/app-manifest.json), the same form check 20 used. GitHub's manifest flow
// would make a private key and a client secret and need a page served on this computer; the link
// makes neither. The one box GitHub can't fill in is Enable Device Flow: the person ticks it, then
// clicks Create. Their app is always private (`public=false`, ruling R8), whatever the manifest
// says, so it can be installed only on the account that owns it: the account that holds the
// project. Its name is Wheelhouse and that account, so setup finds it again by its name.
//
// Setup reads the app back with the director's own sign-in (`gh api /apps/<slug>`) and refuses it
// when it asks for more than the manifest, or for Workflows, Administration or Secrets at all. It
// reads it again before each code sign-in with it, on every computer, since the app's owner can
// widen its permissions on GitHub at any time; a refusal stops the sign-in and names what grew.
// A first code sign-in that GitHub refuses as "device flow disabled" is said as "Tick Enable Device
// Flow on your app's page", with that page opened, and the code asked for again.
//
// The app is recorded in the director's profile as the setting `own-github-app` { clientId, slug,
// owner } (ruling R56), so each of their computers uses it. It is written through the helper's
// profile route, with its words, and takes effect once the director confirms it by the profile's
// own route: board-context.js's learn() puts the setting's confirm card (settingCard) in the
// project, the director clicks Confirm, and the prompt record signs a confirmation of that event,
// which the helper's /profile/record keeps. Until then appFor() ignores it. The keys file's
// `github-app` entry holds the sign-in's keys, not the app, and has its own undo.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run as realRun } from '../lib/run.js';
import { toolPath } from '../lib/host-tools.js';
import { canonicalJson } from '../lib/canonical.js';
import { startDeviceSignIn } from '../host/github-app.js';
import { helperClient } from '../host/helper-client.js';
import { OWN_GITHUB_APP_KEY, OWN_APP_CLIENT_ID, isAllowed } from '../settings/catalogue.js';
import { settingWords } from '../settings/effective.js';
import { newId } from './journal.js';

export const MANIFEST_FILE = fileURLToPath(new URL('../host/app-manifest.json', import.meta.url));
// Permissions the app is never given, whatever anyone asks.
export const NEVER = Object.freeze(['workflows', 'administration', 'secrets']);
// GitHub's longest app name.
export const NAME_CHARS = 34;
// How long setup waits for the app to be made on its page, and for Enable Device Flow to be
// ticked, and how often it looks.
export const APP_WAIT_MS = 8 * 60 * 1000;
export const APP_POLL_MS = 5 * 1000;
export const DEVICE_FLOW_OFF = 'Tick Enable Device Flow on your app\'s page, then click Save changes';
export const PROFILE_TARGET = `profile ${OWN_GITHUB_APP_KEY}`;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const RANK = { read: 1, write: 2, admin: 3 };
const WORDS = { workflows: 'Workflows', administration: 'Administration', secrets: 'Secrets' };

const same = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
export const sameLogin = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function quietly(run, file, args, options) {
  try {
    return await run(file, args, options);
  } catch {
    return { code: 1, stdout: '', stderr: '' };
  }
}

const gh = (run, args) => quietly(run, toolPath('gh'), args, {});

// ---- The manifest and the new-app link ----

// Wheelhouse's app manifest: the one description of its app, for Wheelhouse's own and a person's.
export function readManifest(file = MANIFEST_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The app's name on GitHub for an account: Wheelhouse and the account, within GitHub's limit.
export function appName(account) {
  if (!LOGIN.test(account ?? '')) throw new Error('A GitHub account name may use letters, digits and dashes only');
  return `Wheelhouse ${account}`.slice(0, NAME_CHARS).trim();
}

// The address name GitHub gives an app from its name: lower case, anything but letters and digits
// a dash.
export function appSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// GitHub's new-app page, for the signed-in account (`{ kind: 'user' }`) or one of its organisations
// (`{ kind: 'org', login }`), with every field filled in from the manifest, and public=false
// whatever the manifest says: a person's own app is installed only on the account that owns it.
export function newAppUrl({ manifest = readManifest(), owner = { kind: 'user' }, name }) {
  if (typeof name !== 'string' || name.trim() === '' || name.length > NAME_CHARS) throw new Error(`An app's name is 1 to ${NAME_CHARS} characters`);
  let page;
  if (owner?.kind === 'org') {
    if (!LOGIN.test(owner.login ?? '')) throw new Error('An organisation\'s name may use letters, digits and dashes only');
    page = new URL(`https://github.com/organizations/${owner.login}/settings/apps/new`);
  } else if (owner?.kind === 'user') {
    page = new URL('https://github.com/settings/apps/new');
  } else {
    throw new Error('An app is made on an account or an organisation');
  }
  const permissions = Object.entries(manifest?.default_permissions ?? {});
  const never = permissions.filter(([key]) => NEVER.includes(key)).map(([key]) => WORDS[key]);
  if (never.length > 0) throw new Error(`The manifest asks for ${never.join(', ')}, which Wheelhouse's app is never given`);
  page.searchParams.set('name', name);
  page.searchParams.set('description', String(manifest.description ?? ''));
  page.searchParams.set('url', String(manifest.url ?? ''));
  page.searchParams.set('public', 'false');
  page.searchParams.set('webhook_active', String(manifest.webhook_active === true));
  for (const [key, level] of permissions) page.searchParams.set(key, String(level));
  return page.href;
}

// The app's settings page on GitHub, where Enable Device Flow is ticked.
export function appSettingsUrl({ slug, owner, ownerKind }) {
  if (!SLUG.test(slug ?? '')) throw new Error('The app name may use letters, digits and dashes only');
  if (ownerKind === 'org') {
    if (!LOGIN.test(owner ?? '')) throw new Error('An organisation\'s name may use letters, digits and dashes only');
    return `https://github.com/organizations/${owner}/settings/apps/${slug}`;
  }
  return `https://github.com/settings/apps/${slug}`;
}

// ---- Reading the app back ----

const named = (key) => WORDS[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1).replaceAll('_', ' ')}`;

// What an app's permissions hold beyond the manifest's, as "Workflows (write)": any permission the
// manifest lacks, any level above the manifest's, and Workflows, Administration or Secrets at all.
export function grownPermissions(permissions, manifest = readManifest()) {
  const allowed = manifest?.default_permissions ?? {};
  const grown = [];
  for (const [key, level] of Object.entries(permissions ?? {})) {
    const limit = Object.hasOwn(allowed, key) ? RANK[allowed[key]] : undefined;
    if (NEVER.includes(key) || limit === undefined || !(RANK[level] <= limit)) grown.push(`${named(key)} (${level})`);
  }
  return grown;
}

// The app as GitHub shows it to the director's own sign-in: { clientId, slug, owner, ownerKind,
// permissions }. Refused, plainly, when it asks for more than the manifest. One GitHub doesn't
// have is refused with code 'not-found'.
export async function readOwnApp({ slug, run = realRun, manifest = readManifest() }) {
  if (!SLUG.test(slug ?? '')) throw new Error('The app name may use letters, digits and dashes only');
  const got = await gh(run, ['api', `apps/${slug}`]);
  if (got.code !== 0) {
    if (/HTTP 404|Not Found/i.test(`${got.stderr ?? ''}${got.stdout ?? ''}`)) {
      throw Object.assign(new Error(`GitHub has no app called ${slug} that your sign-in can see`), { code: 'not-found' });
    }
    throw new Error(`GitHub could not be asked about your app ${slug} with your sign-in`);
  }
  const body = json(got.stdout);
  const clientId = body?.client_id;
  const owner = body?.owner?.login;
  if (typeof body?.slug !== 'string' || !SLUG.test(body.slug) || !LOGIN.test(owner ?? '')) {
    throw new Error(`GitHub's answer about your app ${slug} could not be read`);
  }
  // Checked here, before any keys or installation are made with it.
  if (typeof clientId !== 'string' || !OWN_APP_CLIENT_ID.test(clientId)) {
    throw new Error(`GitHub gave your app ${slug} a client ID setup can't read, so setup has not used it`);
  }
  const grown = grownPermissions(body.permissions, manifest);
  if (grown.length > 0) {
    throw Object.assign(new Error(`Your GitHub App ${body.slug} asks for more than Wheelhouse's: ${grown.join(', ')}. Set ${grown.length === 1 ? 'it' : 'them'} back under Permissions on its page on GitHub, then ask again`), { code: 'grown', grown });
  }
  return { clientId, slug: body.slug, owner, ownerKind: body.owner.type === 'Organization' ? 'org' : 'user', permissions: { ...body.permissions } };
}

// The accounts the director may make an app on: their own, and each organisation where they are an
// active owner (GitHub's admin role).
export async function appAccounts({ run = realRun, user }) {
  const accounts = [{ kind: 'user', login: user }];
  const got = await gh(run, ['api', 'user/memberships/orgs?state=active&per_page=100']);
  const list = got.code === 0 ? json(got.stdout) : null;
  for (const m of Array.isArray(list) ? list : []) {
    const login = m?.organization?.login;
    if (m?.role === 'admin' && m?.state === 'active' && LOGIN.test(login ?? '')) accounts.push({ kind: 'org', login });
  }
  return accounts;
}

// ---- Making or finding the app ----

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function lookFor({ slug, run }) {
  try {
    return await readOwnApp({ slug, run });
  } catch (error) {
    if (error?.code === 'not-found') return null;
    throw error;
  }
}

// The person's own app on `account` (the account that holds the project): the one their profile
// records (`recorded`, confirmed) when it is still there with that client ID; else the one named
// `name` on GitHub; else made now, from the filled-in page, which setup waits for. `user` is the
// director's own account. Each is read back and refused when it asks for more than the manifest,
// and, whichever way it was found, when GitHub says it belongs to another account than `account`.
// STOP is read in every wait (`halt`).
export async function ensureOwnApp({
  account, user, name = appName(account), recorded = null, run = realRun, say = () => {}, open = async () => {},
  sleep = pause, now = () => new Date(), halt = () => {},
}) {
  // Only an owner of an organisation makes or installs its app: a member is told so plainly, before
  // any page opens or any wait begins.
  const org = !sameLogin(account, user);
  if (org && !(await appAccounts({ run, user })).some((a) => a.kind === 'org' && sameLogin(a.login, account))) {
    throw new Error(`Only an owner of ${account} on GitHub can make or install a GitHub App there, so setup has not opened its pages: ask one of its owners to make you one, then ask again`);
  }
  let found = null;
  if (recorded && sameLogin(recorded.owner, account)) {
    const kept = await lookFor({ slug: recorded.slug, run });
    if (kept !== null && kept.clientId === recorded.clientId) found = kept;
  }
  const slug = appSlug(name);
  found ??= await lookFor({ slug, run });
  if (found === null) {
    say(`On the page that opens, GitHub's form for your app ${name} is filled in: tick Enable Device Flow, then click Create GitHub App`);
    await open(newAppUrl({ owner: org ? { kind: 'org', login: account } : { kind: 'user' }, name }));
    const until = now().getTime() + APP_WAIT_MS;
    while (found === null) {
      halt();
      if (now().getTime() >= until) throw new Error(`Your GitHub App ${name} was not made after ${APP_WAIT_MS / 60000} minutes; a fresh Go ahead opens its page again`);
      await sleep(APP_POLL_MS);
      halt();
      found = await lookFor({ slug, run });
    }
  }
  if (!sameLogin(found.owner, account)) {
    throw new Error(`The GitHub App ${found.slug} belongs to ${found.owner}, not ${account}, so setup has not used it`);
  }
  return found;
}

// The person's own app as recorded (`app`: { clientId, slug, owner }), read back from GitHub and held
// to what GitHub says: the same client ID, the owner the record names, and that owner the account
// that holds the project (`account`, ruling R57). The record's words are only its writer's, so a
// record naming the director as the owner of someone else's app is refused here, by name. Gives
// what GitHub says of it.
export async function checkOwnApp({ app, account, run = realRun }) {
  const read = await readOwnApp({ slug: app.slug, run });
  if (read.clientId !== app.clientId) {
    throw new Error(`Your GitHub App ${app.slug} now has another client ID than the one recorded, so setup has not signed in to it`);
  }
  if (!sameLogin(read.owner, app.owner) || !sameLogin(read.owner, account)) {
    throw new Error(`GitHub says the app ${read.slug} belongs to ${read.owner}, not ${account} as recorded, so setup has not signed in to it`);
  }
  return read;
}

// The code for a sign-in with the person's own app: the app read again first and checked
// (checkOwnApp: its permissions may have grown since it was recorded, or its record may name another
// owner than GitHub's; a refusal stops the sign-in here, naming what is wrong), then the code asked
// for. GitHub's "device flow disabled" is said with the app's page opened, and the code
// asked for again until it is ticked, for APP_WAIT_MS.
export async function ownAppCode({
  app, account, run = realRun, fetch = globalThis.fetch, say = () => {}, open = async () => {}, sleep = pause, now = () => new Date(), halt = () => {},
}) {
  const read = await checkOwnApp({ app, account, run });
  let until = null;
  for (;;) {
    try {
      return await startDeviceSignIn({ clientId: app.clientId, fetch });
    } catch (error) {
      if (error?.code !== 'device_flow_disabled') throw error;
    }
    if (until === null) {
      until = now().getTime() + APP_WAIT_MS;
      say(DEVICE_FLOW_OFF);
      await open(appSettingsUrl(read));
    }
    halt();
    if (now().getTime() >= until) throw new Error(`Enable Device Flow was not ticked on your app's page after ${APP_WAIT_MS / 60000} minutes; a fresh Go ahead asks again`);
    await sleep(APP_POLL_MS);
    halt();
  }
}

// ---- The profile's record ----

// The profile through the helper: `write(event)` its setting route, `views()` its views, fresh.
export function helperProfile(client = helperClient()) {
  return {
    write: (event) => client.profile.write(event),
    async views() {
      const got = await client.profile.views({});
      if (got?.ok !== true) throw new Error(`Your profile could not be read: ${got?.why ?? got?.refused ?? 'the helper did not say why'}`);
      return got.views;
    },
  };
}

// The app a profile's views hold for the director, confirmed, or null: an unconfirmed or unreadable
// entry, or none (null), is no app. A confirmed app counts only while no newer proposal for the key
// waits: a proposal can only take trust away until it is decided, never add it. So uninstall's put
// back (putBackOwnApp) shadows a record never confirmed, whose card might be clicked later.
export function ownAppFrom(views) {
  const entry = views?.settings?.[OWN_GITHUB_APP_KEY];
  if (!entry || typeof entry !== 'object' || entry.value === null || !isAllowed(OWN_GITHUB_APP_KEY, entry.value)) return null;
  // The views list as unconfirmed only the proposals newer than the accepted value.
  const waiting = Array.isArray(views?.unconfirmed) ? views.unconfirmed : [];
  if (waiting.some((u) => u?.kind === 'setting' && (u.key ?? u.data?.key) === OWN_GITHUB_APP_KEY)) return null;
  const { clientId, slug, owner } = entry.value;
  return { clientId, slug, owner };
}

const accepted = (views) => {
  const value = views?.settings?.[OWN_GITHUB_APP_KEY]?.value;
  return value !== undefined && isAllowed(OWN_GITHUB_APP_KEY, value) ? value : null;
};

async function writeValue(profile, value) {
  return profile.write({ kind: 'setting', data: { key: OWN_GITHUB_APP_KEY, value, words: settingWords(OWN_GITHUB_APP_KEY, value) } });
}

// Records the app in the profile's `own-github-app` key, a `host` change recorded (`record`) just
// before it is written, with the value the profile held before, for uninstall. Nothing is written
// when the profile holds it already, confirmed or waiting for the director's Confirm: null then.
export async function recordOwnApp({ clientId, slug, owner }, { record = () => {}, profile = helperProfile() } = {}) {
  const value = { clientId, slug, owner };
  if (!isAllowed(OWN_GITHUB_APP_KEY, value)) throw new Error('The app to record has no client ID, name or owner setup can read');
  const views = await profile.views();
  const before = accepted(views);
  const waiting = (Array.isArray(views?.unconfirmed) ? views.unconfirmed : [])
    .some((u) => u?.kind === 'setting' && u.key === OWN_GITHUB_APP_KEY && same(u.data?.value, value));
  if (same(before, value) || waiting) return null;
  const change = { id: newId('chg'), kind: 'host', target: PROFILE_TARGET, before, after: value };
  record(change);
  const got = await writeValue(profile, value);
  if (got?.ok !== true) throw new Error(`Your GitHub App ${slug} could not be recorded in your profile: ${got?.why ?? got?.refused ?? 'the helper did not say why'}`);
  return change;
}

// Uninstall's undo of recordOwnApp's change: the profile's `own-github-app` put back to what it held
// before (none, when it held nothing), but only while it still holds what setup recorded, or setup's
// record was never confirmed; then, like any profile setting, it takes effect once the director
// confirms it. The profile has no route that withdraws a proposal, so a record never confirmed is
// shadowed instead: the put back is a newer proposal, and while it waits ownAppFrom counts no app;
// once confirmed it is the newer value. Either way a later Confirm of setup's old card never brings
// setup's app into effect. The keys file's `github-app` entry is not touched: its own change puts it
// back.
export async function putBackOwnApp(change, { profile = helperProfile() } = {}) {
  if (change?.kind !== 'host' || change.target !== PROFILE_TARGET) throw new Error('That change is not the profile\'s own GitHub App');
  const current = accepted(await profile.views());
  if (!same(current, change.after) && !same(current, change.before)) return { put: false, why: 'changed since setup' };
  const got = await writeValue(profile, change.before ?? null);
  if (got?.ok !== true) return { put: false, why: `the profile could not take it: ${got?.why ?? got?.refused ?? 'the helper did not say why'}` };
  return { put: true, id: got.id };
}
