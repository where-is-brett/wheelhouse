// scripts/lib/token-names.js
// The variables that carry a host's key or sign-in, in one list. A program run where a pasted or company host could receive
// one (glab, git's credential helper, the computer's store) gets none of them; the foreman's child gets none either.
export const TOKEN_NAMES = [
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
  'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'GL_TOKEN', 'GLAB_TOKEN', 'OAUTH_TOKEN',
];

// An environment's overrides that take every one out: a variable whose value is undefined is removed by run.js and by spawn.
// The environment it is taken from is the process's unless one is given. On Windows, where names are not case-sensitive, every spelling
// in it goes too. `extra` names more variables to take out the same way.
export const withoutTokens = ({ env = process.env, platform = process.platform, extra = [] } = {}) => {
  const wanted = [...TOKEN_NAMES, ...extra];
  const names = new Set(wanted);
  if (platform === 'win32' && env !== null && typeof env === 'object') {
    const lower = new Set(wanted.map((name) => name.toLowerCase()));
    for (const key of Object.keys(env)) if (lower.has(key.toLowerCase())) names.add(key);
  }
  return Object.fromEntries([...names].map((name) => [name, undefined]));
};
