// scripts/engine/pins.js
// The build engine's pins (Archon design, sections 14.1 and 16): Archon from source at its tag and commit, with
// Wheelhouse's patches, and the digests of what that build must hold; and the pinned Bun, by its own checksums.
// Archon is built from source (check 75), so no release binary is pinned. Moving a pin is an upgrade
// (scripts/lineage/upgrade.js): the build again at the new pin, then the safety subset and the counted evaluation.
import { ARCHON_SOURCE, BUN_PIN, PATCHES } from './archon/build.js';

// The SHA-256 of each patch file under scripts/engine/archon/patch/, in the order they are applied.
export const PATCH_DIGESTS = Object.freeze({
  'claude-permission-mode.patch': 'b04c637c86c77431bab733afbbc1cdb5220d3134d81aed6742ed0bcb505b4f14',
});

export const ENGINE_PINS = Object.freeze({
  archon: Object.freeze({
    ...ARCHON_SOURCE,
    patches: Object.freeze(PATCHES.map((name) => Object.freeze({ name, sha256: PATCH_DIGESTS[name] }))),
    // What the build holds, read on 30 October 2026 from the source at the commit with the patches applied: the
    // patched Claude provider, and the lockfile its dependencies are installed by.
    built: Object.freeze({
      provider: '6632e04131da968911638029569f3fcb190e3f7db0a1f8a5ebd349d6e89840d2',
      lockfile: '779687777c6a3e73d8cb1e149c252bdbb85457c698f9c5563424805f2c4c19f1',
    }),
  }),
  bun: BUN_PIN,
});

// The pins as the lineage manifest carries them.
export function manifestPins(pins = ENGINE_PINS) {
  return {
    archon: { tag: pins.archon.tag, commit: pins.archon.commit, patches: pins.archon.patches.map(({ name, sha256 }) => ({ name, sha256 })), built: { ...pins.archon.built } },
    bun: { version: pins.bun.version, sums: { ...pins.bun.sums } },
  };
}
