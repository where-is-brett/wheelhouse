<!-- probes/73-keychain/run.md -->

# Check 73: the director's sitting (the keychain inside the sandbox)

What this finds out: whether denying reads of the keychain files stops a sandboxed `security find-generic-password -w` from returning an item. The answer decides whether the sandbox settings can hold the keychain at all (design section 12.9).

macOS only. Everything it makes is in a scratch folder under the temporary folder. It makes a throwaway keychain file, stores one made-up item (`wheelhouse-probe-73`, a random value) in it and nowhere else, and never reads or lists any other item or your login keychain. While it runs, the user keychain search list has the throwaway file added (making a keychain does that); the script records the list first, puts it back exactly at the end, and checks. It costs no tokens. The log (statuses only, no values) goes to `<home>/.wheelhouse-probes/73-keychain/`.

**It refuses to run without `--consent`,** because it changes the keychain search list for a few seconds. The director's say-so is the consent.

You need: the Wheelhouse checkout and Node.js 22 or newer, in an ordinary terminal.

## The sitting (about 5 minutes)

1. Open a terminal in the Wheelhouse checkout.
2. Run:

   ```
   node probes/73-keychain/run.js --consent
   ```

3. It prints three lines, then `search-list: as it was` and `scratch folder: removed`:

   ```
   plain: read n characters
   deny-scratch-folder: read n characters | refused
   deny-real-keychains: read n characters | refused
   ```

4. Send back every printed line.

## What the lines mean

- `plain` is the control: it should read. If it is refused, the throwaway keychain did not work and nothing else counts.
- `deny-real-keychains` is the second control: the denial does not cover the scratch file, so it should read.
- `deny-scratch-folder` is the question. `refused` means denying a keychain file's folder stops `security` (the file is read in the calling process). `read n characters` means the security service reads the file for it, and the denial does nothing.
- If the last two lines are not `search-list: as it was` and `scratch folder: removed`, the script says what to put back. The search list can be reset with `security list-keychains -d user -s ~/Library/Keychains/login.keychain-db`.

The Windows half is a line in check 52's sitting (`credential-manager-low`), not here.
