// scripts/lib/token-names.js
// The variables that carry a host's key or sign-in, in one list. A program run where a pasted or company host could receive
// one (glab, git's credential helper, the computer's store) gets none of them; the foreman's child gets none either.
export const TOKEN_NAMES = [
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
  'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'GL_TOKEN', 'GLAB_TOKEN', 'OAUTH_TOKEN',
];

// An environment's overrides that take every one out: a variable whose value is undefined is removed by run.js and by spawn.
export const withoutTokens = () => Object.fromEntries(TOKEN_NAMES.map((name) => [name, undefined]));
