// scripts/checks/profile.js
// The sandbox a check runs in (spec 4.4): macOS's `sandbox-exec`, the mechanism agents' sandboxes use on the Mac.
// A check runs the project's own code, which an agent wrote, so it is held even though no agent is present.
//
// The profile starts from deny-by-default. Check 82 showed why: an allow-by-default draft let `open`, a compiled program
// and `xcodebuild test` start the project's own app outside the sandbox, with the signing key in reach, and a way nobody
// tried stays open under such a profile. Here a macOS update that adds a service fails as could-not-run, which is safe.
// So what isn't named here is refused: Apple Events, opening apps, launchd jobs, the clipboard, the keychain's services.
//
// The last matching rule wins, so the order of the lines below carries meaning.

import path from 'node:path';
import { ENGINE_ROOM_PORT } from '../protection/archon.js';

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
// What tests alone also need: the read-only map of file types. Without it `UTType(filenameExtension:)` gives a made-up type
// and a project's passing tests read as red (the real project of check 82). It hands out the map and starts nothing:
// starting an app takes `launchservicesd` and the `lsopen` operation, and both stay refused. Its partner that writes the
// map, `com.apple.lsd.modifydb`, stays out, as `prepare` needs neither.
//
// The other three are here because a refusal can stall a test. A framework's first call to a service waits for its answer,
// and a refused service's answer doesn't arrive once as many tests as the Mac has cores are waiting at once: the tests sit
// until the time limit (check 82). The audio registrar lists the audio components the system knows, `cache_delete.public`
// answers how much disk space is free, and it alone gives the true figure, and the telemetry one says whether a framework
// may report. None starts a program a test chooses. `cache_delete.public` can also be asked to purge, and refuses a caller
// with no Apple entitlement. `com.apple.cache_delete`, its private partner, stays out.
const TEST_SERVICES = Object.freeze([
  'com.apple.audio.AudioComponentRegistrar',
  'com.apple.cache_delete.public',
  'com.apple.lsd.mapdb',
  'com.apple.PerfPowerTelemetryClientRegistrationService',
]);
// What fetching over the internet also needs: names and certificates.
const NETWORK_SERVICES = Object.freeze([
  'com.apple.dnssd.service',
  'com.apple.SystemConfiguration.configd',
  'com.apple.trustd',
  'com.apple.trustd.agent',
]);
// Where version managers keep a project's tools in the home folder, the one part of it a check reads. `.cargo/bin` is named
// alone because `.cargo` holds a registry token. A key someone puts in a tool's own settings here is in reach of `prepare`.
const TOOLS = Object.freeze([
  '.asdf', '.bun', '.cargo/bin', '.deno', '.fnm', '.local/share/mise', '.local/share/pnpm', '.mise', '.nvm',
  '.pyenv', '.rbenv', '.rustup', '.sdkman', '.swiftly', '.volta', 'Library/Application Support/fnm', 'Library/Developer/Toolchains', 'Library/pnpm',
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
    `(allow mach-lookup ${[...CHECK_SERVICES, ...(stage === 'test' ? TEST_SERVICES : []), ...(online ? NETWORK_SERVICES : [])].map((name) => `(global-name ${quoted(name)})`).join(' ')})`,
    '(allow file-read*)',
    `(deny file-read* ${subpaths(denied)})`,
    // A check reads nothing of the home folder but its tools. What the tests could read they could leave for `prepare`, which
    // has the network, so this holds in both stages. The deny list comes again, as the last matching rule wins.
    `(deny file-read* (subpath ${quoted(userHome)}))`,
    `(allow file-read* ${subpaths(TOOLS.map((tool) => `${userHome}/${tool}`))})`,
    `(deny file-read* ${subpaths(denied)})`,
  ];
  // A program must be able to look at the folders on the way down to the check folder to start there, though nothing here
  // lets it list them.
  lines.push(
    `(allow file-read-metadata ${foldersAbove(path.dirname(paths.tree)).map(literal).join(' ')})`,
    `(allow file-read* ${subpaths([paths.tree, paths.gitDir, ownHome])})`,
    `(allow file-write* ${subpaths([paths.tree, ownHome, ...temp])} ${DEVICES})`,
    // The folders themselves stay: a test that swapped one for a link would have the helper's next git calls write and
    // delete wherever it led, outside the sandbox.
    `(deny file-write* ${literal(paths.tree)} ${literal(ownHome)})`,
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
  // The engine room stays shut to a check as it is to an agent, or a builder could reach it by writing a test. Last, to beat
  // the rules above, and on any host, as the sandbox has no other way to name this computer's addresses.
  lines.push(`(deny network-outbound (remote ip "*:${ENGINE_ROOM_PORT}"))`);
  return lines.join('\n');
}
