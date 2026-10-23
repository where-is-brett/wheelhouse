// probes/mac-sitting/last-action.mjs
// When the director last did something the project can see: the latest of their records (an
// approval, a confirmation, an action, a card answer or a setting, which a press or an answer
// makes) and of the prompts they typed or phoned (the observer's prompt.submit with origin
// `composer` or `bridge`, which also covers a line that makes no record, such as /digest), and
// the briefing's mark of their last message (`seen.promptAt`). Pure: it takes check.mjs's
// `records` list, the observer's lines and `seen`, so it runs without preparation.
// Pane moves that send nothing (Next, Back, Settings) and the lock itself aren't seen.
export const DIRECTOR_KINDS = ['approval', 'confirmation', 'action', 'card-answer', 'setting'];
export const DIRECTOR_ORIGINS = ['composer', 'bridge'];

export function lastAction({ records = [], observer = [], seen = null, since } = {}) {
  const floor = since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(since);
  const found = [
    ...records.filter((r) => DIRECTOR_KINDS.includes(r?.kind)).map((r) => ({ at: r.at, what: `${r.kind}${r.data?.label ?? r.data?.words ? ` "${r.data?.label ?? r.data?.words}"` : ''}` })),
    ...observer.filter((o) => o?.event === 'prompt.submit' && DIRECTOR_ORIGINS.includes(o.origin)).map((o) => ({ at: o.at, what: `prompt from ${o.origin}` })),
    ...(typeof seen?.promptAt === 'string' ? [{ at: seen.promptAt, what: 'their last message (seen.promptAt)' }] : []),
  ].filter((s) => typeof s.at === 'string' && Date.parse(s.at) >= floor);
  found.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return found.at(-1) ?? null;
}
