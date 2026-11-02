<!-- docs/copilot/it-note.md -->
# Wheelhouse with GitHub Copilot: a note for IT

Wheelhouse is a plugin that helps a product owner who is not a developer direct AI agents that build their product. This
note says what it installs and runs on a computer, where, what it changes, and the settings a company can apply to hold
it. It is one page; the design behind it is in `docs/specs/`.

## What is installed, and where

- **Wheelhouse's own folder**, in the person's home folder (`~/.wheelhouse/`): its records, the signing keys, the helper's
  socket and the build engine's folder. Nothing is installed system-wide unless the company chooses Locked (below).
- **The build engine**, an open-source program (Archon) that runs under Bun, both pinned to a version and fetched from
  their publishers' own pages, in a folder of the engine's. It runs the agents' steps.
- **Copilot's command-line program**, pinned to one version, fetched from the npm registry (`registry.npmjs.org`) and
  checked against a recorded checksum. It runs from a **clean home** of its own inside the engine's folder, holding only
  the person's sign-in, Wheelhouse's hooks and a copy of its skills.
- **The helper**, a small Node.js program that starts when the person signs in to their computer, for that person only.
  It holds the checks (a merge needs passing CI, a signed review and the person's approval) and talks only to the code
  host and to programs on the same computer, over a local socket.
- **An optional VS Code add-on**, installed by hand from a file, never from a marketplace, with no update of its own.

## What it changes

- A hook registration in Copilot's hook folder, so Wheelhouse's guards run before each tool call.
- With the person's yes, Copilot's sandbox switched on for the engine's steps (settings in the clean home).
- On a Mac, with an administrator's password, **Locked**: a managed settings file and a policy hook file, described below.
- Nothing is changed in the company's repositories except through pull requests the person approves.

## The baseline a company can apply

`docs/copilot/baseline/managed-settings.json` and `docs/copilot/baseline/policy-hooks.json` hold the settings, ready to
send through device management, or through GitHub where the company's licence provides it:

- Copilot's sandbox on, failing closed where the computer cannot provide it, with no command allowed to leave it.
- No "Allow all" or bypass mode.
- Reading the signing keys, the credential folders (`~/.ssh`, `~/.config/gh`, cloud tools' folders and so on) and
  Copilot's and the agents' own folders denied, and editing the latter two denied.
- Settings fetched afresh from GitHub (`forceRemoteSettingsRefresh`), so a computer that cannot fetch them is not left unheld.
- Every repository the company owns marked as a project with real users, so Wheelhouse never runs one unattended.
- A policy hook that runs Wheelhouse's guards. It does nothing outside a Wheelhouse project. Fill in the two paths.

Where a company already manages Copilot, its settings win and Wheelhouse does not offer Locked.

## What it does not do

It runs no program the company has not allowed to run, and never starts VS Code's own program as a Node.js process. It does
not push to a protected branch, bypass the code host's protection, or disable the company's controls. A company that blocks
programs in folders the person can write to will need to allow Node.js, Bun, `gh` and Copilot's program; setup tests each
and says which one is refused.

## To remove it

Wheelhouse's uninstall step puts back every change it recorded. Locked is removed with the administrator's password.
