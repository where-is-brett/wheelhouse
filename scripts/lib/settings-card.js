// scripts/lib/settings-card.js
// The card that asks the director to confirm this computer's git settings again, after a push was refused because they
// differ from the ones confirmed at setup (scripts/lib/safe-git.js), and the names of settings it shows. It shows names only,
// never values, which can carry a proxy's sign-in. The helper composes it from its own read of the settings, raises it, and
// signs the director's click on it in its own window; nothing else confirms the settings.
import { CARD } from './front-desk.js';
import { sayLaunch } from './launch-words.js';

// The code a refused push carries when its reason is that the settings changed.
export const SETTINGS_CHANGED = 'git-settings-changed';

export const SETTINGS_CARD_LABEL = 'Confirm';
const NOT_NOW = 'Not now';
const NAMES_SHOWN = 6;
const NAME_CHARS = 40;

// The line the card carries, naming the settings it is for by twelve characters of their fingerprint: the window signs a click only
// for a card that holds exactly one, and only while the settings still read as that.
export const settingsLine = (hash) => `Trust this computer's git settings as they are now, ${String(hash).slice(0, 12)}`;
export const SETTINGS_LINE = /^Trust this computer's git settings as they are now, ([0-9a-f]{12})$/;

// A setting's name as the card says it: its first and last parts, so a section's own name (an address, which can hold a sign-in)
// is never shown, and only letters, digits, `.`, `_` and `-` of it, a long run of them hidden.
export function settingName(key) {
  const parts = String(key).toLowerCase().split('.');
  const short = parts.length > 2 ? `${parts[0]}.${parts.at(-1)}` : parts.join('.');
  const clean = short.replace(/[^a-z0-9._-]/g, '').replace(/[a-z0-9_-]{24,}/g, '<long>');
  return clean.length > NAME_CHARS ? `${clean.slice(0, NAME_CHARS)}...` : clean;
}

// The names of the settings a push trusts, once each, in order.
export const settingNames = (keys) => [...new Set(keys.map(settingName).filter((n) => n !== ''))].sort();

// What changed in the names: { added, removed, changed } from the names kept at confirmation and the names now, and `changed`, the
// names whose value differs (named by `changed`, names only), or null when no names were kept (a record from before names were
// kept, or a folder never confirmed).
// `otherGit` (given as true when the settings are read now by another git program than the one that confirmed them) is kept.
export function settingsChange({ names, was, changed = [], otherGit = false }) {
  if (!Array.isArray(was)) return null;
  const before = new Set(was);
  const now = new Set(names);
  return { added: names.filter((n) => !before.has(n)), removed: was.filter((n) => !now.has(n)), changed, ...(otherGit === true ? { otherGit: true } : {}) };
}

const listed = (names) => {
  const shown = names.slice(0, NAMES_SHOWN).map(settingName).join(', ');
  return names.length > NAMES_SHOWN ? `${shown} and ${names.length - NAMES_SHOWN} more` : shown;
};

function changeLine(change) {
  if (change === null) return 'Wheelhouse kept no list of their names to compare with, so it can\'t say which ones changed.';
  const parts = [];
  if (change.added.length > 0) parts.push(`added: ${listed(change.added)}`);
  if (change.removed.length > 0) parts.push(`taken away: ${listed(change.removed)}`);
  if (change.changed?.length > 0) parts.push(`value differs: ${listed(change.changed)}`);
  const said = parts.length > 0 ? `Settings ${parts.join('; ')}.` : 'No setting was added or taken away, so one of them has a different value.';
  // Each git program on a computer has settings of its own, so a different one can account for the difference with nothing changed.
  return change.otherGit === true ? `${said} Wheelhouse now reads them with another git program than the one they were confirmed with, and each has settings of its own.` : said;
}

// The card, for the settings whose fingerprint is `hash` and what changed in their names. Its question is the whole of what the
// director reads, so the helper signs a click only for the card it composes again from its own read, word for word.
export function settingsCard(hash, change) {
  const line = settingsLine(hash);
  return {
    question: [
      'This computer\'s git settings (sign-in, proxy, certificate and address rewrites) are not the ones you confirmed, so nothing is pushed.',
      changeLine(change),
      'Confirm them only if you changed them yourself, or your IT team did. Confirm is clicked in Wheelhouse\'s own window, never in the chat.',
      'Recommended: Not now, unless you know why they changed. Until you confirm, nothing is pushed.',
      line,
    ].join('\n'),
    header: 'Git settings',
    options: [SETTINGS_CARD_LABEL, NOT_NOW],
    kind: 'question',
    level: 4,
    recommend: NOT_NOW,
    line,
  };
}

// What the session start tells the First Mate when the lock could not be pushed for this reason and the helper raised the card.
export const settingsCardNote = (card) => `This computer's git settings changed, so nothing can be pushed. Tell the director in one plain line that a card waits for them in Wheelhouse's own window, then run the Wheelhouse command \`confirm ${card}\`; its click is the only way to confirm them.`;

// The card that shows the launch command back before it is saved (design section 8.2): the words the director typed, split by
// scripts/lib/launch-words.js, one per line. It is asked in the chat, and its click is the director's own. `words` is the array
// splitLaunch gave; `computerName` is this computer's name when there is one.
export const LAUNCH_SAVE = 'Save it';
export function launchCard(words, { computerName = 'this computer' } = {}) {
  const line = sayLaunch(words);
  const make = (listed) => [
      `Builders on ${computerName} will start \`claude\` through this program.`,
      line,
      ...(listed ? words.map((word, i) => `${i + 1}. ${word}`) : []),
      'Save it only if this is the program you meant. It runs on every builder start on this computer.',
      'Recommended: Save it, if the words above are right. Until you do, builders start as they do now.',
    ].join('\n');
  // One word to a line when the card has room for both; the line alone otherwise, and never a card that cuts the words short.
  let question = make(true);
  if (question.length > CARD.chars) question = make(false);
  if (question.length > CARD.chars) throw new Error('This launch command is too long to show whole on a card.');
  return {
    question,
    header: 'Launch',
    options: [LAUNCH_SAVE, NOT_NOW],
    kind: 'question',
    level: 4,
    recommend: LAUNCH_SAVE,
    line,
  };
}
