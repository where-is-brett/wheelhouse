// tests/scripts/setup/card-faults.test.js
// Faults found in a rehearsal of setup's cards: the project's name asked, the company GitLabs this computer already uses
// offered by name, one phone promise on the first card, one line before setup, the same answer kept when git's key turns out
// to be held or not, and one expiry phrasing across the cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projectName, keepName, OTHER_NAME, knownCompanyHosts, gitlabWhere, sameSays, COMPANY_GITLAB, GITLAB_COM, connectionCard, WAYS } from '../../../scripts/setup/host.js';
import { oneCard, aboutOf } from '../../../scripts/setup/choices.js';
import { KEEP_HERE } from '../../../scripts/setup/local.js';
import { SETUP_FIRST } from '../../../scripts/lib/setup-first.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { tempFolder } from '../../helpers/homes.js';

const said = (answers) => (id) => answers[id] ?? null;

test('a new product on a host is asked what to call its project, the folder\'s name recommended', () => {
  const first = projectName({ answer: said({}), name: 'Cafe-Menu', host: 'gitlab' });
  assert.equal(first.ask.id, 'project-name');
  assert.equal(first.ask.typed, true);
  assert.equal(first.ask.card.recommend, keepName('Cafe-Menu'));
  assert.deepEqual(first.ask.card.options.map((o) => o.label), [keepName('Cafe-Menu'), OTHER_NAME]);
  assert.match(first.ask.card.what, /new project on GitLab be called/);
  assert.doesNotThrow(() => composeCard({ ...first.ask.card, kind: 'question', suggest: false }));
  assert.equal(aboutOf('3.project-name'), 'the project\'s name');
  // The default keeps the folder's name; a typed name is used; one that can't be a name is asked again, saying why.
  assert.deepEqual(projectName({ answer: said({ 'project-name': { label: keepName('Cafe-Menu'), text: null } }), name: 'Cafe-Menu', host: 'github' }), { name: 'Cafe-Menu' });
  assert.deepEqual(projectName({ answer: said({ 'project-name': { label: null, text: ' menu.app ' } }), name: 'Cafe-Menu', host: 'github' }), { name: 'menu.app' });
  const bad = projectName({ answer: said({ 'project-name': { label: null, text: 'my menu!' } }), name: 'Cafe-Menu', host: 'github' });
  assert.match(bad.ask.id, /^project-name-[0-9a-f]{10}$/);
  assert.match(bad.ask.card.what, /^That can't be a name here/);
  const empty = projectName({ answer: said({ 'project-name': { label: OTHER_NAME, text: null } }), name: 'Cafe-Menu', host: 'github' });
  assert.match(empty.ask.card.what, /^Choose Other and type the name\./);
});

test('the plan says what the project is called', () => {
  const list = [{ step: 3, id: 'project-name', key: '3.project-name', card: { options: [] }, chosen: null, label: keepName('Cafe-Menu'), text: null }];
  const text = oneCard({ folder: tempFolder('wh-name-'), list, product: { isNew: true, host: null, name: 'Cafe-Menu' }, platform: 'darwin', toRun: [3], count: 0 }).card.question;
  assert.match(text, /- Called Cafe-Menu on GitHub\./);
});

test('the company GitLabs this computer already uses are offered by name on both GitLab cards', () => {
  const folderOf = (host) => {
    const folder = tempFolder('wh-known-');
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ gitlabHosts: [host] }));
    return folder;
  };
  const projects = () => [{ record: { folder: folderOf('git.acme.example') } }, { record: { folder: folderOf('git.acme.example') } }, { record: { folder: folderOf('code.other.example') } }, { record: { folder: folderOf('third.example') } }];
  assert.deepEqual(knownCompanyHosts([], { projects }), ['git.acme.example', 'code.other.example']);
  assert.deepEqual(knownCompanyHosts([], { projects: () => [] }), []);
  // The cards read them from the projects registered here.
  const none = gitlabWhere({ answer: () => null, name: 'Cafe-Menu', others: [] });
  assert.deepEqual(none.ask.card.options.map((o) => o.label), [GITLAB_COM, COMPANY_GITLAB]);
  assert.equal(none.ask.card.recommend, null);
});

test('a lone known GitLab is recommended on the which-GitLab card, and typed on neither when chosen', () => {
  const git = tempFolder('wh-known-one-');
  fs.mkdirSync(path.join(git, '.git'), { recursive: true });
  fs.writeFileSync(path.join(git, '.git', 'config'), '[remote "origin"]\n\turl = https://git.acme.example/team/app.git\n');
  const asked = gitlabWhere({ answer: () => null, name: 'Cafe-Menu', others: ['https://git.acme.example/team/app.git'] });
  assert.deepEqual(asked.ask.card.options.map((o) => o.label), ['git.acme.example', GITLAB_COM, COMPANY_GITLAB]);
  assert.equal(asked.ask.card.recommend, 'git.acme.example');
  const chosen = gitlabWhere({ answer: (id) => (id === 'gitlab-where' ? { label: 'git.acme.example', text: null } : null), name: 'Cafe-Menu', others: ['https://git.acme.example/team/app.git'] });
  assert.equal(chosen.host, 'git.acme.example');
});

test('an answer on the connection card stands whether or not git turned out to hold a key', () => {
  const held = connectionCard({ host: 'gitlab', platform: 'win32', asIs: true, held: true, toolOut: true });
  const unheld = connectionCard({ host: 'gitlab', platform: 'win32', asIs: true, held: false, toolOut: true });
  const says = (card, label) => card.options.find((o) => o.label === label).says;
  assert.notEqual(says(held, WAYS.asIs), says(unheld, WAYS.asIs));
  assert.equal(sameSays(says(held, WAYS.asIs), says(unheld, WAYS.asIs)), true);
  assert.equal(sameSays(says(held, WAYS.narrow), says(unheld, WAYS.narrow)), true);
  assert.equal(sameSays(says(held, WAYS.asIs), says(held, WAYS.narrow)), false);
});

test('the first card promises no test notification where it says phone notifications are suggested for skipping', () => {
  const card = (desktop) => oneCard({ folder: tempFolder('wh-phone-'), list: [{ step: 3, id: 'host', key: '3.host', card: { options: [] }, chosen: null, label: KEEP_HERE, text: null }], product: { isNew: true, host: null, name: 'Tides' }, platform: 'win32', toRun: [3, 6], count: 0, desktop, computerChanging: ['push'] }).card;
  const noDesktop = card(false);
  assert.match(noDesktop.question, /where setup suggests skipping them since they need Claude Desktop/);
  assert.doesNotMatch(noDesktop.options[0].description, /test notification/);
  assert.match(noDesktop.options[0].description, /setup asks whether to skip phone notifications, which need Claude Desktop/);
  assert.match(card(true).options[0].description, /test notification on your phone/);
});

test('the line before setup is said once, and the first card is its own', () => {
  assert.match(SETUP_FIRST, /say once, in one plain line/);
  assert.match(SETUP_FIRST, /if you have already said it in this conversation, don't say it again/);
  const skill = fs.readFileSync(new URL('../../../skills/setup/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /Say that line only once in the conversation/);
  assert.match(skill, /apart from the one line under "Setup comes first" \(said once, never again\)/);
});

test('the key\'s expiry is worded as expiring in a number of days on every card that names one', () => {
  const win = connectionCard({ host: 'gitlab', platform: 'win32', asIs: true, held: false, toolOut: true });
  const text = JSON.stringify(win);
  assert.match(text, /set to expire in 90 days/);
  assert.doesNotMatch(text, /expiry date|days ahead|last 90 days/);
  const choices = [{ step: 3, id: 'connection-0123456789', key: '3.connection-0123456789', card: { options: [] }, chosen: null, label: WAYS.asIs, text: null, unheld: true }, { step: 3, id: 'host', key: '3.host', card: { options: [] }, chosen: null, label: 'GitLab', text: null }];
  const plan = oneCard({ folder: tempFolder('wh-expiry-'), list: choices, product: { isNew: true, host: null, name: 'Tides' }, platform: 'win32', toRun: [3], count: 0 }).card.options[0].description;
  assert.match(plan, /set it to expire in 90 days|set to expire in 90 days/);
});
