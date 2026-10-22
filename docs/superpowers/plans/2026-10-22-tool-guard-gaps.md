<!-- docs/superpowers/plans/2026-10-22-tool-guard-gaps.md -->
# Tool guard gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three gaps the evaluation build found in `scripts/hooks/tool-guard.js`: `.env` files named as `<rev>:<path>`, the `.env.example` exemption, and `gh` run from a script file or through a pipe into a shell.

**Architecture:** All changes sit in `bashRefused` and `envName` in `scripts/hooks/tool-guard.js`. The guard still reads a command as words (`segments` in `shell-words.js`); it gains a notion of a segment's command word, and for a shell or a script run in command position it either refuses (input from a pipe or redirect) or reads the script file and checks its text as a command line.

**Tech Stack:** Node.js (ES modules), `node:test`.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, sections 12.2 (deny rules: "`.env.example` stays denied too, in commands as well … *Designer's call.*") and the command guard paragraph ("A command guard behind the deny rules").

## Global Constraints

- British English; dates as 22 October 2026; a path comment at the top of every file.
- No words such as "enhanced", "improved" or "fixed" in names, comments or test titles.
- Node.js only; behaviour must hold on macOS and Windows (`platform` and `windows` arguments already thread through).
- The guard over-refuses on purpose; the sandbox stays the main barrier. No full shell parser.
- No model names or AI attribution anywhere.

## Review Focus

1. `which sh`, `command -v bash`, `grep bash file`: a shell name that is not the segment's command word must not be refused for "reading input".
2. `/usr/bin/git status` and other binaries run by path: must pass (binary, not a script), and a large binary must not be refused for size.
3. `node_modules/.bin/x` with a `#!/usr/bin/env node` shebang: not read as a shell script.
4. `cd sub && ./build.sh` where `sub/build.sh` exists and is clean: passes (literal `cd` is followed).
5. `sh /dev/stdin`, a directory, or an unreadable file named as a script: refused, never read (reading a device could block the hook).

---

### Task 1: `.env` behind a revision, and `.env.example` denied

**Files:**
- Modify: `scripts/hooks/tool-guard.js` (`envName`, the `.env` loop in `bashRefused`, the comment above `patternNamesEnv`)
- Test: `tests/scripts/hooks/tool-guard.test.js`

- [ ] **Step 1: Write the failing tests.** Add a list `REV_ENV_REFUSED` and a loop of `test(\`Bash refuses an .env file behind a revision: ${cmd}\`)` (same shape as the `MORE_REFUSED` loop) with: `git show HEAD:.env.local`, `git show HEAD:.env`, `git show :.env`, `git show main:sub/.env.production`, `git cat-file -p HEAD:.env`, `git cat-file blob HEAD:.env.local`, `git diff HEAD:.env HEAD~1:.env`, `git -C x show 'HEAD:.env.local'`, `git log -p -- .env.local`, `git grep x HEAD -- .env`, `git show HEAD:.e*`. Change the existing `.env.example` assertions: test at line 54 is retitled `.env, .env.local, .ENV.local and .env.example are refused` and asserts `denied` for Read of `.env.example`, Glob `**/.env.example`; remove `cat .env.example` from the allowed list at line 170 and add a test `Bash refuses .env.example` for `cat .env.example` and `cp .env.example .env.local`.
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/hooks/tool-guard.test.js` — the new cases FAIL (the `HEAD:` forms and `.env.example` pass the guard today).
- [ ] **Step 3: Implement.** `envName(name, fold)` returns `fold(name).startsWith('.env')`. In `bashRefused`'s `.env` check, take the last part split at `/`, `\` **and** `:` (a `<rev>:` prefix is a path boundary); keep `lastPart` (slashes only) for command names. Update the `patternNamesEnv` comment ("names a .env file").
- [ ] **Step 4: Run** the same command — all PASS.
- [ ] **Step 5: Commit** `Refuse .env files named behind a git revision, and .env.example as the Standard settings do`.

### Task 2: Pipes into a shell and script files

**Files:**
- Modify: `scripts/hooks/tool-guard.js` (`bashRefused` takes a context `{ windows, fold, cwd }`; new helpers below; `decide` passes `input.cwd`)
- Test: `tests/scripts/hooks/tool-guard.test.js`

**Interfaces (new, module-private in `tool-guard.js`):**
- `commandAt(seg: string[], names: string[]) -> number` — index of the segment's command word: skips assignments (`/^[A-Za-z_][A-Za-z0-9_]*=/`), options (`OPTION`), plain durations (`/^\d+(\.\d+)?[smhd]?$/`) and the wrappers `command builtin exec nohup time nice sudo doas timeout stdbuf setsid env then do else if elif while until !`. Returns `seg.length` when there is none.
- `scriptRefused(file: string, dir: string | null, ctx, depth) -> boolean` — `true` when the file can't be placed (`dir` null and path relative), is missing, is not a regular file, can't be read, or is over 1 MB; when its first 4 KB holds a NUL byte, `false` (a binary); otherwise its text is checked with `bashRefused(text, …, depth + 1)`.

- [ ] **Step 1: Write the failing tests.** A test `Bash refuses a pipe or redirect into a shell` over: `echo "gh pr merge 1" | sh`, `base64 -d x | sh`, `curl x | bash -s`, `cat x | bash -`, `sh < t.txt`, `bash <<EOF`, `echo x | xargs sh -c`, `echo x | xargs -I{} sh -c '{}'`, `find . -exec sh {} \\;`, `x | env bash`, `x | command zsh`, `x | pwsh -Command -`, `x | cmd`. A test `Bash refuses a script that runs the host tools` that writes `t.sh` (`gh pr merge 1\n`) in the project and asserts refused for `sh t.sh`, `bash ./t.sh`, `source t.sh`, `. t.sh`, `./t.sh` (no shebang), and for a `#!/bin/bash` file `run` called as `./run`; and `cd sub && ./t.sh` with `sub/t.sh` holding `gh x`. A test `Bash refuses a script it cannot read first` for `echo "gh pr merge 1" > new.sh; sh new.sh` (missing at check time), `sh /dev/stdin`, `sh sub` (a folder). A test `Bash allows clean scripts, binaries by path and shell names as arguments` asserting `undefined` for: `sh ok.sh` and `./ok.sh` (file `echo hi`), `cd sub && ./ok.sh`, `which sh`, `command -v bash`, `grep bash a.txt`, `/usr/bin/git status` (skip on win32), `./tool.js` with `#!/usr/bin/env node\nrequire('gh')`, `bash -c "echo hi"`.
- [ ] **Step 2: Run** the test file — the refusal cases FAIL today, the allowed ones pass.
- [ ] **Step 3: Implement.** In each segment, after the existing word checks, take `k = commandAt(seg, names)` and the command word `w = seg[k]`, `args = seg.slice(k + 1)`:
  - a shell (`SHELLS`) or any shell word after `xargs`, `-exec` or `-execdir` in the segment: refused when after `xargs`/`-exec`; with a `SHELL_FLAG` word among `args`: refused when nothing follows the flag; otherwise POSIX shells: refused when `args` has `-` or `-s`, or no non-option word (input from a pipe or redirect); else the first non-option word goes to `scriptRefused`. `pwsh`/`powershell`: refused for a `-` word or no words; the word after `-File`/`-f` goes to `scriptRefused`. `cmd`: refused with no words.
  - `source` or `.`: `args[0]` goes to `scriptRefused`.
  - a word with a `/` that is not a shell: `scriptRefused` in "by path" mode — a text file is checked only when it has no shebang or its shebang names a shell (`sh bash zsh dash ksh fish`, directly or through `env`); any other shebang passes.
  - a segment `cd <dir>` or `pushd <dir>` moves `dir` for the later segments (`path.resolve(dir, <dir>)`; `cd` alone or `cd -` makes `dir` null, so later relative scripts are refused).
  The depth limit (`MAX_DEPTH`) covers a script that runs another. Header comment of `bashRefused` says what is read and that `node x.js`, `npm run`, `make` and the like are not looked into.
- [ ] **Step 4: Run** the test file — all PASS; then `npm test`.
- [ ] **Step 5: Update** the command-guard paragraph of the design (`docs/specs/2026-10-17-wheelhouse-design.md`, "A command guard behind the deny rules") with one sentence each: a shell fed by a pipe or redirect is refused; a script run by a shell, `source` or by path is read and held to the same rules, and one that can't be read yet is refused; scripts run by other interpreters or build tools are not looked into. Add `<rev>:` and `.env.example` to its `.env` clause.
- [ ] **Step 6: Commit** `Refuse a shell fed by a pipe, and read the scripts a command runs`.

## Outcome (23 October 2026)

Tasks 1 and 2 were built as planned. Reviews then showed that opening script files and checking their text fails open wherever the word splitter misreads them: heredocs, comments, nested quotes, `case` patterns. So the guard no longer opens scripts. A script run by a shell, `source` or by path is refused only when the same command names it again, or when it doesn't exist yet (by path: `./`, `../` and `/` words). A script written in an earlier command, or by the file tools, is left to the sandbox. The design paragraph says so.
