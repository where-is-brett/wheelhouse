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

// A client that records any call made of it: the weekly job makes none.
function fakeClient() {
  const calls = [];
  const note = (name) => async (args) => { calls.push([name, args]); return { ok: true }; };
  return {
    calls,
    state: { backup: note('backup'), sync: note('sync') },
    profile: { sync: note('profile sync') },
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

test('the weekly job makes no backup', () => withHome(async () => {
  addProject('owner__one');
  addProject('owner__two');
  const client = fakeClient();
  const out = await runWeekly({ now: NOW, fetch: pageFetch(), client, root: bareRoot() });
  assert.deepEqual(client.calls, [], 'no backup, and no sync of the profile');
  assert.deepEqual(Object.keys(out), ['sources']);
  const kept = readRecord();
  assert.deepEqual(Object.keys(kept), ['lastRun', 'result']);
  assert.equal(kept.lastRun, NOW);
  assert.deepEqual(Object.keys(kept.result), ['sources']);
  assert.equal(kept.result.sources.ok, true);
  assert.equal(kept.result.sources.checked, DEFAULT_SOURCES.length);
  assert.equal(Array.isArray(kept.result.sources.sources), false, 'not the whole report');
  assert.ok(fs.existsSync(path.join(sourcesDir(), 'report.json')));
  assert.equal(weeklyDue(at(1000)), false);
  assert.equal(weeklyDue(at(WEEK_MS)), true);
}));

test('a failed sources check is recorded as run; one that throws is no report', () => withHome(async () => {
  const out = await runWeekly({ now: 'not a time at all', fetch: pageFetch(), root: bareRoot() }).catch((e) => e);
  assert.ok(out instanceof Error, 'a time that cannot be read is refused before anything runs');
  assert.equal(fs.existsSync(recordFile()), false);

  const unread = await runWeekly({ now: NOW, fetch: brokenFetch, root: bareRoot() });
  // The check itself reports each unread page; an exception inside it would leave sources null.
  assert.ok(unread.sources, 'the check ran and reported');
  assert.equal(readRecord().lastRun, NOW);

  const thrown = await runWeekly({ now: at(WEEK_MS), fetch: pageFetch(), root: bareRoot(), sourcesCheck: async () => { throw new Error('the check broke'); } });
  assert.equal(thrown.sources, null);
  const kept = readRecord();
  assert.equal(kept.lastRun, at(WEEK_MS));
  assert.equal(kept.result.sources.ok, false);
  assert.match(kept.result.sources.why, /check broke/);
}));

// A sources check that counts its runs and hands on to the real one.
function countedCheck() {
  const check = async (args) => { check.runs += 1; return runSourcesCheck(args); };
  check.runs = 0;
  return check;
}

test('a record v0.1.x kept waiting for a retry is not run again within its week', () => withHome(async () => {
  writeRecord({ sourcesRun: at(-HOUR), retryAt: at(-1000), result: { sources: { ok: true } } });
  assert.equal(weeklyDue(NOW), false, 'the retry of the backups is gone');
  const check = countedCheck();
  const out = await runWeekly({ now: NOW, fetch: pageFetch(), root: bareRoot(), sourcesCheck: check });
  assert.equal(out.skipped, true);
  assert.equal(check.runs, 0);
  assert.equal(weeklyDue(at(WEEK_MS - HOUR)), true, 'its week counts from its sources check');
}));

test('a week start in the future is a new week', () => withHome(async () => {
  addProject('owner__one');
  writeRecord({ sourcesRun: at(HOUR), retryAt: at(HOUR), result: {} });
  assert.equal(weeklyDue(NOW), true);
  const check = countedCheck();
  await runWeekly({ now: NOW, fetch: pageFetch(), root: bareRoot(), sourcesCheck: check });
  assert.equal(check.runs, 1);
  assert.equal(readRecord().lastRun, NOW);
  assert.equal(readRecord().sourcesRun, undefined);
}));

test('two runs started together run once', () => withHome(async () => {
  addProject('owner__one');
  const fetch = pageFetch();
  const [a, b] = await Promise.all([
    runWeekly({ now: NOW, fetch, root: bareRoot() }),
    runWeekly({ now: NOW, fetch, root: bareRoot() }),
  ]);
  const skipped = [a, b].filter((r) => r.skipped === true);
  const ran = [a, b].filter((r) => r.skipped !== true);
  assert.equal(skipped.length, 1);
  assert.equal(ran.length, 1);
  assert.match(skipped[0].why, /weekly/i);
  assert.equal(fs.existsSync(path.join(jobsDir(), 'weekly.lock')), false, 'the lock is released');
}));

test('a run that finds the week already done once it holds the lock returns without running', () => withHome(async () => {
  writeRecord({ lastRun: at(-1000), result: {} });
  const check = countedCheck();
  const out = await runWeekly({ now: NOW, fetch: pageFetch(), root: bareRoot(), sourcesCheck: check });
  assert.equal(out.skipped, true);
  assert.equal(check.runs, 0);
  assert.equal(readRecord().lastRun, at(-1000), 'the record is left as it was');
}));

test('the lock is released when the jobs fail, so the next run can go', () => withHome(async () => {
  const out = await runWeekly({ now: NOW, fetch: brokenFetch, root: bareRoot() });
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
  await runWeekly({ now: NOW, fetch, root: bareRoot() });
  const asked = fetch.calls;
  assert.equal(new Set(asked).size, asked.length, 'no address twice');
  for (const url of [...DEFAULT_SOURCES.map((s) => s.url), own, other]) assert.ok(asked.includes(url), url);
  assert.equal(asked.length, DEFAULT_SOURCES.length + 2);
}));

test('with no settings to read, the defaults are checked', () => withHome(async () => {
  addProject('owner__one', {});
  const fetch = pageFetch();
  await runWeekly({ now: NOW, fetch, root: bareRoot() });
  assert.deepEqual([...fetch.calls].sort(), DEFAULT_SOURCES.map((s) => s.url).sort());
}));

test('the routed models are those a project\'s routing names; missing and damaged files add none', () => withHome(async () => {
  const deprecations = DEFAULT_SOURCES.find((s) => s.id === 'deprecations').url;
  const fixture = fs.readFileSync(new URL('../../fixtures/sources/deprecations.html', import.meta.url), 'utf8');
  const fetch = async (url) => new Response(String(url) === deprecations ? fixture : '<p>x</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  addProject('owner__one', { config: { routing: { builder: 'claude-sample-9', reviewer: 'claude-sample-9', note: 7 } } });
  addProject('owner__two', { config: '{ damaged' });
  addProject('owner__three');
  const out = await runWeekly({ now: '2026-10-19T09:00:00.000Z', fetch, root: bareRoot() });
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
  const out = await runWeekly({ now: NOW, fetch, root: bareRoot() });
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
