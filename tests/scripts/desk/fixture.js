// tests/scripts/desk/fixture.js
// A project's record for the desk's tests, written as the helper leaves its views on disk: one card
// waiting (an approval of a plan), one piece of open work, a project setting, the director's own
// setting, a survey and a sources report. The home is the test's own (homes.js `as`).
import fs from 'node:fs';
import path from 'node:path';
import { writeProject } from '../../../scripts/lib/projects.js';
import { profileViewsDir, sourcesDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { composeCard } from '../../../scripts/cards/compose.js';

export const P = 'owner__name';
export const NOW = '2026-10-29T12:00:00.000Z';
export const now = () => new Date(NOW);
const DOC = 'a'.repeat(64);

export const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

export const CARD = composeCard({
  kind: 'approve-work', level: 3, recommend: 'Approve',
  what: 'The plan for exporting a report as a spreadsheet file (export-csv).',
  why: 'It changes what users see, which is yours to decide at level 3.',
  because: 'the plan is small and the checks are written.',
  meanwhile: 'Nothing is built until you say.',
  options: [{ label: 'Approve', says: 'It approves the plan and building starts.' }],
  target: { work: 'export-csv', lane: 'feature', hash: DOC },
}).card;

export const viewsDir = () => path.join(wheelhouseHome(), 'projects', P, 'views');

// Registers the project with its main folder under `home`, writes its views, and gives the folder.
export function writeRecord(home) {
  const repo = path.join(home, 'repo');
  put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
  const views = viewsDir();
  put(path.join(views, 'waiting.json'), [{ id: 'c1', at: '2026-10-29T09:00:00.000Z', data: CARD, asked: { at: '2026-10-29T09:05:00.000Z', label: null } }]);
  put(path.join(views, 'work.json'), { 'export-csv': { work: { id: 'w1', at: '2026-10-29T08:00:00.000Z', data: { title: 'Export a report as a spreadsheet file', lane: 'feature' } }, approved: false } });
  put(path.join(views, 'settings.json'), { briefing: { key: 'briefing', id: 's1', at: '2026-10-01T00:00:00.000Z', value: 'short', before: null } });
  put(path.join(views, 'survey.json'), { id: 'sv1', at: '2026-10-28T00:00:00.000Z', data: { hostReached: true, requests: [{ number: 4, title: 'Tidy the footer' }], rules: [] } });
  put(path.join(views, 'glossary.json'), {});
  put(path.join(profileViewsDir(), 'settings.json'), { explanations: { key: 'explanations', id: 'p1', at: '2026-10-01T00:00:00.000Z', value: 'plain', before: null } });
  put(path.join(sourcesDir(), 'report.json'), { at: '2026-10-28T00:00:00.000Z', sources: [{ id: 'models', ok: true, changed: false }], newModels: [], newLinks: [], retiring: [], releases: [], advisories: [] });
  return repo;
}

// A helper client that is up and holds no lock, so nothing waits on a real helper.
export const upClient = { health: async () => ({ ok: true }), lock: { read: async () => ({ ok: true, result: null }) } };
