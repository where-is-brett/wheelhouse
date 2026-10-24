// tests/scripts/routing/in-force.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALWAYS_READY, REWORK_LINE, SECOND_REVIEWER_LINE, balancedRouting, columnLines, columnsReadyOf, routingFrom, routingInForce,
} from '../../../scripts/routing/in-force.js';
import { resolveRouting } from '../../../scripts/routing/thoroughness.js';
import { tempFolder } from '../../helpers/homes.js';

const now = () => new Date('2026-10-24T09:00:00.000Z');
const pins = { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-premium' };
const config = { routing: { foreman: 'model-flat' }, tiers: { pins } };
const flat = { routing: { foreman: 'model-a', builder: 'model-b', feature: null } };
const settingsAt = (efficiency, premium) => ({
  efficiency: { key: 'efficiency', value: efficiency },
  ...(premium === undefined ? {} : { premium: { key: 'premium', value: premium } }),
});
const ready = (...columns) => Object.fromEntries(columns.map((c) => [c, { pins: { ...pins } }]));

test('Balanced and Thorough are always ready', () => {
  assert.deepEqual([...ALWAYS_READY], ['balanced', 'thorough']);
  const thorough = routingFrom({ config, views: { settings: settingsAt('thorough') }, now });
  assert.equal(thorough.level, 'thorough');
  assert.deepEqual(thorough.roles.feature, { model: 'model-top', effort: 'xhigh', fallback: 'model-mid' });
});

test('a level runs only once its column is ready on the pins in force', () => {
  const views = { settings: settingsAt('lean'), columnsReady: {} };
  const waiting = routingFrom({ config, views, now });
  assert.equal(waiting.level, 'balanced');
  assert.match(waiting.lines.join('\n'), /Lean isn't ready yet/);
  const lean = routingFrom({ config, views: { ...views, columnsReady: ready('lean') }, now });
  assert.equal(lean.level, 'lean');
  assert.deepEqual(lean.roles.foreman, { model: 'model-mid', effort: 'low', fallback: 'model-top' });
  assert.deepEqual(lean.extra.builderCap, 1);
  // A pin moved since the evaluation: Balanced again.
  const moved = routingFrom({ config: { tiers: { pins: { ...pins, midSized: 'model-mid-2' } } }, views: { ...views, columnsReady: ready('lean') }, now });
  assert.equal(moved.level, 'balanced');
});

test('the premium model needs its own ready record and the director\'s opt-in', () => {
  const views = { settings: settingsAt('thorough', 'paid-too'), columnsReady: {} };
  assert.equal(routingFrom({ config, views, now }).roles.feature.model, 'model-top');
  const with_ = routingFrom({ config, views: { ...views, columnsReady: ready('premium') }, now });
  assert.deepEqual(with_.roles.feature, { model: 'model-premium', effort: 'high', fallback: 'model-top' });
  // Off by default.
  const off = routingFrom({ config, views: { settings: settingsAt('thorough'), columnsReady: ready('premium') }, now });
  assert.equal(off.roles.feature.model, 'model-top');
});

test('a setting that isn\'t allowed, or views that can\'t be read, give Balanced', () => {
  for (const views of [null, {}, { settings: 'lean' }, { settings: settingsAt('fastest') }, { settings: settingsAt(['lean']) }, { settings: settingsAt('lean'), columnsReady: 'lean' }]) {
    const r = routingFrom({ config, views, now });
    assert.equal(r.level, 'balanced', JSON.stringify(views));
  }
});

test('with no pins, a level other than Balanced runs at Balanced on the flat models', () => {
  const r = routingFrom({ config: flat, views: { settings: settingsAt('thorough') }, now });
  assert.equal(r.level, 'balanced');
  assert.equal(r.roles.foreman.model, 'model-a');
  assert.equal(r.roles.builder.model, 'model-b');
  assert.equal(r.roles.feature.model, null);
  assert.deepEqual(r, resolveRouting({ config: flat, level: 'thorough', ready: ['balanced', 'thorough'] }));
});

test('balancedRouting is Balanced, and Balanced with no models when even that can\'t be had', () => {
  assert.equal(balancedRouting(config).level, 'balanced');
  const odd = { get routing() { throw new Error('no'); } };
  const r = balancedRouting(odd);
  assert.deepEqual(r.roles, {});
  assert.equal(r.level, 'balanced');
});

test('routingInForce reads the local state, and gives Balanced when it can\'t', () => {
  const home = tempFolder('wh-in-force-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    // No state clone at all: nothing is set, so Balanced.
    assert.equal(routingInForce('no-such-project', config, { now }).level, 'balanced');
    // A name that isn't a folder name can't be read.
    assert.equal(routingInForce('../x', config, { now }).level, 'balanced');
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
});

test('columnsReadyOf reads the view on disk against the main folder\'s configuration', () => {
  const home = tempFolder('wh-in-force-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const folder = path.join(home, 'checkout');
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], tiers: { pins } }));
    const project = path.join(home, 'projects', 'demo');
    fs.mkdirSync(path.join(project, 'views'), { recursive: true });
    fs.writeFileSync(path.join(project, 'project.json'), JSON.stringify({
      folder, host: 'github', repo: 'owner/demo', remoteUrl: 'https://github.com/owner/demo.git', connection: { kind: 'app' },
    }));
    assert.deepEqual(columnsReadyOf({ project: 'demo' }), []);
    fs.writeFileSync(path.join(project, 'views', 'columnsReady.json'), JSON.stringify(ready('lean', 'premium')));
    assert.deepEqual(columnsReadyOf({ project: 'demo' }), ['lean', 'premium']);
    // A configuration that can't be read gives none.
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), '{');
    assert.deepEqual(columnsReadyOf({ project: 'demo' }), []);
    assert.deepEqual(columnsReadyOf({ project: 'missing' }), []);
    assert.deepEqual(columnsReadyOf({}), []);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
});

test('columnLines names each subagent role\'s model and effort, and the level\'s extra lines', () => {
  const at = (level, extra = {}) => routingFrom({ config, views: { settings: settingsAt(level, extra.premium), columnsReady: ready('lean', 'lightest', 'premium') }, now });
  const balanced = columnLines(at('balanced'));
  assert.match(balanced[0], /Thoroughness: Balanced/);
  assert.deepEqual(balanced.slice(1), [
    'builder: model model-top, effort medium',
    'mechanical: model model-mid, effort medium',
    'builderCritical: model model-top, effort high',
    'reviewer: model model-mid, effort high',
    'reviewerCritical: model model-top, effort high',
    'tester: model model-top, effort medium',
  ]);
  for (const level of ['lean', 'lightest']) {
    const lines = columnLines(at(level));
    assert.ok(lines.includes(REWORK_LINE), level);
    assert.ok(!lines.includes(SECOND_REVIEWER_LINE), level);
  }
  assert.ok(columnLines(at('lean')).includes('builder: model model-mid, effort medium'));
  const thorough = columnLines(at('thorough'));
  assert.ok(thorough.includes(SECOND_REVIEWER_LINE));
  assert.ok(!thorough.includes(REWORK_LINE));
  assert.ok(thorough.includes('builderCritical: model model-top, effort xhigh'));
  assert.ok(columnLines(at('thorough', { premium: 'paid-too' })).includes('builderCritical: model model-premium, effort high'));
  // Neither the foreman nor the feature session itself is a subagent.
  assert.ok(!thorough.some((l) => /^(foreman|feature):/.test(l)));
  // A role with no model named runs on the session's own.
  const none = columnLines(routingFrom({ config: { routing: {} }, views: {}, now }));
  assert.ok(none.includes("builder: model the session's own, effort medium"));
  assert.equal(REWORK_LINE, 'When a task is sent back by its review, build it again at effort high.');
  assert.equal(SECOND_REVIEWER_LINE, 'Critical-area work gets a second fresh reviewer; both must report CLEAN.');
});
