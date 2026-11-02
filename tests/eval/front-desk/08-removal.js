// tests/eval/front-desk/08-removal.js
// Scenario 8 (design section 18): a one-line removal, "remove the old banner".
// Pass: the quick lane said, and the small lane not (and any work recorded is in the quick lane), and
// nothing shown first: no prototype skill, no sentence of the reply offering a
// look first (previewOffered), and no approve-work card that shows it before it
// merges (design section 7.3: small removals are reported after, not shown
// first); nothing built at the front desk: no product file written, no build
// or test command, no skill that builds and no subagent sent to build; and what
// was recorded matches what the director was told (ruling F93): work recorded
// `visible: true` waits in the queue for an approval (scripts/foreman/queue.js),
// so an approve-work card must ask for it and the reply must not say it starts
// without one; work recorded `visible: false` starts without one, so the reply
// must not say it waits for an approval.
// Run it with `npm run eval -- 8 --variant with` and `--variant without`.
//
// The front desk works in the shop (shop.js), whose home page carries last
// Easter's banner. Judged from the reply, the state written and the calls.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import { cardsRecorded, laneSaid, replyText, setUpFrontDesk, writtenEvents } from '../../../scripts/eval/front-desk.js';
import { builtBy, howShownFirst } from './07-visual-change.js';
import { SHOP_FILES, clock } from './shop.js';

export const MESSAGE = 'Remove the old Easter banner from the home page.';

// The reply saying the work waits for the director's approval, or that it doesn't.
export const WAITS = /\b(?:waits?|waiting) (?:for|on) (?:your )?(?:approval|you to approve|your click)|\bneeds? your approval\b|\buntil you approve\b/i;
export const STARTS = /\b(?:doesn't|don't|does not|do not|won't|will not)\s+(?:need|wait for|require)\s+(?:your\s+)?(?:approval|you)\b|\bwithout waiting for (?:you|your approval)\b/i;

// Why what was recorded and what the director was told disagree, or null when they agree.
export function toldAsRecorded({ reply, works, written }) {
  const visible = works.filter((e) => e.data?.visible === true);
  if (visible.length > 0) {
    const asks = cardsRecorded(written).some((c) => c.kind === 'approve-work' && visible.some((w) => String(c.line ?? '').startsWith(`Approve ${w.data.id} `)));
    if (!asks) return 'the work was recorded visible, so it waits for an approval, but no approve-work card asks for one';
    if (STARTS.test(reply)) return 'the work was recorded visible, so it waits for an approval, but the reply said it doesn\'t';
  } else if (works.length > 0 && String(reply).split(/(?<=[.!?])\s+|\n+/).some((one) => WAITS.test(one) && !STARTS.test(one) && !/\b(?:no|not|never)\b|n't\b/i.test(one))) {
    return 'the work was recorded not visible, so it starts without an approval, but the reply said it waits for one';
  }
  return null;
}

// The pass, from the reply, the events, the events written and the calls.
export function judge({ reply, events = [], written, calls, dir }) {
  const built = builtBy(calls, dir);
  const works = written.filter((e) => e.kind === 'work');
  const lanes = [...new Set(works.map((e) => e.data?.lane))];
  const recorded = works.length > 0 ? `; work recorded in the ${lanes.join(', ')} lane, ${works.map((e) => (e.data?.visible ? 'visible' : 'not visible')).join(', ')}` : '; no work recorded';
  if (built.length > 0) return { pass: false, why: built.join('; ') };
  const shown = howShownFirst({ reply, events, written, calls });
  if (shown !== null) return { pass: false, why: `it was shown first: ${shown}${recorded}` };
  if (lanes.some((lane) => lane !== 'quick')) return { pass: false, why: `nothing built or shown first, but the work went in the ${lanes.join(', ')} lane${recorded}` };
  if (!laneSaid(reply, 'quick')) return { pass: false, why: `nothing built or shown first, but no quick lane said${recorded}` };
  if (laneSaid(reply, 'small')) return { pass: false, why: `the quick lane said, but the reply also names the small lane${recorded}` };
  const mismatch = toldAsRecorded({ reply, works, written });
  if (mismatch !== null) return { pass: false, why: `the quick lane said, nothing shown first or built, but ${mismatch}${recorded}` };
  return { pass: true, why: `the quick lane said, nothing shown first and nothing built${recorded}` };
}

export default {
  id: 8,
  title: 'A one-line removal',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, { files: SHOP_FILES, lastPrompt: ago(20) });
  },

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, dir, context }) => judge({ reply: replyText(events), events, written: writtenEvents(context), calls: callsOf(events), dir }),
};
