// tests/helpers/provenance.js
// Provenance for tests: what matches a manifest, a pull request body stamped with it, and a
// session's provenance.json with a transcript of made-up models.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from '../../scripts/lineage/manifest.js';
import { provenanceFile } from '../../scripts/lineage/check.js';
import { stampProvenance } from '../../scripts/lineage/provenance.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// What a session built with the Wheelhouse at `root` records, matching its manifest.
export function matchingProvenance(root = REPO_ROOT, over = {}) {
  const manifest = readManifest(root);
  return {
    wheelhouse: manifest.wheelhouse.version,
    upstreams: Object.fromEntries(manifest.upstreams.map((u) => [u.name, u.sha])),
    register: '0.0.0',
    claudeCode: manifest.claudeCode.floor,
    models: ['model-a'],
    fingerprints: 'match',
    ...over,
  };
}

// A pull request body that the merge gate finds matching the manifest at `root`.
export function matchingBody(text = 'The change.', root = REPO_ROOT) {
  return stampProvenance(text, matchingProvenance(root));
}

// Writes the session's provenance.json (under WHEELHOUSE_HOME) and a transcript beside it
// whose assistant entries name `models`. Returns the file.
export function writeSessionProvenance(project, sessionId, { root = REPO_ROOT, models = ['model-a'], ...over } = {}) {
  const file = provenanceFile(project, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const transcript = path.join(path.dirname(file), 'transcript.jsonl');
  const entries = [
    { type: 'user', message: { content: 'go' } },
    ...models.map((model) => ({ type: 'assistant', message: { model, content: [] } })),
    { type: 'assistant', message: { model: '<synthetic>', content: [] } },
  ];
  fs.writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join('\n'));
  const { models: _models, ...kept } = matchingProvenance(root);
  fs.writeFileSync(file, JSON.stringify({ ...kept, transcript, ...over }));
  return file;
}
