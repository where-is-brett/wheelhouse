// scripts/addon/pack.js
// Packs the VS Code add-on as a .vsix with no npm tool and no dependency: a zip written with Node.js's own zlib.
// The .vsix carries its own copy of the scripts it imports, found by walking the imports from the add-on's entries,
// under `extension/wheelhouse/` beside a package.json of { "type": "module" }, so it never loads code from a project,
// a checkout or a plugin folder, and works on a computer with no Wheelhouse release on it (design for other agents,
// section 8.6; the plan's choice 5). A bare import other than `node:` refuses the pack.
//
// `node scripts/addon/pack.js [out-file]` packs into the current folder, or the file named.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startedAsScript } from '../lib/started-as-script.js';

const require = createRequire(import.meta.url);
const { LOADS, START_HELPER } = require('../../vscode/desk.cjs');

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// What the add-on loads, then runs: the closure of these is carried.
export const RUN_ONLY = [START_HELPER];
export const ENTRIES = [...new Set([...Object.values(LOADS), ...RUN_ONLY])].sort();

export const vsixName = (version) => `wheelhouse-${version}.vsix`;

// The source with the lines that are wholly comment taken out: `//` lines, and lines that begin a block comment or sit inside
// one (`/*`, ` *`). A comment after code on a line is left, which can only add an import to the walk, never lose one. Strings
// and expressions are not read, so a glob such as 'a/*' in a string can't swallow code the way a block-comment match would.
const withoutComments = (text) => text.replace(/^[ \t]*(?:\/\/|\/\*|\*).*$/gm, '');

// The specifiers a module imports: static, re-exported and dynamic with a literal. A dynamic import of something that
// is not a literal is returned as `{ computed: true }`.
function importsOf(text) {
  const code = withoutComments(text);
  const found = [];
  const add = (re, group) => { for (const m of code.matchAll(re)) found.push(m[group]); };
  add(/^[ \t]*import\s+(?:[\w$*{][^;'"`]*?\bfrom\s*)?(['"])([^'"\n]+)\1/gm, 2);
  add(/^[ \t]*export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/gm, 2);
  add(/(?<![\w$.])import\s*\(\s*(['"`])([^'"`\n]+)\1\s*[,)]/g, 2);
  const computed = [...code.matchAll(/(?<![\w$.])import\s*\(\s*(?!['"`])/g)].length;
  // Files a module names beside itself with new URL('./x', import.meta.url): read when it loads or when it runs.
  const beside = [...code.matchAll(/new URL\(\s*(['"])(\.[^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g)].map((m) => m[2]);
  return { specifiers: found, computed, beside };
}

// closureOf({ root, entries }) -> string[]: the files (root-relative, with forward slashes, sorted) that the entries
// import, the entries themselves included, and the files a module names beside itself with new URL('./x', import.meta.url).
// Files a module reaches by a path built from the Wheelhouse folder at run time (skills, templates, the build's patches) are
// not found by a walk of the imports and are not carried; they belong to flows the add-on never starts. Throws, naming the file and the import, for a bare import other than `node:`,
// a computed dynamic import, an import of a file that is not there, and one that leaves `root`.
export function closureOf({ root, entries }) {
  return reportOf({ root, entries }).files;
}

// reportOf({ root, entries }) -> { files, computed }: the closure, and the files in it that import something chosen at run
// time. The walk can't follow those; whatever they load must come from the add-on's own folder or not load at all, which
// the add-on's `import()` guarantees by reading only there.
export function reportOf({ root, entries }) {
  const seen = new Set();
  const computed = [];
  const queue = entries.map((e) => e.split(path.sep).join('/'));
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const full = path.join(root, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`The add-on needs ${rel}, which is not there`);
    seen.add(rel);
    if (!/\.(?:js|mjs|cjs)$/.test(rel)) continue;
    const { specifiers, computed: chosen, beside } = importsOf(fs.readFileSync(full, 'utf8'));
    if (chosen > 0) computed.push(rel);
    // A file named beside the module is carried when it is there; one that isn't is not the add-on's to need.
    for (const spec of beside) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (!target.startsWith('../') && fs.existsSync(path.join(root, target)) && fs.statSync(path.join(root, target)).isFile()) queue.push(target);
    }
    for (const spec of specifiers) {
      if (spec.startsWith('node:')) continue;
      if (!spec.startsWith('.')) throw new Error(`${rel} imports the package "${spec}", which the add-on can't carry (no npm tool, no dependency)`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (target.startsWith('../') || target === '..' || path.posix.isAbsolute(target)) throw new Error(`${rel} imports ${spec}, which is outside the add-on's folder`);
      queue.push(target);
    }
  }
  return { files: [...seen].sort(), computed: computed.sort() };
}

// --- the zip ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The zip of `files` (a Map of name to Buffer), reproducible: names in the order given, the time the same each pack.
function zipOf(files) {
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1 January 1980
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// --- the package ---

const xml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;' })[c]);
const CONTENT_TYPES = { json: 'application/json', js: 'application/javascript', cjs: 'application/javascript', mjs: 'application/javascript', css: 'text/css', svg: 'image/svg+xml', md: 'text/markdown', txt: 'text/plain', vsixmanifest: 'text/xml', html: 'text/html', yaml: 'text/plain', yml: 'text/plain' };

function contentTypes(names) {
  const exts = [...new Set(names.map((n) => path.posix.extname(n).slice(1).toLowerCase()).filter(Boolean))].sort();
  const defaults = exts.map((e) => `<Default Extension="${xml(e)}" ContentType="${CONTENT_TYPES[e] ?? 'application/octet-stream'}"/>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<Types>${defaults}</Types>\n`;
}

function manifestOf(pkg) {
  const prop = (id, value) => `<Property Id="Microsoft.VisualStudio.Code.${id}" Value="${xml(value)}"/>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}"/>
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Tags></Tags>
    <Categories>${xml((pkg.categories ?? ['Other']).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      ${prop('Engine', pkg.engines.vscode)}
      ${prop('ExtensionDependencies', '')}
      ${prop('ExtensionPack', '')}
      ${prop('ExtensionKind', 'workspace')}
      ${prop('LocalizedLanguages', '')}
      ${prop('EnabledApiProposals', '')}
      ${prop('ExecutesCode', 'true')}
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>
`;
}

const filesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name.startsWith('.') || e.name === 'node_modules') return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? filesUnder(full) : [full];
});

// The version the add-on carries: the plugin's own, so the two never differ.
export function pluginVersion(root = HERE) {
  return JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

// pack({ root, out }) -> file: writes the .vsix at `out` and returns it. `root` is the Wheelhouse folder.
export function pack({ root = HERE, out } = {}) {
  const folder = path.join(root, 'vscode');
  const pkg = { ...JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')), version: pluginVersion(root) };
  const files = new Map();
  files.set('extension/package.json', Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`));
  for (const full of filesUnder(folder).sort()) {
    const rel = path.relative(folder, full).split(path.sep).join('/');
    if (rel === 'package.json') continue;
    files.set(`extension/${rel}`, fs.readFileSync(full));
  }
  files.set('extension/wheelhouse/package.json', Buffer.from(`${JSON.stringify({ type: 'module' })}\n`));
  for (const rel of closureOf({ root, entries: ENTRIES })) files.set(`extension/wheelhouse/${rel}`, fs.readFileSync(path.join(root, rel)));
  const sorted = new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const all = new Map([
    ['[Content_Types].xml', Buffer.from(contentTypes([...sorted.keys(), 'extension.vsixmanifest']))],
    ['extension.vsixmanifest', Buffer.from(manifestOf(pkg))],
    ...sorted,
  ]);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, zipOf(all));
  return out;
}

if (startedAsScript(import.meta.url)) {
  try {
    const out = path.resolve(process.argv[2] ?? vsixName(pluginVersion()));
    process.stdout.write(`${pack({ root: HERE, out })}\n`);
  } catch (error) {
    process.stderr.write(`The add-on wasn't packed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
