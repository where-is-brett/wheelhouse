// scripts/checks/profile.js
// The sandbox a check runs in (spec 4.4): macOS's `sandbox-exec`, the mechanism Claude Code's own sandbox uses on the Mac.
// A check runs the project's own code, which an agent wrote, so it is held even though no agent is present.
//
// The profile starts from deny-by-default. Check 82 showed why: an allow-by-default draft let `open`, a compiled program
// and `xcodebuild test` start the project's own app outside the sandbox, with the signing key in reach, and a way nobody
// tried stays open under such a profile. Here a macOS update that adds a service fails as could-not-run, which is safe.
// So what isn't named here is refused: Apple Events, opening apps, launchd jobs, the clipboard, the keychain's services.
//
// The last matching rule wins, so the order of the lines below carries meaning.

// The system services a build tool can't work without, each answering a question and starting nothing. Three are left out
// on purpose. `com.apple.bsd.dirhelper` names the per-user temporary and cache folders: without it the tools fall back to
// the check's own TMPDIR, and those folders can stay shut. What is written there is read by programs outside the sandbox
// (xcrun keeps its lookup of tools there), so a test could plant something the director's next build would run.
// `com.apple.testmanagerd.control` and `com.apple.coreservices.launchservicesd` start programs outside the sandbox, so
// `xcodebuild test` can't run here; run.js has a second try for that.
export const CHECK_SERVICES = Object.freeze([
  'com.apple.diagnosticd',
  'com.apple.FSEvents',
  'com.apple.logd',
  'com.apple.system.logger',
  'com.apple.system.notification_center',
  'com.apple.system.opendirectoryd.libinfo',
]);
// What fetching over the internet also needs: names and certificates.
const NETWORK_SERVICES = Object.freeze([
  'com.apple.dnssd.service',
  'com.apple.SystemConfiguration.configd',
  'com.apple.trustd',
  'com.apple.trustd.agent',
]);
const DEVICES = '(literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/tty") (literal "/dev/dtracehelper") (literal "/dev/ptmx") (regex #"^/dev/(fd|ttys)")';
const NAME_SERVICE = '/private/var/run/mDNSResponder';

function quoted(text) {
  if (/[\r\n]/.test(text)) throw new Error('A folder with a new line in its name can\'t go in the check\'s sandbox');
  return `"${String(text).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
const subpaths = (list) => list.map((p) => `(subpath ${quoted(p)})`).join(' ');
const literal = (p) => `(literal ${quoted(p)})`;
const socketsUnder = (p) => `(subpath ${quoted(p)})`;

// A folder and every folder above it.
function foldersAbove(folder) {
  const out = [];
  for (let at = folder; at !== '/' && at !== '.' && at !== ''; at = at.slice(0, Math.max(at.lastIndexOf('/'), 1))) out.push(at);
  return out;
}

// The SBPL text for one stage of a check. `stage` is `prepare` or `test`. `denied` is the deny list as real paths and
// `temp` the temporary folders a check may write, which leave out the per-user ones (above).
export function checkProfile({ paths, main, stage, network, denied, temp, userHome }) {
  const ownHome = main ? paths.mainHome : paths.home;
  const online = stage === 'prepare' || network === true;
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow process-info* (target same-sandbox))',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow pseudo-tty)',
    '(allow ipc-posix-shm)',
    '(allow ipc-posix-sem)',
    `(allow file-ioctl ${DEVICES})`,
    `(allow mach-lookup ${[...CHECK_SERVICES, ...(online ? NETWORK_SERVICES : [])].map((name) => `(global-name ${quoted(name)})`).join(' ')})`,
    '(allow file-read*)',
    `(deny file-read* ${subpaths(denied)})`,
  ];
  // `prepare` has the network, so it reads nothing of the home folder. Either way a program must be able to look at the
  // folders on the way down to the check folder to start there, though nothing here lets it list them.
  if (stage === 'prepare') lines.push(`(deny file-read* (subpath ${quoted(userHome)}))`);
  lines.push(
    `(allow file-read-metadata ${foldersAbove(paths.root).map(literal).join(' ')})`,
    `(allow file-read* ${subpaths([paths.tree, paths.gitDir, ownHome])})`,
    `(allow file-write* ${subpaths([paths.tree, ownHome, ...temp])} ${DEVICES})`,
    '(deny file-write* (regex #"^/private/tmp/com\\.apple\\.launchd\\."))',
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
    `(allow network-bind (local unix-socket ${socketsUnder(paths.tree)} ${socketsUnder(ownHome)}))`,
    `(allow network-outbound (remote unix-socket ${socketsUnder(paths.tree)} ${socketsUnder(ownHome)}))`,
  );
  if (online) lines.push(
    '(allow network-outbound (remote ip "*:*"))',
    `(allow network-outbound (remote unix-socket (path-literal ${quoted(NAME_SERVICE)})))`,
    '(allow system-socket)',
  );
  return lines.join('\n');
}
