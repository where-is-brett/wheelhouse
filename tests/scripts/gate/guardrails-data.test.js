// tests/scripts/gate/guardrails-data.test.js
// What counts as data work: the migration places every project has, and the `paths` a project adds (design section 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiff, dataModelPaths, readConfig } from '../../../scripts/gate/guardrails.js';

const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
const withCheck = (dataCheck) => readConfig(JSON.stringify({ ...base, dataCheck }));

test('the default places cover each migration tool\'s own folder', () => {
  for (const file of [
    'db/migrations/001_x.sql', 'src/db/migrate/002.rb', 'prisma/schema.prisma', 'db/schema.rb', 'db/structure.sql',
    'src/main/resources/db/migration/V2__boats.sql', 'service/alembic/versions/ab12_add_boats.py',
    'drizzle/0001_boats.sql', 'app/drizzle/meta/0002_more.sql', 'prisma/schema/boats.prisma',
  ]) assert.deepEqual(dataModelPaths([file]), [file], file);
});

test('stray sql files, seeds and unrelated files are not data work', () => {
  for (const file of ['queries/report.sql', 'db/seeds.rb', 'db/seed.sql', 'src/boats.ts', 'prisma/client.ts', 'drizzle/README.md', 'docs/migration-notes.md']) {
    assert.deepEqual(dataModelPaths([file]), [], file);
  }
});

test('a project\'s own paths add to the defaults, and classifyDiff uses both', () => {
  const config = withCheck({ command: 'node print.js', paths: ['warehouse/**/*.ddl'] });
  assert.deepEqual(dataModelPaths(['warehouse/a/boats.ddl', 'db/migrations/1.sql', 'src/x.ts'], config), ['warehouse/a/boats.ddl', 'db/migrations/1.sql']);
  assert.deepEqual(dataModelPaths(['warehouse/a/boats.ddl']), [], 'without the project\'s paths it is not');
  const found = classifyDiff({ paths: ['warehouse/a/boats.ddl'], read: () => null, config });
  assert.deepEqual(found.directorLevel, [{ kind: 'data-model', paths: ['warehouse/a/boats.ddl'] }]);
});

test('the configuration validates `paths`', () => {
  assert.deepEqual(withCheck({ command: 'node print.js', paths: ['a/**'] }).dataCheck.paths, ['a/**']);
  for (const bad of ['a/**', [1], [''], ['a//b'], { a: 1 }]) assert.throws(() => withCheck({ command: 'node print.js', paths: bad }), /./, JSON.stringify(bad));
});
