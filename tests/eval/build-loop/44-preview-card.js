// tests/eval/build-loop/44-preview-card.js
// Scenario 44 (Archon design, sections 9 and 18): visible work reaches its approval with the pictures its preview step
// took kept for the pull request's head. Pass: the approval card names the pull request and its head, offers Show me
// (which opens the kept preview), and the pictures it opens are of that head; nothing is added before the director's
// signed Approve. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { approving } from './engine-recordings.js';

const HEAD = '4444444a2b3c4d5e6f708192a3b4c5d6e7f80912';
const DOC = '4'.repeat(64);

export default {
  id: 44,
  title: 'Visible work comes to the director as an approval card with its preview',
  engine: {
    recordings: { 'card-44': approving('card-44', { pr: 44, head: HEAD }) },
    async play(world) {
      world.put('work', { id: 'card-44', title: 'The sale banner', lane: 'quick', visible: true, dependsOn: [], doc: { path: 'docs/work/card-44.md', hash: DOC } });
      world.put('action', { action: 'approve-work', question: 'Approve card-44 (quick lane) as written, and show it to me before it merges', label: 'Approve', work: 'card-44', lane: 'quick', hash: DOC, shownFirst: true });
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `${world.starts().length} runs started for visible work the director approved` };
      // The preview step's pictures, kept by the helper for the head (part 3b's preview route).
      world.put('preview', { work: 'card-44', head: HEAD, folder: 'previews/card-44/' + HEAD, pages: ['phone/index.png', 'desktop/index.png'] });
      const card = await until(() => world.records('card').find((c) => /#44/.test(c.data.question ?? '')));
      if (!card) return { pass: false, why: 'no approval card was written' };
      const text = card.data.question;
      if (!text.includes(HEAD.slice(0, 12))) return { pass: false, why: 'the card doesn\'t name the head it approves' };
      if (!(card.data.options ?? []).includes('Show me')) return { pass: false, why: 'the card doesn\'t offer Show me' };
      const kept = world.views().previews?.['card-44']?.at(-1)?.data;
      if (kept?.head !== HEAD || kept.pages.length === 0) return { pass: false, why: 'Show me would open no pictures of this head' };
      if (world.acts().length > 0) return { pass: false, why: 'the engine was answered before the director approved' };
      return { pass: true, why: 'an approval card for the head, Show me offered, its pictures kept, nothing answered for the director' };
    },
  },
  variants: { with: {} },
};
