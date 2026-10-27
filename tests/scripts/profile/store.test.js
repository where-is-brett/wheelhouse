// tests/scripts/profile/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  profileRemote, writeProfileViews, readProfileViews,
} from '../../../scripts/profile/store.js';
import { profileDir, profileViewsDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { makeEvent, eventPath, confirmationFor } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { as, shortHome } from '../../helpers/homes.js';

const NOW = new Date('2026-10-18T05:00:00.000Z');
const remoteFor = (url) => ({
  remoteUrl: url, host: 'github', repo: 'o/profile', connection: { host: 'github', mode: 'quick', project: 'o/profile' },
});
const writeProfileJson = (value) => fs.writeFileSync(path.join(wheelhouseHome(), 'profile.json'), typeof value === 'string' ? value : JSON.stringify(value));
const put = (relative, text) => {
  const file = path.join(profileDir(), relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
test('profileRemote is null while profile.json is missing or damaged', async () => {
  await as(shortHome(), async () => {
    assert.equal(profileRemote(), null);
    const damaged = [
      '{',
      '[]',
      'null',
      JSON.stringify({ host: 'github' }),
      JSON.stringify({ ...remoteFor('/r/profile.git'), remoteUrl: '' }),
      JSON.stringify(remoteFor('https://someone:secret@github.com/o/profile.git')),
      JSON.stringify(remoteFor('https://ghs_STANDINTOKEN0123456789@github.com/o/profile.git')),
      JSON.stringify(remoteFor('ssh://git:secret@github.com/o/profile.git')),
      JSON.stringify({ ...remoteFor('/r/profile.git'), connection: null }),
      JSON.stringify({ ...remoteFor('/r/profile.git'), repo: 7 }),
    ];
    for (const text of damaged) {
      writeProfileJson(text);
      assert.equal(profileRemote(), null, text);
    }
    for (const url of ['/somewhere/o/profile.git', 'https://github.com/o/profile.git', 'git@github.com:o/profile.git', 'ssh://git@github.com/o/profile.git']) {
      writeProfileJson(remoteFor(url));
      assert.deepEqual(profileRemote(), remoteFor(url), url);
    }
  });
});

test('the profile views are built from the profile\'s events and read back', async () => {
  await as(shortHome(), async () => {
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
    assert.equal(readProfileViews(), null);
    const setting = makeEvent({ kind: 'setting', data: { key: 'briefing', value: 'short' }, now: () => NOW });
    const unconfirmed = makeEvent({ kind: 'setting', data: { key: 'boardTab', value: 'build' }, now: () => NOW });
    const confirmation = makeEvent({ ...confirmationFor(setting), now: () => NOW });
    for (const e of [setting, unconfirmed, confirmation]) put(eventPath(e), JSON.stringify(e));
    const views = await writeProfileViews({ now: () => NOW });
    assert.equal(views.settings.briefing.value, 'short');
    assert.equal(views.settings.boardTab, undefined);
    assert.equal(views.unconfirmed.length, 1);
    assert.ok(fs.existsSync(path.join(profileViewsDir(), 'settings.json')));
    assert.deepEqual(readProfileViews(), JSON.parse(JSON.stringify(views)));
    fs.writeFileSync(path.join(profileViewsDir(), 'settings.json'), '{');
    assert.equal(readProfileViews(), null, 'a damaged view reads as none');
  });
});

