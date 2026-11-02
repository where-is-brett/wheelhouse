// scripts/host/host-approval.js
// The person's own approval of a pull request on GitHub, which a Copilot project with real users needs before it
// merges (Task B1 of docs/superpowers/plans/2026-11-02-copilot-remaining-parts.md; Archon design, section 12).
// It is read from the pull request's reviews, never from the agent or the bot: only the person's latest review counts.
import { hostApprovalReady } from './approval-ready.js';

// The refusal's sentence, the same on both merge routes.
export const NO_HOST_APPROVAL = (short) => `the director's approval on GitHub of ${short} isn't there`;

// Review states that change where the person stands. A comment or a pending review changes nothing.
const STANDING = ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'];

// Whether the person's latest standing review of the pull request is an approval of exactly `sha`. A review that can't be
// read, an adapter that reads none and a person who isn't named are all no approval.
export async function hostApproved({ adapter, number, sha, person }) {
  if (typeof adapter?.reviews !== 'function' || typeof person !== 'string' || person === '' || typeof sha !== 'string' || sha === '') return false;
  let reviews;
  try {
    reviews = await adapter.reviews(number);
  } catch {
    return false;
  }
  if (!Array.isArray(reviews)) return false;
  const mine = reviews
    .filter((r) => typeof r?.login === 'string' && r.login.toLowerCase() === person.toLowerCase() && r.type !== 'Bot' && STANDING.includes(r.state))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const latest = mine.at(-1);
  return latest?.state === 'APPROVED' && latest.commit === sha;
}

// The pull_request rule a project with this approval gets on GitHub.
export function githubApprovalRules() {
  return {
    type: 'pull_request',
    parameters: {
      required_approving_review_count: 1,
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: true,
      required_review_thread_resolution: false,
    },
  };
}

// Whether the project's merges need the person's approval on the host: a Copilot project with real users on GitHub,
// once the route is ready. An agent that can't be told (null) counts as Copilot, so that a configuration which can't be
// read never lets a merge round the approval. `ready` is for a test.
export function hostApprovalNeeded({ agent, realUsers, host = 'github' } = {}, { ready = hostApprovalReady } = {}) {
  if (host !== 'github' || realUsers !== true || !ready({ host })) return false;
  return agent === null || agent === 'copilot';
}
