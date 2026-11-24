// scripts/desk/is-open.js
// Whether a piece of work is open. It sits apart from the desk's views so the guards can ask it without loading every view;
// scripts/desk/views.js re-exports it.
import { endedBy, since } from '../foreman/queue.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Whether `id` names open work, as the queue reads it: no report has ended it, and its feature
// hasn't closed since it was queued (scripts/foreman/queue.js).
export function isOpen(views, id) {
  const entry = isPlain(views.work) ? views.work[id] : undefined;
  if (!isPlain(entry)) return false;
  const feature = isPlain(views.features) ? views.features[id] : undefined;
  const closed = feature?.data?.step === 'closed' && since(feature, entry.work);
  return !closed && !endedBy(views.reports, id, entry.work);
}
