// scripts/host/approval-ready.js
// Whether a person's approval on the host can stand in for Maintainers-only merging, for a project
// with real users. It is false until the host's approval route has passed its check (check 71's
// Premium half and check 68); Part 9 Task 5 replaces this body with the route's own test. Until then
// a project with real users merges by Maintainers on every plan.
export function hostApprovalReady() {
  return false;
}
