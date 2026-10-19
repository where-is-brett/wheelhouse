// scripts/lib/command-path.js
// A full path as it is written into a command that an allow rule names: on Windows forward
// slashes after its drive letter, in single quotes. Bash reads a single-quoted word literally,
// node and Git Bash both take forward slashes, and through npm's claude.cmd shim each rule goes
// on a cmd.exe command line, which refuses any argument holding `"` or `%`
// (scripts/lib/claude.js), so a single quote passes through it as it is. The foreman's scripts
// (scripts/foreman/tools.js) and the Guarded runner (scripts/windows/low.js) are written so.
//
// The path is checked against an allow-list, as build commands are (scripts/gate/guardrails.js):
// a full path of letters, digits and `._/@=~-`, with single spaces between words, and on
// Windows a drive letter and its colon in front. Letters and digits are any script's, with
// their combining marks (a user folder may be `José` or `田中`), and `~` is there for a Windows
// short name such as `JOSE~1`: none of them means anything to bash in single quotes or to
// cmd.exe. Nothing else can reach a rule: no quote, `$`, `%`, `*`, comma or parenthesis, any of
// which could change what the command or the rule means, or how --allowedTools is split.

// A full path in the allowed characters: each part after a slash is words of those characters
// with single spaces between them.
const ALLOWED_PATH = /^(\/[\p{L}\p{M}\p{N}._@=~-]+( [\p{L}\p{M}\p{N}._@=~-]+)*)+\/?$/u;

// `file` in single quotes, as a command names it; throws for a path outside the allowed
// characters. A trailing slash is dropped.
export function commandPath(file, { platform = process.platform } = {}) {
  const refuse = () => { throw new Error(`This path can't be written into an allow rule: ${JSON.stringify(file)}`); };
  if (typeof file !== 'string') refuse();
  let drive = '';
  let rest = file;
  if (platform === 'win32') {
    const m = /^([A-Za-z]:)([\\/].*)$/s.exec(file);
    if (m === null) refuse();
    drive = m[1];
    rest = m[2].replaceAll('\\', '/');
  }
  if (!ALLOWED_PATH.test(rest)) refuse();
  return `'${drive}${rest.replace(/\/$/, '')}'`;
}
