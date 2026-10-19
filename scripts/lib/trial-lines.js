// scripts/lib/trial-lines.js
// The safety trials' one line each, `<trial>: <expected> / <result>` (scripts/health/trials.js),
// read back. The setup session hands its trials' lines to `cli.js health` as arguments, so the
// stop guard, which lets that reading form through under STOP, reads them here too: a line holds
// only lower-case words, digits and a little punctuation, never a value, a quote or anything a
// shell would act on.

// The most lines handed in at once: the trials print seven.
export const MOST_TRIAL_LINES = 12;
// The longest line taken: the trials' own are well under it.
export const TRIAL_LINE_CHARS = 120;
export const TRIAL_LINE = /^([a-z0-9 .\/-]+): ([a-z, ]+) \/ ([A-Za-z(), ]+)$/;

// { name, expected, result } for a trial line, or null for anything else.
export function parseTrialLine(line) {
  if (typeof line !== 'string' || line.length > TRIAL_LINE_CHARS) return null;
  const found = TRIAL_LINE.exec(line);
  return found ? { name: found[1], expected: found[2], result: found[3] } : null;
}
