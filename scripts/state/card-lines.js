// scripts/state/card-lines.js
// The exact words on the buttons and lines of the director's cards, so the
// front desk asks in the words the helper checks against.

// The line on the card that asks the director to push a CI change.
export function ciPushLine(branch, sha) {
  return `Push the CI change on ${branch} at commit ${String(sha).slice(0, 12)} with your own sign-in`;
}

const sha12 = (sha) => String(sha).slice(0, 12);

// The line on the card that asks the director to approve a pull request.
export function approvalLine(pr, sha) {
  return `Approve pull request #${pr} at commit ${sha12(sha)}`;
}

// The line that asks the director to confirm a ruling, a level or a setting.
export function confirmLine(event) {
  const words = typeof event?.data?.words === 'string' ? event.data.words : '';
  return `Confirm ${event?.kind} ${event?.id}: "${words}"`;
}

export const LIFT_STOP = 'Lift STOP and let the agents carry on';

export const RUNBOOK_TITLES = {
  1: 'Turn STOP on',
  2: "Cut the agents' access to the host",
  3: 'Put the product back to an earlier release',
  4: "Put the project's records back from the backup",
  5: 'Contain live harm',
};

// The line that asks the director to run a runbook step, with the commit when it names one.
export function runbookLine(step, sha) {
  const base = `Runbook step ${step}: ${RUNBOOK_TITLES[step]}`;
  return sha === undefined || sha === null ? base : `${base}, to commit ${sha12(sha)}`;
}

// The line that asks the director to approve a piece of work as written. With
// `shownFirst`, the director is to see it before it merges.
export function approveWorkLine(work, lane, hash, { shownFirst = false } = {}) {
  return `Approve ${work} (${lane} lane) as written, ${sha12(hash)}${shownFirst ? ', and show it to me before it merges' : ''}`;
}

// The line on a question card; the click on an option answers the question.
export function answerLine(questionId) {
  return `Answer question ${questionId}`;
}

// The line that asks the director to change approved work to a proposed change.
export function amendLine(work, hash) {
  return `Change the approved ${work} to this, ${sha12(hash)}`;
}

// The line that asks the director to end an incident.
export function liftIncidentLine(id) {
  return `End incident ${id} and let merges carry on`;
}

// The line that asks the director to merge a pull request as an incident's fix.
export function incidentFixLine(id, pr) {
  return `Merge pull request #${pr} as the fix for incident ${id}`;
}
