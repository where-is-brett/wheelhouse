// scripts/addon/pack.js
// Packs the VS Code add-on as a .vsix with no npm tool and no dependency: a zip written by hand. The add-on is thin: the
// files of `vscode/` and nothing from `scripts/`, because the panel talks to the desk through the helper the plugin
// already runs, so it carries no Wheelhouse code of its own. Files are stored, not compressed, so the bytes (and the hash
// in vscode/vsix.sha256) do not depend on the zlib a computer's Node.js was built with.
//
// `node scripts/addon/pack.js [out-file]` packs into the current folder, or the file named.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startedAsScript } from '../lib/started-as-script.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const vsixName = (version) => `wheelhouse-panel-${version}.vsix`;

// The version the add-on carries: the plugin's own, so the two never differ.
export function pluginVersion(root = HERE) {
  return JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
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

// The zip of `files` (a Map of name to Buffer), reproducible: names in the order given, every file stored, the time
// the same each pack (1 January 1980).
function zipOf(files) {
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
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
const CONTENT_TYPES = { json: 'application/json', js: 'application/javascript', cjs: 'application/javascript', mjs: 'application/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', md: 'text/markdown', txt: 'text/plain', vsixmanifest: 'text/xml', html: 'text/html' };

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
    <Categories>${xml(pkg.categories.join(','))}</Categories>
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

// The file types the add-on ships. Anything else under vscode/ (a key, a fixture, a test, a .map file, a hidden file)
// refuses the pack, so it fails loudly instead of shipping.
export const ALLOWED_EXTENSIONS = ['.cjs', '.js', '.json', '.css', '.svg', '.png', '.md'];

// The files under `dir`, found with lstat so a link is seen as a link. A link, or a file that isn't of an allowed type,
// throws naming its path (relative to `base`).
function filesUnder(dir, base = dir) {
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`vscode/${rel} is a symbolic link, which the add-on doesn't carry`);
    if (stat.isDirectory()) return filesUnder(full, base);
    if (!stat.isFile()) throw new Error(`vscode/${rel} is not a plain file, which the add-on doesn't carry`);
    if (rel !== 'vsix.sha256' && !ALLOWED_EXTENSIONS.includes(path.extname(name).toLowerCase())) {
      throw new Error(`vscode/${rel} is not a file type the add-on ships (${ALLOWED_EXTENSIONS.join(', ')}), so nothing is packed`);
    }
    return [full];
  });
}

// vsixBytes({ root }) -> Buffer: the packed add-on. Only the files of `vscode/` go in; the recorded hash of the pack
// (vscode/vsix.sha256) is not one of them, or the hash would have to contain itself.
export function vsixBytes({ root = HERE } = {}) {
  const folder = path.join(root, 'vscode');
  const pkg = { ...JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')), version: pluginVersion(root) };
  if (typeof pkg.publisher !== 'string' || pkg.publisher === '') throw new Error('vscode/package.json has no publisher, so nothing is packed');
  pkg.categories = Array.isArray(pkg.categories) ? pkg.categories : [];
  const files = new Map();
  files.set('extension/package.json', Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`));
  for (const full of filesUnder(folder).sort()) {
    const rel = path.relative(folder, full).split(path.sep).join('/');
    if (rel === 'package.json' || rel === 'vsix.sha256') continue;
    files.set(`extension/${rel}`, fs.readFileSync(full));
  }
  const sorted = new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const all = new Map([
    ['[Content_Types].xml', Buffer.from(contentTypes([...sorted.keys(), 'extension.vsixmanifest']))],
    ['extension.vsixmanifest', Buffer.from(manifestOf(pkg))],
    ...sorted,
  ]);
  return zipOf(all);
}

export const sha256Of = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// pack({ root, out }) -> Promise<{ file, sha256 }>: writes the .vsix at `out`.
export async function pack({ root = HERE, out } = {}) {
  const bytes = vsixBytes({ root });
  const file = path.resolve(out ?? vsixName(pluginVersion(root)));
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, bytes);
  return { file, sha256: sha256Of(bytes) };
}

if (startedAsScript(import.meta.url)) {
  try {
    const { file } = await pack({ root: HERE, out: process.argv[2] });
    process.stdout.write(`${file}\n`);
  } catch (error) {
    process.stderr.write(`The add-on wasn't packed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
