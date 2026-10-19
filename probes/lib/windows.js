// probes/lib/windows.js
// Pure helpers shared by the Windows probes (checks 52 and 53): reading
// `whoami /groups`, writing a path into an allow rule the way scripts/foreman/tools.js
// does, building a PowerShell command, and the report lines the probes print.
// Nothing here touches the machine, so the tests run on any system.

// ------------------------------------------------------------ integrity levels

const LEVELS = [
  ['S-1-16-4096', 'low'],
  ['S-1-16-8192', 'medium'],
  ['S-1-16-12288', 'high'],
  ['S-1-16-16384', 'system'],
];

// The integrity level `whoami /groups` shows for the process that ran it: the
// "Mandatory Label" row's SID. Null when there is no such row.
export function integrityOf(whoamiGroups) {
  const text = String(whoamiGroups ?? '');
  for (const line of text.split(/\r?\n/)) {
    if (!/Mandatory Label/i.test(line) && !/S-1-16-\d+/.test(line)) continue;
    for (const [sid, name] of LEVELS) {
      if (new RegExp(`${sid}(?!\\d)`).test(line)) return name;
    }
  }
  return null;
}

// ----------------------------------------------------------- allow-rule paths

// A path as it sits in a Bash allow rule: forward slashes, a drive letter, in
// single quotes. This is the form scripts/foreman/tools.js makes for the
// foreman's scripts (the allowed characters are the same), so a path that
// works there works here. Throws for a path that could change what the rule
// means.
const ALLOWED_PATH = /^(\/[\p{L}\p{M}\p{N}._@=~-]+( [\p{L}\p{M}\p{N}._@=~-]+)*)+\/?$/u;

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

// The command a feature session runs for the Guarded runner, and the one allow
// rule that permits exactly it: the low copy of node.exe, the runner script, and
// whatever follows.
export function runnerPrefix(lowNode, runner, options) {
  return `${commandPath(lowNode, options)} ${commandPath(runner, options)}`;
}

export function runnerRule(lowNode, runner, options) {
  return `Bash(${runnerPrefix(lowNode, runner, options)}:*)`;
}

// --------------------------------------------------------------- PowerShell

// A single-quoted PowerShell string.
export function psQuote(text) {
  return `'${String(text).replaceAll("'", "''")}'`;
}

// The argument for `powershell -EncodedCommand`: the script in UTF-16LE, base64.
// It needs no quoting and no execution policy.
export function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

// SDDL for a mandatory label: medium level, no write up and no read up,
// inherited by files and folders below.
export const NO_READ_UP_SDDL = 'S:(ML;OICI;NWNR;;;ME)';

// PowerShell that sets that label on `target` with SetNamedSecurityInfoW, which
// is what a "no read up" label needs (icacls has no documented way to set it).
// Prints `LABEL_RESULT=<Win32 error code>`; 0 is success.
export function labelScript(target, sddl = NO_READ_UP_SDDL) {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$source = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class WhLabel {',
    '  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]',
    '  static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr descriptor, out uint size);',
    '  [DllImport("advapi32.dll", SetLastError = true)]',
    '  static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr sacl, out bool defaulted);',
    '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]',
    '  static extern uint SetNamedSecurityInfoW(string name, int objectType, uint information, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);',
    '  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);',
    '  public static int Set(string path, string sddl) {',
    '    IntPtr descriptor; uint size;',
    '    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out descriptor, out size)) return Marshal.GetLastWin32Error();',
    '    bool present, defaulted; IntPtr sacl;',
    '    if (!GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted)) return Marshal.GetLastWin32Error();',
    '    uint result = SetNamedSecurityInfoW(path, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);',
    '    LocalFree(descriptor);',
    '    return (int)result;',
    '  }',
    '}',
    '"@',
    'Add-Type -TypeDefinition $source',
    `Write-Output ('LABEL_RESULT=' + [WhLabel]::Set(${psQuote(target)}, ${psQuote(sddl)}))`,
    '',
  ].join('\r\n');
}

export function labelResult(output) {
  const m = /LABEL_RESULT=(-?\d+)/.exec(String(output ?? ''));
  return m ? Number(m[1]) : null;
}

// ----------------------------------------------------------------- reports

export const STATUSES = ['PASS', 'FAIL', 'SEEN'];

// One line per trial: `PASS <id>: <detail>`, `FAIL ...` or `SEEN ...`.
export function reportLine(status, id, detail = '') {
  if (!STATUSES.includes(status)) throw new Error(`Not a status: ${status}`);
  const text = String(detail).replace(/\s*\r?\n\s*/g, ' ').trim();
  return text ? `${status} ${id}: ${text}` : `${status} ${id}`;
}

// ------------------------------------------------------ what a low process saw

// The last line of a helper's output that is a JSON object: the helper prints
// exactly one, after anything else the program under it said.
export function parseTry(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter((line) => line.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const value = JSON.parse(lines[i]);
      if (value && typeof value === 'object') return value;
    } catch { /* not the one */ }
  }
  return null;
}

// Whether a result from the helper means Windows refused the operation:
// 'refused' (an access-denied error), 'allowed' (it worked), or 'other' (it
// failed for some other reason, so the trial shows nothing).
export function judgeAccess(result) {
  if (!result) return 'other';
  if (result.ok === true) return 'allowed';
  const said = `${result.code ?? ''} ${result.message ?? ''} ${result.stderr ?? ''}`;
  if (/EPERM|EACCES|access is denied|permission denied|not permitted/i.test(said)) return 'refused';
  return 'other';
}

// ------------------------------------------------------------ Windows build

// 'Microsoft Windows [Version 10.0.26100.4061]' (the output of `ver`) or
// '10.0.26100' (os.release()) -> { major: 26100, revision: 4061 | null }.
export function parseBuild(text, ubr = null) {
  const m = /(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text ?? ''));
  if (!m) return null;
  const revision = m[4] !== undefined ? Number(m[4]) : (ubr === null || ubr === undefined ? null : Number(ubr));
  return { major: Number(m[3]), revision };
}

// Microsoft Execution Containers need Windows 11 24H2 (26100) or 25H2 (26200),
// each from update 9278 (research 8.4, item 8).
export function mxcBuildReached(build) {
  if (!build) return null;
  if (build.major > 26200) return true;
  if (build.major !== 26100 && build.major !== 26200) return false;
  return build.revision === null ? null : build.revision >= 9278;
}

// 'HKEY...\UBR    REG_DWORD    0x244e' -> 9294
export function parseUbr(regOutput) {
  const m = /UBR\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/i.exec(String(regOutput ?? ''));
  return m ? Number(m[1]) : null;
}

export function seconds(ms) {
  return ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(2)} s`;
}
