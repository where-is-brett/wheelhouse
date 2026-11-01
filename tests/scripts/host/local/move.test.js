// tests/scripts/host/local/move.test.js
// The move of a project in git alone to a host (spec 9), on a real home, a real folder and a bare repository for the host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { commitIn, git, projectFolderWith, withKeyedHome } from '../../../helpers/local-home.js';
import { tempFolder } from '../../../helpers/homes.js';
import { addFolderRemote, FOLDER_REMOTE } from '../../../../scripts/host/local/folder.js';
import { gitRoute, homeDir, makeHome, projectFolder } from '../../../../scripts/host/local/home.js';
import { localChanges } from '../../../../scripts/host/local/changes.js';
import { HOME_DAYS, KEEP_HOME, MOVE_NOW, NOT_NOW, REMOVE_HOME, holdsWork, moveToHost, moveWatch, readMove, unlockHome, unlockHomesIn } from '../../../../scripts/host/local/move.js';
import { engineDir, stateDir } from '../../../../scripts/lib/paths.js';
import { readProject, writeProject } from '../../../../scripts/lib/projects.js';
import { run } from '../../../../scripts/lib/run.js';
import { STATE_BRANCH, openProjectRecord } from '../../../../scripts/state/record.js';

const P = 'shop';
const WHO = 'owner/shop';

// A project in git alone, with a home, a folder remote and a bare repository standing where the host's would be.
async function kept(fn) {
  await withKeyedHome(async () => {
    const folder = fs.realpathSync.native(await projectFolderWith());
    writeProject(P, { folder, remoteUrl: null, host: 'local', repo: `local/${P}`, connection: { mode: 'none' } });
    await openProjectRecord(P, {});
    await makeHome({ project: P, folder });
    await addFolderRemote({ folder, mirror: path.join(engineDir(), 'mirrors', `${P}.git`) });
    const bare = path.join(tempFolder('wh-on-host-'), 'owner', 'shop.git');
    fs.mkdirSync(bare, { recursive: true });
    await git(bare, ['init', '-q', '--bare', '-b', 'main']);
    try {
      await fn({ folder, bare });
    } finally {
      unlockHome(P);
    }
  });
}

// What the helper hands the move, each counted, with a host that gives pull requests numbers from 100.
function waysFor({ folder, bare }, overrides = {}) {
  const calls = { connect: 0, opened: [], carried: [], files: 0, protect: 0, lock: 0 };
  const prs = [];
  const target = { folder, remoteUrl: bare, host: 'github', repo: WHO, connection: { host: 'github', mode: 'quick', project: WHO } };
  const ways = {
    running: () => [],
    moved: async () => { calls.moved = (calls.moved ?? 0) + 1; },
    connect: async ({ made }) => { calls.connect += 1; made(WHO); return target; },
    adapter: async () => ({
      openRequests: async () => prs.map((pr) => ({ number: pr.number, branch: pr.head })),
      openPr: async (pr) => {
        calls.opened.push(pr);
        const number = 100 + prs.length;
        prs.push({ ...pr, number });
        return { number };
      },
    }),
    reach: () => ({ env: {}, reach: 'local' }),
    carry: async (c) => { calls.carried.push(c); },
    carried: async (map) => { calls.map = map; },
    files: async () => { calls.files += 1; return { ok: true }; },
    protect: async () => { calls.protect += 1; return {}; },
    lock: async () => { calls.lock += 1; },
    ...overrides,
  };
  return { ways, calls, prs };
}

async function changeOn(folder, branch, { title = 'Prices', body = 'Prices show two decimals.' } = {}) {
  await git(folder, ['checkout', '-q', '-b', branch]);
  const head = await commitIn(folder, `${branch.replaceAll('/', '-')}.txt`);
  await git(folder, ['checkout', '-q', 'main']);
  await git(folder, ['push', '-q', homeDir(P), branch]);
  return localChanges({ project: P }).openChange({ branch, base: 'main', title, body, head });
}

const refsIn = async (repo) => (await git(repo, ['for-each-ref', '--format=%(refname)'])).split('\n').filter(Boolean);

test('a move waits for running runs and holds new work', async () => {
  await kept(async (world) => {
    let going = ['run-1'];
    const { ways, calls } = waysFor(world, { running: () => going });
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways }), { waiting: 'runs' });
    assert.equal(calls.connect, 0);
    assert.equal(holdsWork(P), true);
    going = [];
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways }), { ok: true });
    assert.equal(holdsWork(P), false);
  });
});

test('every branch reaches the host', async () => {
  await kept(async (world) => {
    await changeOn(world.folder, 'feature/one');
    await git(world.folder, ['branch', 'old-idea', 'main']);
    await git(world.folder, ['push', '-q', homeDir(P), 'old-idea']);
    const { ways } = waysFor(world);
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways }), { ok: true });
    const heads = await refsIn(world.bare);
    for (const branch of ['main', 'feature/one', 'old-idea']) assert.ok(heads.includes(`refs/heads/${branch}`), branch);
  });
});

test('an open change becomes a pull request with its body', async () => {
  await kept(async (world) => {
    const change = await changeOn(world.folder, 'feature/one');
    const { ways, calls } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    assert.deepEqual(calls.opened.map(({ head, base, title, body }) => ({ head, base, title, body })), [{ head: 'feature/one', base: 'main', title: 'Prices', body: 'Prices show two decimals.' }]);
    assert.deepEqual(calls.carried.map(({ n, number, head }) => ({ n, number, head })), [{ n: change.n, number: 100, head: change.head }]);
    assert.deepEqual(localChanges({ project: P }).openChanges(), []);
  });
});

test('the private record stays with the project', async () => {
  await kept(async (world) => {
    const before = fs.statSync(stateDir(P)).ino;
    const { ways } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    const record = readProject(P);
    assert.equal(record.host, 'github');
    assert.equal(record.repo, WHO);
    assert.equal(record.remoteUrl, world.bare);
    assert.equal(fs.statSync(stateDir(P)).ino, before);
  });
});

test('the folder swaps its remotes', async () => {
  await kept(async (world) => {
    const { ways } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    assert.equal(await git(world.folder, ['remote']), 'origin');
    assert.equal(await git(world.folder, ['config', '--get', 'remote.origin.url']), world.bare);
    assert.equal(await git(world.folder, ['rev-parse', 'refs/remotes/origin/main']), await git(world.folder, ['rev-parse', 'main']));
  });
});

test('an origin of the director\'s own stays, under another name, and the move says so', async () => {
  await kept(async (world) => {
    await git(world.folder, ['remote', 'add', 'origin', 'https://git.example.com/shop.git']);
    const { ways } = waysFor(world);
    const said = [];
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways, say: (l) => said.push(l) }), { ok: true });
    assert.equal(await git(world.folder, ['config', '--get', 'remote.origin.url']), world.bare);
    assert.equal(await git(world.folder, ['config', '--get', 'remote.before-wheelhouse.url']), 'https://git.example.com/shop.git');
    assert.ok(said.some((l) => l.includes('before-wheelhouse')), said.join('\n'));
  });
});

test('the folder comes up to what the project-files change added', async () => {
  await kept(async (world) => {
    let tip = null;
    const { ways } = waysFor(world, {
      files: async () => {
        const clone = path.join(tempFolder('wh-merged-'), 'c');
        await git(path.dirname(clone), ['clone', '-q', world.bare, clone]);
        tip = await commitIn(clone, 'merged.txt');
        await git(clone, ['push', '-q', 'origin', 'main']);
        return { ok: true };
      },
    });
    await moveToHost({ project: P, host: 'github', ways });
    assert.equal(await git(world.folder, ['rev-parse', 'main']), tip);
  });
});

test('a folder holding uncommitted work is left as it is, and says why', async () => {
  await kept(async (world) => {
    const before = await git(world.folder, ['rev-parse', 'main']);
    fs.writeFileSync(path.join(world.folder, 'a.txt'), 'mine\n');
    const { ways } = waysFor(world, {
      files: async () => {
        const clone = path.join(tempFolder('wh-merged-'), 'c');
        await git(path.dirname(clone), ['clone', '-q', world.bare, clone]);
        await commitIn(clone, 'merged.txt');
        await git(clone, ['push', '-q', 'origin', 'main']);
        return { ok: true };
      },
    });
    const said = [];
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways, say: (l) => said.push(l) }), { ok: true });
    assert.equal(await git(world.folder, ['rev-parse', 'main']), before);
    assert.equal(fs.readFileSync(path.join(world.folder, 'a.txt'), 'utf8'), 'mine\n');
    assert.ok(said.some((l) => l.includes('changes of its own')), said.join('\n'));
  });
});

test('a move stopped after the push carries on and pushes nothing twice', async () => {
  await kept(async (world) => {
    await changeOn(world.folder, 'feature/one');
    let refuseOnce = true;
    const made = waysFor(world);
    const hosted = await made.ways.adapter();
    const { ways, calls } = { ...made, ways: { ...made.ways, adapter: async () => ({ ...hosted, openPr: async (pr) => {
      if (refuseOnce) { refuseOnce = false; throw new Error('The host went away'); }
      return hosted.openPr(pr);
    } }) } };
    const pushes = [];
    const route = gitRoute({ run });
    const counted = (cwd, options) => {
      const g = route(cwd, options);
      const seen = (args) => { if (args.includes('push')) pushes.push(args); };
      return { ...g, call: (args, ...r) => { seen(args); return g.call(args, ...r); }, must: (args, ...r) => { seen(args); return g.must(args, ...r); }, ok: (args, ...r) => { seen(args); return g.ok(args, ...r); } };
    };
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways, git: counted }), { failedAt: 'changes', line: 'The host went away' });
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways, git: counted }), { ok: true });
    assert.equal(pushes.length, 2);
    assert.ok(pushes[0].includes('refs/heads/main:refs/heads/main') && pushes[0].filter((a) => a.startsWith('refs/')).length === 1, pushes[0].join(' '));
    assert.equal(calls.connect, 1);
    assert.equal(calls.opened.length, 1);
  });
});

test('a move cut off just after the record was written carries on, as that step is done', async () => {
  await kept(async (world) => {
    let cut = true;
    const { ways } = waysFor(world, { moved: async () => { if (cut) { cut = false; throw new Error('Cut off'); } } });
    assert.equal((await moveToHost({ project: P, host: 'github', ways })).failedAt, 'record');
    assert.equal(readProject(P).host, 'github');
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways }), { ok: true });
  });
});

test('a project that reached a host some other way lets its held work go, and says so', async () => {
  await kept(async (world) => {
    const { watch, cards, answers, notes } = watchOf(world, { running: () => ['r'] });
    await watch.ask('github');
    answers[cards[0].id] = MOVE_NOW;
    await watch.tick();
    assert.equal(holdsWork(P), true);
    writeProject(P, { folder: world.folder, remoteUrl: 'https://github.com/other/shop.git', host: 'github', repo: 'other/shop', connection: { host: 'github', mode: 'quick', project: 'other/shop' } });
    await watch.tick();
    assert.equal(holdsWork(P), false);
    assert.ok(notes.some((n) => n.includes('already on a host')), notes.join('\n'));
  });
});

test('a pull request a broken-off move opened is used, not opened again', async () => {
  await kept(async (world) => {
    await changeOn(world.folder, 'feature/one');
    let breakOnce = true;
    const { ways, calls } = waysFor(world, {
      carry: async (c) => {
        if (breakOnce) { breakOnce = false; throw new Error('Broke off'); }
        calls.carried.push(c);
      },
    });
    assert.equal((await moveToHost({ project: P, host: 'github', ways })).failedAt, 'changes');
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways }), { ok: true });
    assert.equal(calls.opened.length, 1);
    assert.equal(calls.carried.length, 1);
  });
});

test('a repository the broken-off move made is carried on with', async () => {
  await kept(async (world) => {
    let known = null;
    let times = 0;
    const { ways } = waysFor(world, {
      connect: async ({ made, ours }) => {
        times += 1;
        if (times === 1) { made(WHO); throw new Error('The sign-in broke off'); }
        known = ours;
        return { folder: world.folder, remoteUrl: world.bare, host: 'github', repo: WHO, connection: { host: 'github', mode: 'quick', project: WHO } };
      },
    });
    assert.equal((await moveToHost({ project: P, host: 'github', ways })).failedAt, 'host');
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways }), { ok: true });
    assert.equal(known, WHO);
  });
});

test('the private record never goes up', async () => {
  await kept(async (world) => {
    await changeOn(world.folder, 'feature/one');
    await git(homeDir(P), ['update-ref', `refs/heads/${STATE_BRANCH}`, 'refs/heads/main']);
    await git(homeDir(P), ['update-ref', 'refs/heads/wheelhouse/kept', 'refs/heads/main']);
    const { ways } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    const refs = await refsIn(world.bare);
    assert.ok(refs.every((r) => r.startsWith('refs/heads/') || r.startsWith('refs/tags/')), refs.join('\n'));
    assert.ok(!refs.includes(`refs/heads/${STATE_BRANCH}`));
    assert.ok(!refs.includes('refs/heads/wheelhouse/kept'));
    const objects = await git(world.bare, ['rev-list', '--all', '--objects']);
    assert.ok(!objects.includes('events'), objects);
    assert.equal(fs.existsSync(path.join(world.bare, 'home-part')), false);
  });
});

test('a pull request\'s old number is handed on once, with every change', async () => {
  await kept(async (world) => {
    const one = await changeOn(world.folder, 'feature/one');
    const two = await changeOn(world.folder, 'feature/two', { title: 'Tax' });
    const { ways, calls } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    assert.deepEqual(calls.map, { [one.n]: 100, [two.n]: 101 });
  });
});

test('after a failure past the record, Not now keeps work held and asks again the next day', async () => {
  await kept(async (world) => {
    let fail = true;
    let today = new Date('2026-11-01T00:00:00Z');
    const { watch, cards, answers } = watchOf(world, { lock: async () => { if (fail) throw new Error('The lock could not be taken'); } }, { at: () => today });
    await watch.ask('github');
    answers[cards[0].id] = MOVE_NOW;
    await watch.tick();
    answers[cards[1].id] = NOT_NOW;
    await watch.tick();
    assert.equal(holdsWork(P), true);
    assert.equal(cards.length, 2);
    today = new Date('2026-11-02T01:00:00Z');
    await watch.tick();
    assert.equal(cards.length, 3);
    fail = false;
    answers[cards[2].id] = 'Try again';
    await watch.tick();
    assert.equal(readMove(P).state, 'moved');
  });
});

test('the home is left read-only', { skip: process.platform === 'win32' }, async () => {
  await kept(async (world) => {
    const { ways } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    const tip = await git(homeDir(P), ['rev-parse', 'refs/heads/main']);
    const refused = await run('git', ['update-ref', 'refs/heads/planted', tip], { cwd: homeDir(P) });
    assert.notEqual(refused.code, 0);
    unlockHome(P);
    fs.rmSync(homeDir(P), { recursive: true, force: true });
    assert.equal(fs.existsSync(homeDir(P)), false);
  });
});

test('a project folder removed whole takes its read-only home with it', { skip: process.platform === 'win32' }, async () => {
  await kept(async (world) => {
    const { ways } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    unlockHomesIn(projectFolder(P));
    fs.rmSync(projectFolder(P), { recursive: true, force: true });
    assert.equal(fs.existsSync(projectFolder(P)), false);
  });
});

test('the host, the protection and the lock are each done once, and the folder\'s old remote is gone', async () => {
  await kept(async (world) => {
    const { ways, calls } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    await assert.rejects(git(world.folder, ['config', '--get', `remote.${FOLDER_REMOTE}.url`]));
    assert.deepEqual([calls.connect, calls.files, calls.protect, calls.lock], [1, 1, 1, 1]);
  });
});

test('All stop halts a move between steps, and it carries on', async () => {
  await kept(async (world) => {
    const { ways, calls } = waysFor(world);
    let stop = true;
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways, stopped: () => stop }), { waiting: 'stop' });
    assert.equal(calls.connect, 0);
    stop = false;
    assert.deepEqual(await moveToHost({ project: P, host: 'github', ways, stopped: () => stop }), { ok: true });
  });
});

test('a project already on a host doesn\'t move', async () => {
  await kept(async (world) => {
    const { ways } = waysFor(world);
    await moveToHost({ project: P, host: 'github', ways });
    assert.equal((await moveToHost({ project: P, host: 'github', ways })).failedAt, 'start');
  });
});

// The card's way through, as the helper's tick takes it.
function watchOf(world, overrides = {}, { at = () => new Date('2026-11-01T00:00:00Z') } = {}) {
  const { ways, calls } = waysFor(world, overrides);
  const cards = [];
  const notes = [];
  const answers = {};
  const watch = moveWatch({
    project: P, ways, now: at, card: async (data) => { cards.push(data); }, answerOf: (id) => answers[id] ?? null, note: (w) => notes.push(w),
  });
  return { watch, cards, notes, answers, calls };
}

test('the card names what will happen and that the code goes online, and nothing moves on Not now', async () => {
  await kept(async (world) => {
    const { watch, cards, answers, calls } = watchOf(world);
    await watch.ask('github');
    assert.equal(cards.length, 1);
    assert.match(cards[0].what, /online/i);
    assert.match(cards[0].what, /GitHub/);
    assert.equal(cards[0].recommendation, MOVE_NOW);
    assert.equal(holdsWork(P), false);
    answers[cards[0].id] = NOT_NOW;
    await watch.tick();
    assert.equal(calls.connect, 0);
    assert.equal(readMove(P), null);
  });
});

test('one card only, while a move is asked about', async () => {
  await kept(async (world) => {
    const { watch, cards } = watchOf(world);
    await watch.ask('github');
    await watch.ask('github');
    assert.equal(cards.length, 1);
  });
});

test('Move it runs the move on the tick', async () => {
  await kept(async (world) => {
    const { watch, cards, answers } = watchOf(world);
    await watch.ask('github');
    answers[cards[0].id] = MOVE_NOW;
    await watch.tick();
    assert.equal(readProject(P).host, 'github');
    assert.equal(readMove(P).state, 'moved');
  });
});

test('a move that fails asks once, keeps holding, and Try again carries on', async () => {
  await kept(async (world) => {
    let fail = true;
    const { watch, cards, answers, notes } = watchOf(world, { connect: async () => { if (fail) throw new Error('GitHub could not be reached'); return { folder: world.folder, remoteUrl: world.bare, host: 'github', repo: WHO, connection: { host: 'github', mode: 'quick', project: WHO } }; } });
    await watch.ask('github');
    answers[cards[0].id] = MOVE_NOW;
    await watch.tick();
    await watch.tick();
    assert.equal(cards.length, 2);
    assert.match(cards[1].what, /GitHub could not be reached/);
    assert.equal(holdsWork(P), true);
    assert.equal(notes.length, 0);
    fail = false;
    answers[cards[1].id] = 'Try again';
    await watch.tick();
    assert.equal(readProject(P).host, 'github');
  });
});

test('Not now after a failure lets work go on, and a later move sends the newest again', async () => {
  await kept(async (world) => {
    await changeOn(world.folder, 'feature/one');
    let fail = true;
    const { watch, cards, answers } = watchOf(world, { reach: () => { if (fail) throw new Error('No'); return { env: {}, reach: 'local' }; } });
    await watch.ask('github');
    answers[cards[0].id] = MOVE_NOW;
    await watch.tick();
    answers[cards[1].id] = NOT_NOW;
    await watch.tick();
    assert.equal(holdsWork(P), false);
    assert.equal(readProject(P).host, 'local');
    const late = await commitIn(world.folder, 'late.txt');
    await git(world.folder, ['push', '-q', homeDir(P), 'main']);
    fail = false;
    await watch.ask('github');
    answers[cards[2].id] = MOVE_NOW;
    await watch.tick();
    assert.equal(await git(world.bare, ['rev-parse', 'refs/heads/main']), late);
  });
});

test('the home\'s card comes after 30 days, with Keep it recommended, and Keep it ends it', async () => {
  await kept(async (world) => {
    let today = new Date('2026-11-01T00:00:00Z');
    const { watch, cards, answers } = watchOf(world, {}, { at: () => today });
    await watch.ask('github');
    answers[cards[0].id] = MOVE_NOW;
    await watch.tick();
    today = new Date(Date.parse('2026-11-01T00:00:00Z') + (HOME_DAYS - 1) * 86400000);
    await watch.tick();
    assert.equal(cards.length, 1);
    today = new Date(Date.parse('2026-11-01T00:00:00Z') + HOME_DAYS * 86400000);
    await watch.tick();
    await watch.tick();
    assert.equal(cards.length, 2);
    assert.equal(cards[1].level, 4);
    assert.equal(cards[1].recommendation, KEEP_HOME);
    assert.ok(cards[1].options.some((o) => o.label === REMOVE_HOME));
    answers[cards[1].id] = KEEP_HOME;
    await watch.tick();
    assert.equal(readMove(P).home, 'kept');
    assert.equal(fs.existsSync(homeDir(P)), true);
  });
});

test('Remove it on the home\'s card removes the home and nothing beside it', async () => {
  await kept(async (world) => {
    let today = new Date('2026-11-01T00:00:00Z');
    const { watch, cards, answers } = watchOf(world, {}, { at: () => today });
    await watch.ask('github');
    answers[cards[0].id] = MOVE_NOW;
    await watch.tick();
    today = new Date(Date.parse('2026-11-01T00:00:00Z') + HOME_DAYS * 86400000);
    await watch.tick();
    answers[cards[1].id] = REMOVE_HOME;
    await watch.tick();
    assert.equal(fs.existsSync(homeDir(P)), false);
    assert.equal(fs.existsSync(stateDir(P)), true);
    assert.equal(fs.existsSync(path.join(projectFolder(P), 'project.json')), true);
    assert.equal(readMove(P).home, 'removed');
  });
});
