// probes/52-low-integrity/lock-reads-ffi.js
// Run by the probe with the node that has node:ffi: sets a "no read up" label (medium,
// no write up, no read up, inherited) on one folder by calling advapi32's
// SetNamedSecurityInfoW through node:ffi. Prints one JSON line.
// Usage: node lock-reads-ffi.js <folder>
// node:ffi is experimental (Node 26.1 and later); the signatures follow
// https://nodejs.org/api/ffi.html (read 19 October 2026) and have not been run.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SDDL = 'S:(ML;OICI;NWNR;;;ME)';
const SE_FILE_OBJECT = 1;
const LABEL_SECURITY_INFORMATION = 0x10;

function say(value) {
  process.stdout.write(`\n${JSON.stringify(value)}\n`);
}

const wide = (text) => Buffer.from(`${text}\0`, 'utf16le');

try {
  const ffi = require('node:ffi');
  const { functions } = ffi.dlopen('advapi32.dll', {
    ConvertStringSecurityDescriptorToSecurityDescriptorW: { arguments: ['buffer', 'uint32', 'buffer', 'buffer'], return: 'int32' },
    GetSecurityDescriptorSacl: { arguments: ['pointer', 'buffer', 'buffer', 'buffer'], return: 'int32' },
    SetNamedSecurityInfoW: { arguments: ['buffer', 'int32', 'uint32', 'pointer', 'pointer', 'pointer', 'pointer'], return: 'uint32' },
  });
  const descriptor = Buffer.alloc(8);
  const size = Buffer.alloc(4);
  if (!functions.ConvertStringSecurityDescriptorToSecurityDescriptorW(wide(SDDL), 1, descriptor, size)) {
    say({ ok: false, step: 'convert', message: 'ConvertStringSecurityDescriptorToSecurityDescriptorW returned 0' });
  } else {
    const present = Buffer.alloc(4);
    const sacl = Buffer.alloc(8);
    const defaulted = Buffer.alloc(4);
    if (!functions.GetSecurityDescriptorSacl(descriptor.readBigUInt64LE(0), present, sacl, defaulted)) {
      say({ ok: false, step: 'sacl', message: 'GetSecurityDescriptorSacl returned 0' });
    } else {
      const code = functions.SetNamedSecurityInfoW(wide(process.argv[2]), SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, 0n, 0n, 0n, sacl.readBigUInt64LE(0));
      say({ ok: Number(code) === 0, step: 'set', code: Number(code), exports: Object.keys(ffi).slice(0, 40) });
    }
  }
} catch (error) {
  say({ ok: false, step: 'load', code: error.code ?? 'ERROR', message: String(error.message ?? error).slice(0, 300) });
}
