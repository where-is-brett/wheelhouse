// tests/helpers/copilot-kits.js
// A pinned kit for tests of Copilot sessions' homes, never fetched from the network: one upstream whose two skills
// (`alpha` and `beta`) sit in a local folder, its manifest fingerprinted from that folder, and a `fetchTo` that copies
// the folder in. Pass `kits` where the kits functions take `{ manifest, fetchTo }` (scripts/agents/copilot/kits.js).
import fs from 'node:fs';
import path from 'node:path';
import { fingerprintTree } from '../../scripts/lineage/fingerprint.js';
import { tempFolder } from './homes.js';

export const KIT_SKILLS = Object.freeze(['alpha', 'beta']);

export function localKits() {
  const source = tempFolder('wh-kit-source-');
  for (const [file, text] of [['skills/alpha/SKILL.md', 'Alpha.\n'], ['skills/beta/SKILL.md', 'Beta.\n'], ['README.md', 'Not used.\n']]) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), text);
  }
  const upstream = {
    name: 'kit-a', plugin: 'kit-a', repo: 'https://example.invalid/kit-a.git', ref: 'v1', sha: 'a'.repeat(40),
    folders: KIT_SKILLS.map((name) => ({ path: `skills/${name}`, hash: fingerprintTree(path.join(source, 'skills', name)).hash })), files: [],
  };
  const fetched = [];
  const fetchTo = async (u, dir) => {
    fetched.push(u.name);
    fs.cpSync(source, dir, { recursive: true });
  };
  return { kits: { manifest: { upstreams: [upstream] }, fetchTo }, fetched };
}
