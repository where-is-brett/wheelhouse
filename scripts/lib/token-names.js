// scripts/lib/token-names.js
// The variables that carry a host's key or sign-in, in one list. A program run where a pasted or company host could receive
// one (glab, git's credential helper, the computer's store) gets none of them; the foreman's child gets none either.
export const TOKEN_NAMES = [
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
  'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'GL_TOKEN', 'GLAB_TOKEN', 'OAUTH_TOKEN',
];

// An environment's overrides that take every one out: a variable whose value is undefined is removed by run.js and by spawn.
// Given the environment it is to be taken from, on Windows (where names are not case-sensitive) it takes out every spelling in it.
export const withoutTokens = ({ env, platform = process.platform } = {}) => {
  const names = new Set(TOKEN_NAMES);
  if (platform === 'win32' && env !== undefined && env !== null) {
    for (const key of Object.keys(env)) if (TOKEN_NAMES.some((name) => name.toLowerCase() === key.toLowerCase())) names.add(key);
  }
  return Object.fromEntries([...names].map((name) => [name, undefined]));
};
