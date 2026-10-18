<!-- docs/checks/19-setup-time.md -->

# Check 19: setup time

**Answer:** Deferred — to the setup plan, since there is no setup to time yet.

## Question

Setup time: a timed run on a fresh account on macOS and on Windows, including installing git, Node.js and the host tool.

## Tested on

Official pages and release files, read on 17 October 2026.

## Method

Read the installers' pages for what each needs, and their sizes from the release files.

## Evidence

- **macOS git:** comes with Apple's command-line tools ("click Install and then agree to the … License Agreement"). Apple gives no size or time.
- **Windows:** Claude Code itself "do[es] not need" Git for Windows; without it, Claude uses PowerShell instead of Bash. Builders still need git.
- **Node.js LTS:** about 33 MB on Windows (.msi, installs for the whole computer, so it asks for administrator rights) and about 94 MB on macOS (.pkg).
- **`gh`:** about 16 MB on Windows (.msi) and 29 MB on macOS (.pkg, currently unsigned).

## What it means for the design

- Section 15, "Before starting": correct the claim that Claude Code on Windows already needs Git for Windows. Setup installs git on Windows too.
- Section 15, step 2: on a fresh computer, three installers of up to about 150 MB, each with a password or administrator prompt, plus Apple's tools on a Mac. Starting them first, as the design says, is needed to stay near 15 minutes.
- An unsigned `gh` package on macOS may show a warning the director has to get past. The setup plan should look for a signed route.

## Needs the director

No.
