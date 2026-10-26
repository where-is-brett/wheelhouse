// scripts/routing/premium.js
// The premium model's opt-in (design section 14.6, "The premium model"): its card, which the helper composes and
// signs as offered when the front desk asks for it, the setting a click on one of its Allow options makes, and the
// premium pin the state holds once the helper has asked Claude Code what its premium alias stands for.
// Pure functions: callers pass the state's views and what they have read.
//
// What holds, by the director's rulings (24 October 2026): the card is offered at Thorough only, never by default and
// never on an account known not to have the model; nothing touches the model before the director's Yes, not even the
// alias check; the Yes within the plan never pays from credits, and paying from credits is a Yes of its own, on its
// own option; and the front desk never runs on it.
//
// The premium pin lives in the state, not in the project's configuration: it is the model the helper's own check named
// for the Yes that allowed it (a premium-check record, which only the helper writes), so the Yes covers the model it
// named, and a pin an agent writes into .claude/wheelhouse.json counts for nothing. A new model needs a new Yes.
import { NOT_NOW } from '../lib/calm-words.js';

// The premium setting's values (scripts/settings/catalogue.js) that allow the model.
export const PREMIUM_ON = Object.freeze(['within-plan', 'paid-too']);
// The Allow options, by the setting a click on each makes.
export const ALLOW_WITHIN = 'Allow it within my plan';
export const ALLOW_PAID = 'Allow it, paid credits too';
export const ALLOW_PAID_ON_TOP = 'Allow paid credits too';
// How long a premium card's Allow options count after the helper offers it: a designer's call, a day, so a card left
// unanswered can't be clicked a week later into a setting the director has since forgotten.
export const PREMIUM_CARD_MS = 24 * 60 * 60 * 1000;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

// The setting a click on `label` makes, on a card offered from `from` (off or within-plan), or null for any other
// label (Not now and Suggest a change… among them).
export function premiumValueOf(from, label) {
  if (from === 'off') return { [ALLOW_WITHIN]: 'within-plan', [ALLOW_PAID]: 'paid-too' }[label] ?? null;
  if (from === 'within-plan') return label === ALLOW_PAID_ON_TOP ? 'paid-too' : null;
  return null;
}

// The card, as the composer's input (scripts/cards/compose.js), for the premium setting in force `from` and the time
// of the offer `at`. Level 4: its Yes writes the premium pin into the routing as a guardrail change. The words are
// section 14.6's, with the account check said as it is: the check is made only after the Yes.
export function premiumInput({ from, at }) {
  const meanwhile = "If you allow it, I first check your account has it, then try it on your project's own checks, which uses some of it. Nothing changes until it passes, and I'll tell you when it does.";
  const checks = 'Every check still runs. Work it writes is reviewed by a different model, and the front desk stays on its own model.';
  if (from === 'within-plan') {
    return {
      kind: 'premium',
      level: 4,
      ask: 'Allow the premium model to use paid credits too?',
      what: "You allowed Claude's largest model within your plan. Within your plan it is used only once I can tell beforehand that a run won't be paid from your usage credits, and for now I can't.",
      why: 'Paid credits are real money, so only you can allow them, on their own.',
      options: [
        { label: ALLOW_PAID_ON_TOP, says: 'Design and risky work at Thorough may then be paid from your usage credits, which is real money.' },
        { label: NOT_NOW, says: 'It stays within your plan.' },
      ],
      recommend: NOT_NOW,
      because: 'within your plan it costs you nothing extra. Allow paid credits only if better design is worth real money to you',
      meanwhile: 'Work carries on as it is.',
      checks,
      target: { at },
    };
  }
  return {
    kind: 'premium',
    level: 4,
    ask: 'Allow the premium model at Thorough?',
    what: "Claude has a larger model than the one Wheelhouse uses now, on accounts that have it. It may design better, and it costs about two and a half times as much. Its use can be paid from your usage credits, which is real money, and Wheelhouse can't see its separate weekly limit.",
    why: 'It can spend money, so only you can allow it.',
    options: [
      { label: ALLOW_WITHIN, says: "It's used for design and risky work at Thorough, only when a run won't be paid from your usage credits." },
      { label: ALLOW_PAID, says: 'It\'s used for design and risky work at Thorough, and may be paid from your usage credits, which is real money.' },
      { label: NOT_NOW, says: 'Nothing changes.' },
    ],
    recommend: ALLOW_WITHIN,
    because: "it's worth it if you often have allowance left at the end of the week. For now I can't tell beforehand whether a run would be paid from credits, so within your plan it will be used only once I can",
    meanwhile,
    checks,
    target: { at },
  };
}

// The premium view (views.js `premium`): the premium setting in force, the helper's check made for it, and whether
// the account is known not to have the model. From the accepted `settings` view entry and the state's events.
// { value, setting, at, check: { model, found, at } | null, absent, failed, rest }. Only a check or a failure `signed`
// passes (the views pass the enrolled computers' signature check) counts. `failed` is the helper's record that the
// premium model's evaluation failed for this Yes ({ id, at, model }, or null): it then stays off, and nothing more is
// run on it under that Yes. `rest` is the premium model's rest after a usage limit or a billing refusal
// ({ until, why }, or null), while `now` is before its end.
export function premiumState({ setting, events, signed = () => false, now = () => new Date() }) {
  const list = Array.isArray(events) ? events : [];
  const value = isPlain(setting) && PREMIUM_ON.includes(setting.value) && typeof setting.premiumCard === 'string' ? setting.value : 'off';
  const id = value === 'off' ? null : setting.id;
  const checks = list.filter((e) => e?.kind === 'premium-check' && isPlain(e.data) && typeof e.at === 'string' && signed(e)).sort(byTime);
  const own = id === null ? undefined : checks.findLast((e) => e.data.setting === id);
  // Known not to have it: the latest check found none, and setup hasn't run since (its survey), which is when the
  // card may be offered again (design section 14.6).
  const last = checks.at(-1);
  const surveyed = list.some((e) => e?.kind === 'survey' && typeof e.at === 'string' && last !== undefined && e.at > last.at);
  const failure = id === null ? undefined : list.filter((e) => e?.kind === 'premium-failed' && isPlain(e.data) && e.data.setting === id && typeof e.at === 'string' && signed(e)).sort(byTime).at(-1);
  return {
    value,
    setting: id,
    at: value === 'off' ? null : setting.at,
    check: own === undefined ? null : { model: own.data.model, found: own.data.found === true, at: own.at },
    absent: last !== undefined && last.data.found !== true && !surveyed,
    failed: failure === undefined ? null : { id: failure.id, at: failure.at, model: failure.data.model },
    rest: restOf(list, now),
  };
}

// The premium model's rest in force at `now`, as { until, why }, or null: the rest that ends last among the
// premium-rest records, while its end is to come. A record can only make a rest longer, never cut one short.
export function restOf(events, now = () => new Date()) {
  const nowMs = (typeof now === 'function' ? now() : new Date(now)).getTime();
  const rests = (Array.isArray(events) ? events : []).filter((e) => e?.kind === 'premium-rest' && isPlain(e.data) && typeof e.at === 'string' && !Number.isNaN(Date.parse(e.data.until)));
  const last = rests.sort((a, b) => Date.parse(a.data.until) - Date.parse(b.data.until)).at(-1);
  return last !== undefined && Date.parse(last.data.until) > nowMs ? { until: last.data.until, why: last.data.why } : null;
}

// --- When it can't be used (design section 14.6): a usage limit or a billing refusal ---

// How much of the end of a run's output is read when its exit wasn't seen.
const TAIL_CHARS = 2000;
// How long the premium model rests after a limit or a refusal whose end isn't known: a day.
export const REST_MS = 24 * 60 * 60 * 1000;
// The board's line while it rests.
export { PREMIUM_RESTING as REST_LINE } from './thoroughness.js';

// Why a premium wake that ended with `code` stopped, from what it printed (`output`): 'limit' for a usage limit,
// 'billing' for a billing or credits refusal, or null for anything else, a wake that ended well among them. With the
// limit's end when the output gives it, as a time. Only a wake that ended in failure is read, so an answer that
// merely mentions a limit is never taken for one.
// A run whose exit wasn't seen (`code` null) is read from its last lines only, where Claude Code says why it stopped,
// so a finished wake that wrote about rate limits in its work isn't taken for a refusal.
export function refusalOf(output, code) {
  if (code === 0) return null;
  const whole = String(output ?? '');
  const text = code === null || code === undefined ? whole.slice(-TAIL_CHARS) : whole;
  const reset = /usage limit reached\|(\d{9,11})\b/i.exec(text);
  if (reset) return { why: 'limit', until: new Date(Number(reset[1]) * 1000).toISOString() };
  if (/credit balance is too low|insufficient (credits|funds)|out of (usage |extra usage )?credits|out of extra usage|payment required|billing (error|refus)|extra usage (is )?(off|not enabled|exhausted)/i.test(text)) return { why: 'billing', until: null };
  if (/usage limit|hit your (usage |weekly )?limit|reached (your|the) [\w ]*limit|limit reached|rate limit|too many requests|\b429\b/i.test(text)) return { why: 'limit', until: null };
  return null;
}

// When a rest from a refusal at `at` ends: the limit's own end when it was given and is to come, else a day on.
export function restUntil(refusal, at) {
  const atMs = Date.parse(at);
  const given = typeof refusal?.until === 'string' ? Date.parse(refusal.until) : NaN;
  return new Date(Number.isFinite(given) && given > atMs ? given : atMs + REST_MS).toISOString();
}

// --- When its evaluation fails (design section 14.6, "What the Yes starts") ---

// The option on the failed evaluation's card that has the front desk offer the premium model's card again, for a new Yes.
export const TRY_AGAIN = 'Try it again';

// The card for a failed evaluation, as the composer's input: plain words, and nothing it decides itself. Try it again
// only has the front desk offer the premium model's card again, whose own Yes alone allows it.
export function failedInput(record) {
  return {
    kind: 'question',
    level: 3,
    what: "Claude's largest model didn't pass your project's own checks, so it isn't used. Design and risky work stay on the most capable standard model, and nothing more is charged for the larger one.",
    why: 'You allowed it, so you hear how its trial went.',
    options: [
      { label: 'OK', says: 'Nothing changes.' },
      { label: TRY_AGAIN, says: "I offer you its card again. Nothing is spent unless you allow it there, and it's tried on your project's checks again first." },
    ],
    recommend: 'OK',
    because: 'nothing needs doing: it stays off',
    meanwhile: 'Work carries on as it is.',
    suggest: false,
    event: record.id,
  };
}

// The premium pin the state holds now: the model the helper's check found for the Yes in force, or null.
export const premiumPinOf = (view) => (isPlain(view) && PREMIUM_ON.includes(view.value) && view.check?.found === true && typeof view.check.model === 'string' ? view.check.model : null);

// `config` with the premium pin the state holds, in place of any the configuration names: only the helper's check
// for the director's Yes names it.
export function withPremiumPin(config, view) {
  const pin = premiumPinOf(view);
  const pins = isPlain(config?.tiers?.pins) ? { ...config.tiers.pins } : null;
  if (pins === null) return config;
  delete pins.premium;
  return { ...config, tiers: { ...config.tiers, pins: pin === null ? pins : { ...pins, premium: pin } } };
}

// The setting a premium card is offered from for `view`: off, within the plan, or off again once its evaluation failed.
export const offeredFrom = (view) => (view?.value === 'within-plan' && !isPlain(view.failed) ? 'within-plan' : 'off');

// Why the premium card isn't offered now, in the director's words, or null when it is: at Thorough only, never while
// it is already on with paid credits, and never on an account the check found without it, until setup runs again. A
// Yes whose evaluation failed counts as off: the card offers a new Yes.
export function premiumRefusal({ level, view }) {
  if (level !== 'thorough') return 'The premium model is offered at Thorough only.';
  if (view?.absent === true) return "Your account doesn't have the premium model. I'll offer it again after setup runs and finds it.";
  if (view?.value === 'paid-too' && !isPlain(view.failed)) return 'The premium model is already allowed, paid credits too.';
  return null;
}

// Whether the helper may ask Claude Code what the premium alias stands for (design section 14.6): only for a Yes in
// force with no check made for it yet, and only when the run can't bill credits the director hasn't allowed. Within the
// plan alone, Wheelhouse can't tell beforehand whether even that one-reply run would be paid from credits (check 76),
// so it waits. Null when it may, else why not.
export function checkRefusal(view, { billing = 'unknown' } = {}) {
  if (!PREMIUM_ON.includes(view?.value)) return 'the premium model is not allowed, so nothing is checked';
  if (view.check !== null && view.check !== undefined) return 'the premium model was checked for this Yes already';
  if (view.value !== 'paid-too' && billing !== 'within-plan') return "within your plan alone, Wheelhouse can't yet tell whether even the check would be paid from credits, so it waits";
  return null;
}

// What a premium check found, from the models the premium and most capable aliases named: a model name that is not the
// most capable model (which the premium alias names on an account without the premium model).
export const foundPremium = (model, mostCapable) => typeof model === 'string' && model !== '' && model !== mostCapable;

// The words before the premium card's AskUserQuestion input, as JSON on the same line, and what a pick of it does: the
// director's click on an Allow option is the setting change and their confirmation of it at once, which the prompt
// record signs, so the front desk records nothing and asks no confirm card; it then asks the helper to check the account.
export const PREMIUM_ASK = "The premium model's card for the director: ask it with AskUserQuestion, exactly as given, as a question of its own: ";
export const PREMIUM_DO = ' The director\'s click on an Allow option is the change itself, recorded and confirmed by that click: record nothing and ask no confirm card. After such a click, run `premium-check` and tell the director in one line what it says. Any other pick changes nothing.';
