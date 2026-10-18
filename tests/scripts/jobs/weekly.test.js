// tests/scripts/jobs/weekly.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { withHome, tempFolder } from '../../helpers/homes.js';
import { jobsDir, sourcesDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { WEEK_MS } from '../../../scripts/lib/core-numbers.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { DEFAULT_SOURCES } from '../../../scripts/sources/list.js';
import { runSourcesCheck } from '../../../scripts/sources/check.js';
import { weeklyDue, runWeekly } from '../../../scripts/jobs/weekly.js';
import { weeklyDue as backgroundWeeklyDue } from '../../../scripts/lib/background.js';

const NOW = '2026-10-19T09:00:00.000Z';
const at = (offsetMs) => new Date(Date.parse(NOW) + offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const recordFile = () => path.join(jobsDir(), 'weekly.json');
const readRecord = () => JSON.parse(fs.readFileSync(recordFile(), 'utf8'));
const writeRecord = (body) => {
  fs.mkdirSync(jobsDir(), { recursive: true });
  fs.writeFileSync(recordFile(), typeof body === 'string' ? body : JSON.stringify(body));
};
const bareRoot = () => tempFolder('wh-root-');

// A fetch answering every address with a short page, and noting what was asked.
function pageFetch() {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    return new Response('<p>a page</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  fetch.calls = calls;
  return fetch;
}
const brokenFetch = async () => { throw new Error('the network is down'); };

function addProject(name, { settings, config, folder } = {}) {
  const dir = folder ?? tempFolder('wh-proj-');
  writeProject(name, {
    folder: dir, remoteUrl: `https://github.com/${name.replace('__', '/')}.git`, host: 'github', repo: name.replace('__', '/'),
    connection: { host: 'github', mode: 'narrow', project: name.replace('__', '/') },
  });
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'wheelhouse.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  if (settings !== undefined) {
    const views = path.join(wheelhouseHome(), 'projects', name, 'views');
    fs.mkdirSync(views, { recursive: true });
    fs.writeFileSync(path.join(views, 'settings.json'), JSON.stringify(settings));
  }
  return dir;
}

// A client that records its calls; `backup` and `sync` choose the answers.
function fakeClient({ backup = () => ({ ok: true, made: true }), sync = () => ({ ok: true, unpushed: 0 }) } = {}) {
  const calls = [];
  return {
    calls,
    state: { backup: async (args) => { calls.push(['backup', args.project]); return backup(args.project); } },
    profile: { sync: async () => { calls.push(['sync']); return sync(); } },
  };
}

test('the jobs are due with no record, a week after the last run, or when the last run is in the future', () => withHome(() => {
  assert.equal(weeklyDue(NOW), true, 'no record');
  writeRecord('not json {');
  assert.equal(weeklyDue(NOW), true, 'a damaged record');
  writeRecord({ result: {} });
  assert.equal(weeklyDue(NOW), true, 'no last run');
  writeRecord({ lastRun: 'last Tuesday' });
  assert.equal(weeklyDue(NOW), true, 'a last run that is not a time');
  writeRecord({ lastRun: at(-WEEK_MS + 1) });
  assert.equal(weeklyDue(NOW), false, 'a moment short of a week');
  assert.equal(weeklyDue(new Date(NOW)), false, 'a Date works as well');
  writeRecord({ lastRun: at(-WEEK_MS) });
  assert.equal(weeklyDue(NOW), true, 'exactly a week');
  writeRecord({ lastRun: at(-1000) });
  assert.equal(weeklyDue(NOW), false, 'a minute ago');
  writeRecord({ lastRun: at(60 * 1000) });
  assert.equal(weeklyDue(NOW), true, 'in the future');
  assert.equal(backgroundWeeklyDue, weeklyDue, 'the session start uses the same check');
}));

test('a failed sources check still backs up each project and syncs the profile', () => withHome(async () => {
  addProject('owner__one');
  addProject('owner__two');
  const client = fakeClient();
  const out = await runWeekly({ now: NOW, fetch: brokenFetch, client, root: bareRoot() });
  // The check itself reports each unread page; an exception inside it would leave sources null.
  assert.ok(out.sources, 'the check ran and reported');
  assert.deepEqual(client.calls, [['backup', 'owner__one'], ['backup', 'owner__two'], ['sync']]);
  assert.deepEqual(out.backups, [{ project: 'owner__one', ok: true }, { project: 'owner__two', ok: true }]);
  assert.equal(out.profile.ok, true);
  assert.equal(readRecord().lastRun, NOW);
  assert.equal(weeklyDue(at(1000)), false);
}));

test('a sources check that throws is no report, and the rest still runs', () => withHome(async () => {
  addProject('owner__one');
  const client = fakeClient();
  const out = await runWeekly({ now: 'not a time at all', fetch: pageFetch(), client, root: bareRoot() }).catch((e) => e);
  assert.ok(out instanceof Error, 'a time that cannot be read is refused before anything runs');
  assert.equal(client.calls.length, 0);
  assert.equal(fs.existsSync(recordFile()), false);

  const thrown = await runWeekly({
    now: NOW, fetch: pageFetch(), client, root: bareRoot(),
    sourcesCheck: async () => { throw new Error('the check broke'); },
  });
  assert.equal(thrown.sources, null);
  assert.deepEqual(client.calls, [['backup', 'owner__one'], ['sync']]);
  const kept = readRecord();
  assert.equal(kept.result.sources.ok, false);
  assert.match(kept.result.sources.why, /check broke/);
}));

test('a project whose backup fails is named; the others carry on', () => withHome(async () => {
  addProject('owner__a');
  addProject('owner__b');
  addProject('owner__c');
  const client = fakeClient({
    backup: (project) => {
      if (project === 'owner__b') return { ok: false, why: 'The profile isn\'t set up on this computer yet' };
      if (project === 'owner__c') throw new Error('the helper fell over');
      return { ok: true, made: false, why: 'Today\'s bundle is already there' };
    },
  });
  const out = await runWeekly({ now: NOW, fetch: pageFetch(), client, root: bareRoot() });
  assert.deepEqual(out.backups, [
    { project: 'owner__a', ok: true, why: 'Today\'s bundle is already there' },
    { project: 'owner__b', ok: false, why: 'The profile isn\'t set up on this computer yet' },
    { project: 'owner__c', ok: false, why: 'the helper fell over' },
  ]);
  assert.deepEqual(client.calls.map((c) => c[0]), ['backup', 'backup', 'backup', 'sync']);
  const kept = readRecord().result;
  assert.deepEqual(kept.backups, out.backups);
}));

test('a refused profile sync is a failure with the reason in plain words', () => withHome(async () => {
  const client = fakeClient({ sync: () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' }) });
  const out = await runWeekly({ now: NOW, fetch: pageFetch(), client, root: bareRoot() });
  assert.deepEqual(out.profile, { ok: false, why: 'the host helper could not be reached: is it running?' });
  const down = await runWeekly({
    now: at(WEEK_MS), fetch: pageFetch(), root: bareRoot(),
    client: fakeClient({ sync: () => { throw new Error('boom'); } }),
  });
  assert.deepEqual(down.profile, { ok: false, why: 'boom' });
}));

test('when the helper can\'t be reached for any backup or the sync, the run isn\'t recorded as done', () => withHome(async () => {
  addProject('owner__one');
  addProject('owner__two');
  const away = { ok: false, refused: 'the host helper could not be reached: is it running?' };
  const late = { ok: false, refused: 'the host helper did not answer in time' };
  const client = fakeClient({ backup: (project) => (project === 'owner__one' ? away : late), sync: () => away });
  const out = await runWeekly({ now: NOW, fetch: pageFetch(), client, root: bareRoot() });
  assert.equal(out.profile.ok, false);
  const kept = readRecord();
  assert.equal(kept.lastRun, undefined, 'no last run while the helper was down');
  assert.deepEqual(kept.result.profile, out.profile);
  assert.equal(weeklyDue(at(HOUR)), false, 'not again the same day');
  assert.equal(weeklyDue(at(DAY)), true, 'a session start a day later tries again');

  // A run some of whose calls reach the helper is done for the week.
  const reached = await runWeekly({ now: at(DAY), fetch: pageFetch(), root: bareRoot(), client: fakeClient({ sync: () => away }) });
  assert.equal(reached.backups.every((b) => b.ok), true);
  assert.equal(readRecord().lastRun, at(DAY));
  assert.equal(weeklyDue(at(DAY + HOUR)), false);
}));

const AWAY = { ok: false, refused: 'the host helper could not be reached: is it running?' };
const downClient = () => fakeClient({ backup: () => AWAY, sync: () => AWAY });
// A sources check that counts its runs and hands on to the real one.
function countedCheck() {
  const check = async (args) => { check.runs += 1; return runSourcesCheck(args); };
  check.runs = 0;
  return check;
}

test('with the helper down, the sources check runs once and only the backups and the sync are tried again, once a day', () => withHome(async () => {
  addProject('owner__one');
  const check = countedCheck();
  const first = downClient();
  await runWeekly({ now: NOW, fetch: pageFetch(), client: first, root: bareRoot(), sourcesCheck: check });
  assert.equal(check.runs, 1);
  assert.deepEqual(first.calls, [['backup', 'owner__one'], ['sync']]);
  assert.equal(readRecord().sourcesRun, NOW);
  assert.equal(readRecord().lastRun, undefined);

  // The same day: nothing is due, and a run that starts anyway does nothing.
  assert.equal(weeklyDue(at(3 * HOUR)), false);
  const again = downClient();
  const sameDay = await runWeekly({ now: at(3 * HOUR), fetch: pageFetch(), client: again, root: bareRoot(), sourcesCheck: check });
  assert.equal(sameDay.skipped, true);
  assert.deepEqual(again.calls, []);
  assert.equal(check.runs, 1);

  // The next day: the backups and the sync are tried again, the sources check is not.
  assert.equal(weeklyDue(at(DAY)), true);
  const second = downClient();
  const retried = await runWeekly({ now: at(DAY), fetch: pageFetch(), client: second, root: bareRoot(), sourcesCheck: check });
  assert.equal(check.runs, 1, 'the sources check is not run again');
  assert.deepEqual(second.calls, [['backup', 'owner__one'], ['sync']]);
  assert.equal(retried.sources, null);
  const kept = readRecord();
  assert.equal(kept.sourcesRun, NOW, 'the week still counts from the first try');
  assert.equal(kept.lastRun, undefined);
  assert.equal(kept.result.sources.ok, true, 'the sources result from the first try is kept');
  assert.equal(weeklyDue(at(DAY + HOUR)), false);
  assert.equal(weeklyDue(at(2 * DAY)), true);
}));

test('a sources change found while the helper is down is still there after the next day\'s retry', () => withHome(async () => {
  addProject('owner__one');
  const changelog = DEFAULT_SOURCES.find((s) => s.id === 'changelog');
  let text = '<p>Version 1 notes</p>';
  const fetch = async (url) => new Response(String(url) === changelog.url ? text : '<p>a page</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  // Last week's run, with the helper up, keeps the first copy.
  await runWeekly({ now: at(-WEEK_MS), fetch, client: fakeClient(), root: bareRoot() });
  text = '<p>Version 1 notes</p><p>Version 2 notes</p>';
  await runWeekly({ now: NOW, fetch, client: downClient(), root: bareRoot() });
  const reportFile = path.join(sourcesDir(), 'report.json');
  const diffFile = path.join(sourcesDir(), 'diff', 'changelog.txt');
  const report = fs.readFileSync(reportFile, 'utf8');
  assert.equal(JSON.parse(report).sources.find((s) => s.id === 'changelog').changed, true);
  const diff = fs.readFileSync(diffFile, 'utf8');
  assert.match(diff, /Version 2/);

  await runWeekly({ now: at(DAY), fetch, client: downClient(), root: bareRoot() });
  assert.equal(fs.readFileSync(reportFile, 'utf8'), report, 'the report is as the first try left it');
  assert.equal(fs.readFileSync(diffFile, 'utf8'), diff, 'the diff is still there');
  await runWeekly({ now: at(2 * DAY), fetch, client: fakeClient(), root: bareRoot() });
  assert.equal(fs.readFileSync(reportFile, 'utf8'), report);
  assert.equal(fs.readFileSync(diffFile, 'utf8'), diff);
}));

test('with the helper back the next day, the week is done; the next week counts from the first try', () => withHome(async () => {
  addProject('owner__one');
  const check = countedCheck();
  await runWeekly({ now: NOW, fetch: pageFetch(), client: downClient(), root: bareRoot(), sourcesCheck: check });
  const back = fakeClient();
  const out = await runWeekly({ now: at(DAY), fetch: pageFetch(), client: back, root: bareRoot(), sourcesCheck: check });
  assert.deepEqual(back.calls, [['backup', 'owner__one'], ['sync']]);
  assert.deepEqual(out.backups, [{ project: 'owner__one', ok: true }]);
  assert.equal(out.profile.ok, true);
  const kept = readRecord();
  assert.equal(kept.lastRun, at(DAY));
  assert.equal(kept.sourcesRun, NOW);
  assert.equal(check.runs, 1);
  assert.equal(weeklyDue(at(2 * DAY)), false, 'no retry once the week is done');
  assert.equal(weeklyDue(at(WEEK_MS - 1)), false);
  assert.equal(weeklyDue(at(WEEK_MS)), true, 'a week after the first try, not after the last');

  const next = fakeClient();
  await runWeekly({ now: at(WEEK_MS), fetch: pageFetch(), client: next, root: bareRoot(), sourcesCheck: check });
  assert.equal(check.runs, 2, 'the next week checks the sources again');
  assert.equal(readRecord().sourcesRun, at(WEEK_MS));
  assert.equal(readRecord().lastRun, at(WEEK_MS));
}));

test('the record keeps counts and whys, written only after all three have been tried', () => withHome(async () => {
  addProject('owner__one');
  let seenWhenSyncing;
  const client = fakeClient({ sync: () => { seenWhenSyncing = fs.existsSync(recordFile()); return { ok: true, unpushed: 2 }; } });
  const out = await runWeekly({ now: NOW, fetch: pageFetch(), client, root: bareRoot() });
  assert.equal(seenWhenSyncing, false, 'nothing is recorded before the sync has been tried');
  const kept = readRecord();
  assert.equal(kept.lastRun, NOW);
  assert.equal(kept.result.sources.ok, true);
  assert.equal(kept.result.sources.checked, DEFAULT_SOURCES.length);
  assert.equal(kept.result.sources.unread, 0);
  assert.equal('sources' in kept.result.sources && Array.isArray(kept.result.sources.sources), false, 'not the whole report');
  assert.deepEqual(kept.result.backups, [{ project: 'owner__one', ok: true }]);
  assert.deepEqual(kept.result.profile, { ok: true, unpushed: 2 });
  assert.equal(out.sources.sources.length >= DEFAULT_SOURCES.length, true);
  assert.ok(fs.existsSync(path.join(sourcesDir(), 'report.json')));
}));

test('two runs started together run once', () => withHome(async () => {
  addProject('owner__one');
  const client = fakeClient();
  const fetch = pageFetch();
  const [a, b] = await Promise.all([
    runWeekly({ now: NOW, fetch, client, root: bareRoot() }),
    runWeekly({ now: NOW, fetch, client, root: bareRoot() }),
  ]);
  const skipped = [a, b].filter((r) => r.skipped === true);
  const ran = [a, b].filter((r) => r.skipped !== true);
  assert.equal(skipped.length, 1);
  assert.equal(ran.length, 1);
  assert.match(skipped[0].why, /weekly/i);
  assert.equal(client.calls.filter((c) => c[0] === 'sync').length, 1);
  assert.equal(fs.existsSync(path.join(jobsDir(), 'weekly.lock')), false, 'the lock is released');
}));

test('a run that finds the week already done once it holds the lock returns without running', () => withHome(async () => {
  writeRecord({ lastRun: at(-1000), result: {} });
  const client = fakeClient();
  const out = await runWeekly({ now: NOW, fetch: pageFetch(), client, root: bareRoot() });
  assert.equal(out.skipped, true);
  assert.deepEqual(client.calls, []);
  assert.equal(readRecord().lastRun, at(-1000), 'the record is left as it was');
}));

test('the lock is released when the jobs fail, so the next run can go', () => withHome(async () => {
  const out = await runWeekly({ now: NOW, fetch: brokenFetch, client: fakeClient(), root: bareRoot() });
  assert.notEqual(out.skipped, true);
  assert.equal(fs.existsSync(path.join(jobsDir(), 'weekly.lock')), false);
}));

test('the sources checked are the defaults plus those the projects\' settings name, each once', () => withHome(async () => {
  const own = 'https://example.org/docs/notes';
  const other = 'https://example.net/changes';
  addProject('owner__one', { settings: { sources: { key: 'sources', value: [DEFAULT_SOURCES[0].url, own] } } });
  addProject('owner__two', { settings: { sources: { key: 'sources', value: [own, other] } } });
  addProject('owner__three'); // no views on disk: its settings can't be read
  const fetch = pageFetch();
  await runWeekly({ now: NOW, fetch, client: fakeClient(), root: bareRoot() });
  const asked = fetch.calls;
  assert.equal(new Set(asked).size, asked.length, 'no address twice');
  for (const url of [...DEFAULT_SOURCES.map((s) => s.url), own, other]) assert.ok(asked.includes(url), url);
  assert.equal(asked.length, DEFAULT_SOURCES.length + 2);
}));

test('with no settings to read, the defaults are checked', () => withHome(async () => {
  addProject('owner__one', {});
  const fetch = pageFetch();
  await runWeekly({ now: NOW, fetch, client: fakeClient(), root: bareRoot() });
  assert.deepEqual([...fetch.calls].sort(), DEFAULT_SOURCES.map((s) => s.url).sort());
}));

test('the routed models are those a project\'s routing names; missing and damaged files add none', () => withHome(async () => {
  const deprecations = DEFAULT_SOURCES.find((s) => s.id === 'deprecations').url;
  const fixture = fs.readFileSync(new URL('../../fixtures/sources/deprecations.html', import.meta.url), 'utf8');
  const fetch = async (url) => new Response(String(url) === deprecations ? fixture : '<p>x</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  addProject('owner__one', { config: { routing: { builder: 'claude-sample-9', reviewer: 'claude-sample-9', note: 7 } } });
  addProject('owner__two', { config: '{ damaged' });
  addProject('owner__three');
  const out = await runWeekly({ now: '2026-10-19T09:00:00.000Z', fetch, client: fakeClient(), root: bareRoot() });
  const byModel = Object.fromEntries(out.sources.retiring.map((r) => [r.model, r.routed]));
  assert.equal(byModel['claude-sample-9'], true);
  assert.equal(byModel['claude-sample-5'], false);
  assert.ok(Object.keys(byModel).length >= 2);
}));

// Runs the jobs over one deprecations page and says which models were taken as routed.
async function routedAfter() {
  fs.rmSync(recordFile(), { force: true }); // each look is a fresh week
  const deprecations = DEFAULT_SOURCES.find((s) => s.id === 'deprecations').url;
  const fixture = fs.readFileSync(new URL('../../fixtures/sources/deprecations.html', import.meta.url), 'utf8');
  const fetch = async (url) => new Response(String(url) === deprecations ? fixture : '<p>x</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  const out = await runWeekly({ now: NOW, fetch, client: fakeClient(), root: bareRoot() });
  return out.sources.retiring.filter((r) => r.routed).map((r) => r.model);
}
const ROUTING = JSON.stringify({ routing: { builder: 'claude-sample-9' } });

test('a configuration that is a link, or too large, names no models', () => withHome(async () => {
  const linked = addProject('owner__a');
  const target = path.join(tempFolder('wh-elsewhere-'), 'real.json');
  fs.writeFileSync(target, ROUTING);
  fs.mkdirSync(path.join(linked, '.claude'), { recursive: true });
  fs.symlinkSync(target, path.join(linked, '.claude', 'wheelhouse.json'));
  const big = addProject('owner__b', { config: JSON.stringify({ routing: { builder: 'claude-sample-9' }, padding: 'x'.repeat(300 * 1024) }) });
  assert.ok(fs.statSync(path.join(big, '.claude', 'wheelhouse.json')).size > 256 * 1024);
  assert.deepEqual(await routedAfter(), []);
  // The same routing in an ordinary file of ordinary size is read.
  addProject('owner__c', { config: ROUTING });
  assert.deepEqual(await routedAfter(), ['claude-sample-9']);
}));

test('a configuration folder that is a link names no models', () => withHome(async () => {
  const folder = addProject('owner__a');
  const elsewhere = tempFolder('wh-elsewhere-');
  fs.writeFileSync(path.join(elsewhere, 'wheelhouse.json'), ROUTING);
  fs.symlinkSync(elsewhere, path.join(folder, '.claude'), 'dir');
  assert.deepEqual(await routedAfter(), []);
}));

test('a named pipe where the configuration should be does not hang the jobs', { skip: process.platform === 'win32' }, () => withHome(async () => {
  const folder = addProject('owner__a');
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  const fifo = path.join(folder, '.claude', 'wheelhouse.json');
  const made = spawnSync('mkfifo', [fifo]);
  if (made.status !== 0) return; // no mkfifo here
  assert.deepEqual(await routedAfter(), []);
}));
