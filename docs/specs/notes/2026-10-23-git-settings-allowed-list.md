<!-- docs/specs/notes/2026-10-23-git-settings-allowed-list.md -->
# Git settings the fenced route may allow

A design review of the allowed list behind `scripts/lib/safe-git.js` (ruling R112), written on 23 October 2026 against the security-gaps branch (head `c5e7c52`, merged with main as `96bfb74`). It decides, for each family of git settings, whether a repository may hold it: **allowed as is**, **allowed with a condition** (what is checked), or **refused** (why). Nothing here changes code; the security-gaps branch, or a follow-up, builds from it.

Claims marked *measured* were tried on git 2.54 on 23 October 2026, with the global and system config shut out.

## 1. How the decision is made

A planted setting matters only if one of Wheelhouse's own fenced calls reads it. So each family is weighed against three things:

1. **What Wheelhouse runs there.** In the director's project repositories, Wheelhouse only reads, fetches, makes a worktree and fast-forwards: `symbolic-ref`, `rev-parse`, `worktree add`, `fetch`, `merge --ff-only`, `log --format=%H`, `rev-list`, `status --porcelain`, `remote`, `worktree list`. It never commits, tags, rebases or pushes there. The commits, rebases and pushes are all in repositories Wheelhouse made itself (the helper's mirror, state and profile repositories).
2. **What the fence already overrides.** The fence's settings travel as `GIT_CONFIG_*` pairs, which git reads after the repository's own config, so for an ordinary (one-value) key the fence's value wins. A key the fence sets is harmless in the repository's config, with two exceptions found in this review: a URL-scoped key (`http.<url>.sslVerify`) beats the fence's plain `http.sslVerify` (*measured*), and config-defined hooks (`hook.<name>.command`) run even with `core.hooksPath` pointed at the null file (*measured*).
3. **Whether the key can run a program, send data elsewhere, or weaken a check.**

From that, the review splits the look into **two lists by the kind of repository**:

- **Wheelhouse's own repositories** (the helper's mirror, state, lock and profile repositories; Claude Code's marketplace copy). Wheelhouse made them and commits and pushes there. They keep R112's strict list unchanged: anything else in them was planted.
- **The director's project repositories** (the foreman's main checkout, a feature's worktree, the install survey's project, and the folder the helper copies from). Wheelhouse only reads and fetches there, so the wider list below applies.

## 2. Section for design 12.9

> **Which git settings a repository may hold.** The look checks a repository's own settings against one of two allowed lists. A repository Wheelhouse made (the helper's mirror, state, lock and profile repositories, and Claude Code's marketplace copy) keeps the short list of ruling R112, since Wheelhouse commits and pushes there and anything else in it was planted. A project's repository (the foreman's checkout, a feature's worktree, the survey's project, the folder the helper copies from) takes a wider list, since Wheelhouse only reads, fetches, makes worktrees and fast-forwards there. The wider list adds settings that run no program and change nowhere git connects or writes (line endings, storage and speed, status and colour, sparse checkout, partial clone, LFS's own section, submodule details, upstream details, and tools' own keys under `branch.` and `remote.`, which hold a `-`), and settings the fence overrides on every call: signing and signature checks (the fence turns them off: no Wheelhouse call signs or verifies), the editor, pager, ssh command, file-system monitor and hooks folder, submodule recursion, and any credential helper (every fenced call clears the list of credential helpers before adding the director's own sign-in, if any). It still refuses every setting that can run a program (filters, diff and merge drivers, config-defined hooks, signing programs, `core.alternateRefsCommand`, `core.gitProxy`, `uploadpack` and `receivepack`, `trailer` commands, `init.templateDir`), send data elsewhere (`url.*.insteadOf`, `http.proxy` and `remote.*.proxy`, `fetch.bundleURI`, `remote.*.vcs`), change what git trusts (`http.*` beyond a few transfer sizes, any URL-scoped `http.<url>.*`), or move where git works (`core.worktree`). Push targets (`remote.*.pushurl`, `branch.*.pushRemote`, `remote.pushDefault`) are allowed in a project's repository only because no Wheelhouse call pushes from one; a call that pushes from a project's repository names its address, never a remote. A tool's key under `branch.` or `remote.` is allowed because git reads no key with a `-` in its name; `remote.*.gh-resolved` is allowed only because every `gh` and `glab` call of Wheelhouse names its repository. An LFS project set up with `git lfs install --local` is refused (its `filter.lfs.*` runs git-lfs), and without the global config even an ordinary LFS project's worktree gets pointer files, not content: left open. *Designer's call.*

## 3. Outcomes by family

"Overridden" means allowed because the fence sets the key on every call; a test keeps that true (section 5). "Project" means on the project list only; the own-repository list is R112's, unchanged.

| Family | Outcome | Condition or reason |
|---|---|---|
| R112's present list (`core.repositoryformatversion` … `include.path`, `remote.*.url/fetch`, `branch.*.remote/merge/rebase/description`, `includeIf.*.path`, `pull.*`, `color.*`, `advice.*`) | Allowed as is | Unchanged. R113's rule on remote names stays. `include`/`includeIf` stay allowed because the look reads with `--includes`; the foreman's R93 check stays for other contexts |
| `core.longpaths`, `core.fscache`, `core.untrackedcache`, `core.splitindex`, `core.commitgraph`, `core.multipackindex`, `core.preloadindex`, `core.checkstat`, `core.trustctime`, `core.whitespace`, `core.abbrev`, `core.compression`, `core.sparsecheckout`, `core.sparsecheckoutcone` | Allowed as is (project) | Storage, speed and line handling; Windows and Scalar write several. No program, no address |
| `core.fsmonitor`, `core.fsmonitorhookversion`, `core.sshcommand`, `core.askpass`, `core.editor`, `core.pager` (`core.hookspath` already listed) | Allowed, overridden (project) | The fence sets each on every call. A per-repository `core.sshCommand` (a work key) is common |
| `core.worktree`, `core.gitproxy`, `core.alternaterefscommand`, `core.attributesfile`, `core.excludesfile`, `core.sharedrepository`, other `core.*` | Refused | Moves where git writes; runs a program; or reads files or sets permissions with no need in an ordinary project. Fails closed |
| `user.name`, `user.email`, `user.signingkey`, `user.useconfigonly`, `author.*`/`committer.*` `name`/`email` | Allowed as is (project) | Identity only; a key id runs nothing |
| `commit.gpgsign`, `tag.gpgsign`, `push.gpgsign`, `log.showsignature`, `merge.verifysignatures`, `gpg.format` | Allowed, overridden (project) | **New fence keys:** `commit.gpgSign=false`, `tag.gpgSign=false`, `push.gpgSign=false`, `log.showSignature=false`, `merge.verifySignatures=false`. No Wheelhouse call on a project commits, tags or pushes; the fence makes sure none signs or checks a signature, which is what would run the signing program. A company that requires signed commits is unaffected: the agents' own commits are made outside this route, and merges happen on the host |
| `gpg.program`, `gpg.*.program`, `gpg.ssh.defaultkeycommand`, other `gpg.*` | Refused | Each names a program. With signing off it would not run today, but `%G?` in a `--format`, `verify-commit` or a future caller would run it. A program kept in the director's global config is unaffected (shut out anyway) |
| `credential.helper`, `credential.<url>.helper`, `credential.username`, `credential.<url>.username`, `credential.usehttppath`, `credential.<url>.usehttppath` | Allowed with a condition (project) | **New fence rule:** every fenced call's own pairs begin with `credential.helper=` (empty), which clears every helper the repository listed, URL-scoped ones included (*measured*); the director's sign-in (`gh`/`glab auth git-credential`) comes after it where the call signs in. Today only calls with `directorSignIn` carry the reset |
| Other `credential.*` | Refused | Fails closed |
| `branch.<name>.<key>` where the key holds a `-` (`vscode-merge-base`, `github-pr-owner-number`, `gk-merge-base`) | Allowed as is (project) | Tools' own keys. Git reads no key with a `-` in its name, and no Wheelhouse call runs those tools |
| `branch.<name>.pushremote` | Allowed with a condition (project) | Only because no Wheelhouse call pushes from a project's repository |
| `branch.<name>.mergeoptions` | Refused | Can name a merge strategy (a `git-merge-*` program) or signing for the feature's `merge --ff-only` |
| `remote.<name>.tagopt`, `prune`, `prunetags`, `push`, `partialclonefilter`, `promisor`, `followremotehead`, `skipdefaultupdate`, `skipfetchall` | Allowed as is (project) | Which refs a fetch takes; no address. Lazy fetching stays off (`GIT_NO_LAZY_FETCH`), so a partial clone may fail a worktree checkout, said plainly, but never fetches on the side |
| `remote.<name>.pushurl`, `remote.pushdefault` | Allowed with a condition (project) | Only because no Wheelhouse call pushes from a project's repository; a call that ever does names the address. Refused in Wheelhouse's own repositories |
| `remote.<name>.gh-resolved` and other `remote.<name>.<key>` holding a `-` | Allowed with a condition (project) | `gh` writes `gh-resolved` to pick a repository; allowed only while every `gh`/`glab` call of Wheelhouse names its repository (`-R` or a full API path) or runs outside the project |
| `remote.<name>.proxy`, `uploadpack`, `receivepack`, `vcs`, `mirror`, `serveroption` | Refused | Sends through another host; runs a program (on a local remote `uploadpack` runs here); a helper program; a mirror push deletes; sends data. Fails closed |
| `url.<base>.insteadof`, `url.<base>.pushinsteadof` | Refused | Rewrites where git connects. A company's rewrite belongs in the global config, which the route shuts out on purpose |
| `http.postbuffer`, `http.version`, `http.lowspeedlimit`, `http.lowspeedtime`, `http.maxrequests` (plain, no URL) | Allowed as is (project) | Transfer sizes and timing only |
| `http.sslverify` (plain) | Allowed, overridden (project) | The fence sets `http.sslVerify=true` |
| `http.<url>.*`, `http.proxy`, `http.sslcainfo`, `http.sslcapath`, `http.sslbackend`, `http.sslcert`, `http.extraheader`, `http.cookiefile`, other `http.*` | Refused | A URL-scoped key beats the fence's plain one (*measured*: `http.<url>.sslVerify=false` wins); the rest send data elsewhere, change trust, add headers or write a file |
| `protocol.version` | Allowed as is (project) | Wire version only |
| `protocol.allow`, `protocol.<name>.allow` | Refused | Overridden by `GIT_ALLOW_PROTOCOL`, but no ordinary project needs them. Fails closed |
| `submodule.<name>.url`, `path`, `active`, `branch`, `ignore`, `shallow`; `submodule.active` | Allowed as is (project) | Wheelhouse never runs `git submodule`, and the fence turns recursion off |
| `submodule.recurse`, `submodule.<name>.fetchrecursesubmodules` | Allowed, overridden (project) | With the fence's `fetch.recurseSubmodules=false`, a fetch did not go into a populated submodule even with the repository's own `submodule.<name>.fetchRecurseSubmodules=true` or the same in `.gitmodules`; without the fence it did (*measured*) |
| `submodule.<name>.update` | Refused | Its `!command` form runs a program |
| `lfs.*` | Allowed with a condition (project) | Read only by git-lfs, which runs only through a filter (`filter.*` refused) or a hook (off). Includes `lfs.customtransfer.*.path`, inert while those stay so |
| `filter.*` (including `filter.lfs.*`) | Refused | Runs a program on checkout and status |
| `diff.*`, `difftool.*`, `merge.<driver>.*`, `mergetool.*`, `sequence.editor`, `trailer.*`, `sendemail.*`, `pager.*` | Refused | Each names a program (`diff.external`, textconv, merge drivers, tools, `trailer.*.command`, `pager.<cmd>`), or has no use in Wheelhouse's calls. Fails closed |
| `merge.conflictstyle` (`merge.ff` already listed) | Allowed as is (project) | Display only |
| `rebase.autostash`, `rebase.autosquash`, `rebase.updaterefs` | Allowed as is (project) | No Wheelhouse rebase runs in a project; harmless if one did |
| `alias.*` | Allowed with a condition (project) | Git ignores an alias named after a built-in command (*measured*), and every subcommand Wheelhouse runs is a built-in |
| `hook.*` (config-defined hooks) | Refused | Runs a program, and `core.hooksPath` pointed at the null file does **not** stop it (*measured*, git 2.54). Must stay off both lists |
| `fetch.prune`, `prunetags`, `writecommitgraph`, `parallel`, `showforcedupdates`, `unpacklimit`, `negotiationalgorithm`, `output` | Allowed as is (project) | How a fetch behaves, not where |
| `fetch.recursesubmodules`, `push.recursesubmodules` | Allowed, overridden (project) | In the fence |
| `fetch.bundleuri`, `fetch.fsckobjects`, `fetch.fsck.*`, `transfer.*`, `fsck.*`, `receive.*`, `uploadpack.*`, `uploadarchive.*` | Refused | Fetches from another address; or weakens or tunes object checks (off by default already, so refusing loses nothing); or serves |
| `push.default` (listed), `push.autosetupremote`, `push.followtags`, `push.useforceifincludes` | Allowed as is (project) | Nothing pushes from a project; harmless if one did |
| `maintenance.*` | Allowed, overridden (project) | `git maintenance register` writes `maintenance.strategy` and `maintenance.auto` into the repository; the fence sets `maintenance.auto=false`, so no task runs |
| `gc.auto`, `gc.autodetach`, `gc.autopacklimit`, `gc.writecommitgraph`, `gc.cruftpacks`, `gc.reflogexpire`, `gc.reflogexpireunreachable`, `gc.pruneexpire` | Allowed as is (project) | Storage only. Not `gc.recentObjectsHook`, which runs a program |
| `pack.*`, `index.*`, `feature.*`, `commitgraph.*`, `status.*`, `log.*` except `showsignature`, `column.*`, `gui.*`, `rerere.*`, `blame.*`, `checkout.defaultremote`, `checkout.workers`, `checkout.thresholdforparallelism`, `worktree.guessremote`, `worktree.userelativepaths`, `extensions.partialclone`, `extensions.preciousobjects`, `init.defaultbranch` (listed) | Allowed as is (project) | Storage, display and speed; `blame.ignoreRevsFile` (common) only reads a file in the project |
| `init.templatedir` | Refused | Copies hooks and files in on init and clone |
| `safe.*` | Refused | Honoured only from protected config; in a repository it is a sign of a planted setting |
| Anything else | Refused | The list fails closed, as R112 says |

Whole sections (`pack`, `index`, `feature`, `commitgraph`, `status`, `log`, `column`, `gui`, `rerere`, `blame`, `lfs`, `maintenance`) join `pull`, `color` and `advice` as whole-section entries. Each has no key that runs a program or names an address in git 2.54; a git upgrade's release notes are checked for new keys in these sections (section 5, test 14).

## 4. Found in passing

1. **Config-defined hooks get past the hooks setting.** `hook.<name>.command` with `hook.<name>.event` ran on `git commit` with `core.hooksPath=/dev/null` set by environment (*measured*, git 2.54). Today the look refuses `hook.*`, but the repositories that are fenced and not looked at (the state clones, install and lineage clones, the private-words scan) rely on being Wheelhouse's own. 12.9 should say so. `--no-verify` remains the per-call stop for commits and pushes.
2. **URL-scoped `http.<url>.*` beats the fence's plain keys.** The fence's `http.sslVerify=true` does not hold against `http.https://host.sslVerify=false` (*measured*). Refused here; the fence's comment in `scripts/setup/git.js` should not say `http.sslVerify` "always" holds.
3. **A local fetch's serving side runs without the fence.** For a fetch from a path, git starts `git-upload-pack` in the source with `GIT_CONFIG_COUNT` unset (*measured* in the trace). So keys allowed only because the fence overrides them are not covered in a source repository. In git 2.54 upload-pack reads none of them, and `uploadpack.packObjectsHook` is honoured only from protected config, so nothing runs; the source should still be looked at with the project list (the helper's copy already looks at it).
4. **LFS without the global config.** git-lfs's filters live in the global config, which the route shuts out, so the foreman's new worktree of an LFS project gets pointer files. Agents would then work on pointers until `git lfs pull`. Not a fence question; left open for the foreman.
5. **The `gh-resolved` condition is unchecked.** Whether every `gh`/`glab` call names its repository was not traced in this review; test 9 settles it.

## 5. Tests to build

Each test makes a throwaway repository with the global and system config shut out, plants the setting, and runs the route.

1. **Two lists.** The same project-list key (for example `core.longpaths`) passes the look in a foreman, survey or feature route and is refused in the helper's mirror and the marketplace copy.
2. **Every project-list family passes.** One key from each "allowed" row of section 3 passes the project look; one key from each "refused" row is refused, named.
3. **Overridden keys stay overridden.** A static test: every key the project list allows as overridden is in `FENCE` (or, for `credential.helper`, the reset), so removing a fence key fails the test.
4. **Fence override holds at run time.** With `core.fsmonitor`, `core.pager`, `core.editor`, `core.sshCommand` and `core.askPass` each set to a program that writes a marker, every route's typical call runs and no marker appears.
5. **Signing is off.** With `commit.gpgSign=true`, `log.showSignature=true`, `merge.verifySignatures=true` and `gpg.format=ssh` (and `gpg.program` set to a marker, in a test that skips the look), the survey's `log`, the feature's `merge --ff-only` and the helper's state commit run no marker.
6. **The credential reset.** A repository with `credential.helper` and `credential.https://<host>.helper` both set to markers: a fenced fetch over the loopback stand-in that answers 401 runs neither; with `directorSignIn`, the stand-in host tool is the only helper asked.
7. **URL-scoped http refused.** `http.https://example.com.sslVerify=false` and `http.https://example.com.proxy` are refused, named.
8. **Config hooks refused.** `hook.x.command` and `hook.x.event` are refused on both lists.
9. **gh names its repository.** A scan, like the raw-git guard: every `gh`/`glab` call in `scripts/` passes `-R`/`--repo`, a full `repos/<owner>/<name>` path, or runs with a working folder outside any project. Until it passes, `remote.*.gh-resolved` is refused.
10. **No push from a project.** A scan: no route whose look is the project list runs `push`, `commit`, `tag`, `rebase` or `am`. Until it passes, `remote.*.pushurl`, `remote.pushDefault` and `branch.*.pushRemote` are refused.
11. **Submodule recursion stays off.** A project with a populated submodule and `submodule.<name>.fetchRecurseSubmodules=true` (in `.git/config`, then in `.gitmodules`): the survey's and feature's fetches start no git in the submodule (checked by `GIT_TRACE` or a marker in the submodule's config).
12. **Built-ins only.** A scan: every subcommand passed to the route is a git built-in, so `alias.*` cannot shadow one. A planted `alias.status=!<marker>` runs nothing in the survey.
13. **Ordinary projects pass.** Fixtures copied from real-world shapes: a VS Code checkout (`branch.*.vscode-merge-base`), a `gh repo clone` (`remote.origin.gh-resolved`), a signed-commits repository (`commit.gpgsign`, `user.signingkey`, `gpg.format=ssh`), an LFS repository installed globally (`lfs.*` only), a Scalar clone (`core.fsmonitor`, `maintenance.*`, `feature.*`, `index.*`), a partial clone (`remote.origin.promisor`, `extensions.partialclone`) and a Windows clone (`core.longpaths`, `core.fscache`). Each passes the project look.
14. **New keys in whole sections.** A test that lists `git help --config` and fails when a key appears in a whole-section entry that is not in a recorded snapshot, so a git upgrade is looked at before it is trusted.

## 6. Rulings made here

- **Two lists by kind of repository**, not one list for all: the strict list protects where Wheelhouse commits and pushes; the wider one is safe where it only reads and fetches. *Designer's call.*
- **Signing is turned off in the fence**, rather than allowed to run: Wheelhouse makes no commit in a project, and its own repositories need no signature. A company's signing rule applies to the agents' commits and the host's merges, neither of which goes through this route.
- **The credential reset goes on every fenced call**, not only signed-in ones, so a repository's helper is inert everywhere and can be allowed.
- **Tools' hyphenated keys** under `branch.` and `remote.` are allowed by shape (git never reads such a key), with `gh-resolved` held to test 9.
- **Rare keys stay refused** even where harmless, as R112 intends: each refusal names the key, so a real project that needs one shows it and it is looked at then.
- **No question goes to the director.** Each trade-off above has a clear answer once the two lists are split; the one cost (an LFS project installed with `--local`, and LFS content in worktrees) is recorded as left open.
