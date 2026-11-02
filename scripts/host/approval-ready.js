// scripts/host/approval-ready.js
// Whether a person's approval on the host can stand in for Maintainers-only merging, for a project
// with real users. It is false until the route has passed its check (check 68, GitHub half): GitLab is lost under
// Archon and is never ready, so a GitLab project with real users merges by Maintainers on every plan.
// The switch is set by its own pull request after sitting S4 (the build plan of 2 November 2026, Task B1).
export const HOST_APPROVAL_CHECKED = false;

// `checked` is for a test, which sets it for one call; nothing else passes it.
export function hostApprovalReady({ host } = {}, { checked = HOST_APPROVAL_CHECKED } = {}) {
  return host === 'github' && checked === true;
}
