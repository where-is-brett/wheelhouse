<!-- docs/research/windows-build-commands-2026-10.md -->

# Running build commands unattended on Windows

Research brief, compiled 19 October 2026, on whether Wheelhouse's feature sessions can run build commands (`npm test`, `node` scripts, `npx`, `git`) on Windows without asking the director each time.

**The question.** On macOS, Claude Code's sandbox lets feature sessions run build commands without asking, because the operating system stops a command from writing outside the project or reaching hosts that aren't on an allow list. Native Windows has no such sandbox, so Windows sessions ask the director before each build command. Is there a safer way to run them unattended? The threats are a build command, a malicious dependency's install or test script, or a prompt-injected agent:

- **reading secrets** in the home folder (SSH keys, git credentials, browser data, `~/.wheelhouse` with its signing keys);
- **writing outside the project**, for example to Wheelhouse's own hooks and settings to widen the agent's powers, or to startup folders;
- **sending data out** over the network.

**The constraint.** The director may be on a locked-down work computer: a standard user with no admin rights, unable to get WSL2 or install apps without IT. So the recommended route has to work on stock Windows with what ships with Windows and Node.js. Everything that needs IT or admin is kept below for completeness and marked **needs IT or admin**.

**How to read this.** Every claim carries a source link. Sources are primary: vendor documentation, source code, the vendors' own issue trackers and blogs. Markers:

- **[not confirmed]**: I could not confirm it from a primary source, or the primary sources disagree.
- **[inference]**: my own reasoning from the cited sources. The source doesn't say it.
- **[user report]**: from a public issue filed by a user in the vendor's tracker, not from the vendor.

All pages were read on 19 October 2026 unless a different date is given.

---

## Summary

- **Claude Code still has no sandbox on native Windows.** Its docs say: "On native Windows, Claude Code runs commands unsandboxed." Anthropic's answer for Windows is WSL2 or a container ([sandboxing](https://code.claude.com/docs/en/sandboxing)). The open-source sandbox runtime underneath it has a Windows build marked **alpha**, which needs one admin (UAC) step to create a separate sandbox user ([sandbox-runtime README](https://github.com/anthropics/sandbox-runtime)). Microsoft lists Claude Code among tools "releasing support" for its new Execution Containers ([Windows blog, 7 October 2026](https://blogs.windows.com/windows/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)). Nothing from Anthropic confirms a date.
- **On stock Windows, as a standard user with nothing installed, no route covers all three threats.** Network can't be limited at all without admin or an added component. What a standard user *can* do:
  - **Block writes outside the project: yes.** Run build commands at **low integrity**. Windows stops a low-integrity process writing to anything at the normal (medium) level, which is nearly the whole home folder, Wheelhouse's own files and the startup folders ([Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)). Node.js can do this with no native code. Label a private copy of `node.exe` and the worktree as Low with the built-in `icacls`. A process started from a Low-labelled program runs at Low, and so does everything it starts.
  - **Block reads of named secret folders: probably.** Low integrity doesn't stop reads by default. But a folder's owner can give it a label that also forbids reads from lower levels ("no read up"). Setting a label needs only `WRITE_OWNER`, which the owner has ([SECURITY_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-information)). `icacls` can't clearly set that flag, so Wheelhouse would need a Win32 call: Node 26's experimental built-in `node:ffi` ([docs](https://nodejs.org/api/ffi.html)), or PowerShell `Add-Type`, which locked-down computers block ([language modes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes)) **[not confirmed]**. It covers only the folders Wheelhouse knows to label.
  - **Block the network: no.** Without admin there is no operating-system control that stops a low-integrity or restricted-token process from using the network. AppContainer can block it, but it can't run `node.exe` without an admin preparation step, and it has no per-host allow list (section 3.2).
- **The closest no-admin route that covers all three is Microsoft Execution Containers (MXC).** It needs Windows 11 24H2 or 25H2 with the August 2026 update or later. It makes no admin prompt and creates no extra accounts ([Codex Windows sandbox docs](https://learn.chatgpt.com/docs/windows/windows-sandbox); [MXC repo](https://github.com/microsoft/mxc)). It is not part of stock Windows for Wheelhouse's purposes, though: it needs Microsoft's SDK package, which has native dependencies. Codex and VS Code already use it or a similar new Windows feature.
- **Recommendation** [inference]. Build a **low-integrity build runner** as the stock Windows route. It makes routine commands (tests, lint, build scripts, local `git`) safe from *writing outside the project*, and from reading the secret folders Wheelhouse labels. It is **not** a sandbox, because the network stays open. Commands that fetch and run new third-party code (`npm install`, `npx` of a package not yet installed) should keep asking, or go behind the dangerous switch. Where IT will help, MXC or WSL2 give the full macOS-like boundary. Section 8.4 has the checks to run on a real Windows computer first. The design takes this route as the level **Guarded** (`docs/specs/2026-10-17-wheelhouse-design.md`, section 12.2), and the checks as checks 40 and 41 (section 20).
- **One finding for macOS too.** Claude Code's sandbox lets commands read "Most of the machine, including credential files such as `~/.ssh`" by default ([sandboxing](https://code.claude.com/docs/en/sandboxing)). It protects reads only with `denyRead` or `credentials` entries, or `blockReadsOutsideWorkingDirectories`. Wheelhouse's Mac setup should deny `~/.wheelhouse` and `~/.ssh` explicitly, if it doesn't already [inference].

---

## 1. Comparison

"Reads" means it stops a build command reading secrets in the home folder. "Writes" means it stops writes outside the project. "Network" means it limits where data can be sent. "Stock" means it works with what ships with Windows and Node.js, as a standard user.

| Option | Reads | Writes | Network | Admin or install | Cost | Speed | Locked-down work computer |
|---|---|---|---|---|---|---|---|
| Claude Code built-in sandbox, native Windows | Not available | Not available | Not available | n/a | Free | n/a | n/a |
| **Low integrity (stock)** | No by default; labelled folders yes **[not confirmed]** | Yes, for anything not labelled Low | No | None. Uses `icacls` and a copy of `node.exe` | Free | Negligible [inference] | Likely, unless AppLocker or App Control blocks the copied `node.exe` |
| Write-restricted token (Codex's unelevated mode) | No | Yes | No (Codex: "weaker") | No admin; needs a Win32 call (FFI or `Add-Type`) | Free | Negligible | Only if FFI or `Add-Type` is usable |
| AppContainer or LPAC (stock APIs) | Yes | Yes | All or nothing, no host list | Admin preparation for `node.exe` (per MXC) | Free | Fast | No for Node without that preparation |
| Job objects | No | No | No (Gemini throttles, doesn't block) | None | Free | Negligible | Yes, but protects nothing |
| Separate standard user account | Yes inside the profile | Partly | Only with admin firewall filters | **Needs IT or admin** | Free | ACL work slow at start | No |
| Node.js permission model | Node code only | Node code only | Node code only (`--allow-net`, Node 25+) | None | Free | Negligible | Yes, but "not a security boundary" |
| Throwaway copy of the worktree | No | Protects the worktree only | No | None | Free | Copy time | Yes, but protects little |
| sandbox-runtime Windows (alpha) | Yes in the profile; not other drives or folders under `C:\` | Same gap | Yes, allow list | **Needs IT or admin** (one UAC) | Free | Start-up ACL stamping can be slow | No |
| MXC ProcessContainer | Yes | Yes | Yes, through a local proxy | No admin on patched Windows 11; needs the SDK installed | Free | Fast (process-level) | Likely, if Windows 11 is patched [not confirmed] |
| WSL2 + Claude Code's Linux sandbox | Only with `denyRead`, including `/mnt/c` | Yes | Yes, allow list | **Needs IT or admin** | Free | Fast on Linux files; slow on `/mnt/c` | Often blocked by policy |
| Windows Sandbox | Yes | Yes (mapped folder) | On or off | **Needs IT or admin**; Pro or Enterprise | Free | Seconds to start; no command output | Often unavailable |
| Docker Desktop or Podman dev container | Yes (only what's mounted) | Mounted folders only | Yes with a firewall script | **Needs IT or admin** (WSL2 or Hyper-V) | Docker paid over 250 staff or US$10M | Container start; slow mounted I/O [inference] | Usually no |
| Docker Sandboxes (microVM) | Yes | Workspace only | Deny by default, broad defaults | **Needs IT or admin** (Hypervisor Platform) | Free locally | VM start | Usually no |

---

## 2. Claude Code's own sandbox on Windows

### 2.1 Status today

- **Not on native Windows.** "The sandbox runs on macOS, Linux, and WSL2. On native Windows, Claude Code runs commands unsandboxed. To use the sandbox on a Windows machine, run Claude Code inside a WSL2 distribution." ([sandboxing](https://code.claude.com/docs/en/sandboxing)) The comparison page repeats it: "This option does not support native Windows" ([sandbox environments](https://code.claude.com/docs/en/sandbox-environments)).
- **For managed fleets** the docs suggest "have them run Claude Code inside WSL2 or a container" ([sandboxing](https://code.claude.com/docs/en/sandboxing)).
- **The changelog** (Claude Code 2.1.302, the latest) has no entry adding a native Windows sandbox. It does have Windows fixes for running "inside an AppContainer or restricted-token sandbox" (2.1.265), which suggests some sandboxed launch is being tested [inference] ([CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
- **Users disagree** [user report]. Some issues describe a sandbox on Windows Desktop: Gradle failing "inside the sandboxed Bash on Windows" ([#77508](https://github.com/anthropics/claude-code/issues/77508)), and "Sandbox enabled" breaking worktrees ([#103098](https://github.com/anthropics/claude-code/issues/103098)). Another found Desktop's "Local sandbox" setting hidden on `win32` ([#96324](https://github.com/anthropics/claude-code/issues/96324)). One reports that shell commands reached a network share outside the working folder ([#79300](https://github.com/anthropics/claude-code/issues/79300)). Whether Desktop on Windows applies any sandbox is **[not confirmed]**. The docs say no.
- **Requests are open**: MXC support ([#69495](https://github.com/anthropics/claude-code/issues/69495)) and a native sandbox in the runtime ([sandbox-runtime #105](https://github.com/anthropics/sandbox-runtime/issues/105)).

### 2.2 The sandbox runtime's Windows build (alpha) — needs IT or admin

The runtime Claude Code builds on now has Windows code. The first Windows commits are from 23 May 2026, and it was marked alpha on 25 June 2026 (repository history). Latest release v0.0.80, 16 October 2026 ([README](https://github.com/anthropics/sandbox-runtime)):

- **How it works.** "The sandboxed process runs under a dedicated `srt-sandbox` local user account." It adds "a Windows Filtering Platform (WFP) egress fence keyed on the sandbox account's SID, and per-session explicit ACEs" on the allowed paths. The launch uses `CreateProcessWithLogonW`, then "a restricted token inside a job object".
- **Admin.** "Run once per machine (self-elevates; one UAC prompt)": `npx @anthropic-ai/sandbox-runtime windows-install`. **This rules it out for a standard user.**
- **Protects reads.** The sandbox account "has no inherent rights on the calling user's files", so `~/.ssh` and `~/.wheelhouse` in the profile are unreadable.
  - **The gap** [user report]: the account belongs to `Authenticated Users`. Other drives and folders made directly under `C:\` grant that group Modify, so they are readable and writable without any grant ([#402](https://github.com/anthropics/sandbox-runtime/issues/402)).
- **Protects the network.** "A process that strips its proxy environment and connects directly is blocked at the kernel."
  - DNS lookups through the system resolver aren't fenced.
  - Local named pipes are reachable [user report] ([#559](https://github.com/anthropics/sandbox-runtime/issues/559)).
- **Other limits.**
  - Per-user tool installs (nvm, Scoop, `%LOCALAPPDATA%\Programs`) "cannot be opened by the sandbox account".
  - Writing ACLs on profile folders can take about 30 seconds a path [user report] ([#457](https://github.com/anthropics/sandbox-runtime/issues/457)).
  - The helper needs the VC++ runtime [user report] ([#451](https://github.com/anthropics/sandbox-runtime/issues/451)).
- **Not wired into Claude Code** on native Windows, per the docs above.

---

## 3. Stock Windows, standard user, nothing installed

These are the routes that fit the constraint. The question for each is what a standard user can do and what it protects.

### 3.1 Low-integrity processes

**What it is.** Every process and object has an integrity level: low, medium, high or system. "Standard users receive medium." "A principal with a low integrity level cannot write to an object with a medium integrity level, even if that object's DACL allows write access." "Objects that lack an integrity label are treated as medium." By default "the system creates every object with an access mask of SYSTEM_MANDATORY_LABEL_NO_WRITE_UP" ([Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)).

**How a standard user starts one with no native code.**
- "The new process is created with the minimum of the user integrity level and the file integrity level" (same page). So a private copy of `node.exe`, labelled Low with `icacls <file> /setintegritylevel L`, starts at Low. Everything it spawns is also Low [inference from the same rule].
- `icacls` ships with Windows and sets integrity labels with `/setintegritylevel` ([icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)).
- Setting a label needs only `WRITE_OWNER` ([SECURITY_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-information)), which an owner normally has on their own files [inference].
- **Prior art.** Gemini CLI's Windows sandbox does this unprivileged. It "uses the `icacls` command to set a 'Low Mandatory Level' on files and directories it needs to write to" ([Gemini sandbox docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md)). Its helper adds restricted tokens and job objects ([WindowsSandboxManager.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/sandbox/windows/WindowsSandboxManager.ts)).

**Protects against.**
- Writes outside the project: to Wheelhouse's plugin files and hooks, `~/.claude`, the startup folder and most of `HKCU`, all of which are medium. The worktree itself has to be labelled Low so builds can write there.

**Doesn't protect against.**
- **Reads.** The default label forbids writing up, not reading up, so `~/.ssh`, git credentials, browser data and `~/.wheelhouse` stay readable (page above).
  - **The narrow fix.** A label can also carry `NO_READ_UP` (same page). Wheelhouse could label `~/.wheelhouse`, `~/.ssh` and similar folders Medium with no-read-up, and low processes then couldn't read them, while the director's own tools, at medium, still could [inference]. The `icacls` docs show a `Level:policy` form but don't document the read flag, so this likely needs a Win32 call (3.8) **[not confirmed]**.
- **Network.** Chromium's design notes say "Low integrity tokens can also access 'TCP/IP Sockets'" ([Chromium sandbox design](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md)).
- **Anything labelled Low**, including the worktree's `.git/hooks` and `.claude/`. Those should be set back to Medium so a build can't plant a hook that later runs at medium [inference].
- **Escape through medium-level brokers** (COM servers, the task scheduler) **[not confirmed]**.

**What breaks** [inference]. Tools that write to medium folders, such as the npm cache in `%LOCALAPPDATA%`, need it redirected (`npm_config_cache`) to a Low-labelled folder.

**Cost and speed.** Free. No measurable start-up cost [inference].

**Locked-down computer.** Works without admin. Two policies could block it **[not confirmed]**: AppLocker or App Control may refuse a `node.exe` copied into a user folder (the default AppLocker rules allow only Windows and Program Files), and a policy may stop label changes.

### 3.2 AppContainer and Less Privileged AppContainer (LPAC)

**What it is.** AppContainers "are isolated from accessing processes and windows belonging to other applications as well as from devices, files/directories, registry keys, the network, and credentials". Access needs both the user SIDs and the container's SIDs to allow it, so "AppContainers must be explicitly granted access to a given resource". "Without the *network* capability, an AppContainer cannot access the network." LPAC goes further: it "cannot open any keys in the registry unless it has the *registryRead* capability" ([Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)).

**Standard user.**
- `CreateAppContainerProfile` "creates a profile for the current user". Its documented failure is "The caller doesn't have permission". No admin requirement is stated ([CreateAppContainerProfile](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createappcontainerprofile)).
- Chromium runs AppContainer sandboxes, and "the user does not need to be an administrator" ([Chromium sandbox design](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md)).
- Granting the worktree, Node's install folder and the npm cache means adding ACEs for the container's SID. A user can do that on folders they own; `Program Files` already allows `ALL APPLICATION PACKAGES` to read [inference].

**Node inside an AppContainer: the blocker.** Microsoft's MXC documentation says common tools, naming "`cmd.exe`, `powershell.exe`, `pwsh.exe`, `node.exe`", fail at start-up inside an AppContainer:
- They query the drive root, and AppContainer SIDs "are not granted any rights on the system-drive root by default".
- Processes that open `NUL` fail because `\Device\Null`'s security "resets ... at every boot" to a default that excludes AppContainers.
- MXC's fix is `wxc-host-prep.exe`, which has "`requireAdministrator` baked into its embedded application manifest", and the `\Device\Null` step must run "once per boot from an elevated context" ([MXC host-prep](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/host-prep.md)).

So a plain AppContainer can't run Node build commands without admin help.

**Network.** Capabilities are all or nothing: `internetClient` opens the internet, `privateNetworkClientServer` opens the local network both ways. There is no per-host list. An allow list needs a local proxy, which AppContainer loopback isolation blocks unless an exemption is set ([MXC networking](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/networking.md)). Whether `CheckNetIsolation LoopbackExempt` needs admin is **[not confirmed]**.

**Starting one from Node with no dependencies.** It needs `CreateProcess` with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`. No stock Windows command launches an arbitrary program in an AppContainer **[not confirmed; none found]**. See 3.8 for the two ways to make the call.

**Verdict.** Strong on reads, writes and network, but not usable for Node without admin preparation.

### 3.3 Restricted tokens

**What it is.** `CreateRestrictedToken` can make SIDs "deny-only", remove privileges, and add "restricting SIDs": "Access is granted only if both access checks allow the requested access rights" ([Restricted Tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)). With `WRITE_RESTRICTED`, the restricting SIDs "are considered only when evaluating write access" ([CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)).

**Standard user.** "If a process calls CreateProcessAsUser using a restricted version of its own token, the calling process does not need to have the SE_ASSIGNPRIMARYTOKEN_NAME privilege" (same page). Microsoft's own warning: "Applications that use restricted tokens should run the restricted application on desktops other than the default desktop."

**Prior art.**
- **Codex's unelevated mode** builds a token with `DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED`. Its restricting SIDs are random capability SIDs, the logon SID and Everyone. It then grants those capability SIDs write access on the workspace ([token.rs](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/token.rs); [cap.rs](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/cap.rs)). OpenAI's docs say this mode "runs commands under a restricted token derived from your user account, with ACL-based filesystem boundaries". It uses "environment-level offline controls" for the network, "so network isolation is weaker", and it "doesn't support denied reads" ([Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)).
- **Chromium's renderer** uses the strictest form. All SIDs are deny-only, the restricting SID is the null SID, and it runs at Untrusted integrity ([Chromium sandbox design](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md)). It can do almost nothing without a broker.

**Protects against.**
- Writes (write-restricted form).
- Reads only with a fully restricted token. That would need the worktree, toolchain and caches granted to a custom SID, and would likely break Node and npm. Codex chose not to [inference] **[not confirmed that it can work]**.

**Doesn't protect against.** The network. Chromium notes that network access is checked only for AppContainer (Low Box) tokens.

**Needs** a Win32 call (3.8).

### 3.4 Job objects

A job object manages "groups of processes ... as a unit". It can enforce "working set size and process priority or terminating all processes associated with a job", and kill all of them when the last handle closes ([Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)). The page describes no file or network isolation.

Gemini CLI's "network off" for Windows is a job-object bandwidth limit of 1. It warns "Network might not be throttled" if that call fails ([GeminiSandbox.cs](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/sandbox/windows/GeminiSandbox.cs)). That is a throttle, not a block [inference].

**Use for Wheelhouse:** cleanup (kill the whole build tree on timeout). It protects nothing.

### 3.5 A separate standard user account — needs IT or admin

Anthropic's runtime and Codex's elevated mode both create a dedicated account, and both need an elevated setup to do it. Anthropic's: "self-elevates; one UAC prompt" ([sandbox-runtime README](https://github.com/anthropics/sandbox-runtime)). Codex's: "administrator-approved setup" ([Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)).

Starting a process as another account (`CreateProcessWithLogonW`, `runas`) needs that account's password. Anthropic's runtime keeps a random one encrypted in `HKLM` (README). The network fence in both tools is a WFP filter, installed as admin.

**Verdict:** not possible for a standard user.

### 3.6 Node.js's permission model

- **Status.** Stable since v23.5.0 and v22.13.0 ([permissions](https://nodejs.org/api/permissions.html)).
- **Flags.** `--permission` with `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi` and `--allow-ffi`. `--allow-net` was "Added in: v25.0.0", Stability 1.1 ([CLI](https://nodejs.org/api/cli.html)).
- **Not a boundary.** Node says so itself: "It does not provide security guarantees in the presence of malicious code." Also:
  - "Using existing file descriptors via the `node:fs` module bypasses the Permission Model."
  - "Symbolic links will be followed even to locations outside of the set of paths that access has been granted to." ([permissions](https://nodejs.org/api/permissions.html))
- **Child processes.** Without `--allow-child-process` nothing can be spawned. With it, the flags reach child *Node* processes "via the `NODE_OPTIONS` environment variable" ([CLI](https://nodejs.org/api/cli.html)). Nothing limits a non-Node child such as `cmd.exe`, `git.exe` or a native build tool. A child can also clear `NODE_OPTIONS` [inference].
- **`npm test` under it.** `npm test` runs a shell and child processes, so it either fails without `--allow-child-process` or escapes with it [inference].

**Verdict:** useful as a seat-belt for Wheelhouse's own scripts, not for build commands.

### 3.7 A throwaway copy of the worktree

Running the command against a copy protects the real worktree from damage. It does nothing about reading secrets or the network, and nothing about writes outside the copy [inference]. Wheelhouse's worktrees already give most of that benefit.

### 3.8 Making Win32 calls from Node with no dependencies

Restricted tokens, AppContainers, job objects and "no read up" labels all need Win32 API calls. Wheelhouse has no npm dependencies. Two stock ways exist:

- **PowerShell `Add-Type`** compiles C# that calls Win32 functions.
  - Windows PowerShell 5.1 ships with Windows.
  - Under AppLocker or App Control, "PowerShell automatically runs in `ConstrainedLanguage` mode". There, "The `Add-Type` cmdlet can load signed assemblies, but it can't load arbitrary C# code or Win32 APIs" ([about_Language_Modes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes)).
  - So it is likely to fail on exactly the locked-down work computers this is for [inference].
- **Node's built-in `node:ffi`.**
  - "Added in: v26.1.0", "Stability: 1 - Experimental".
  - It is "only available ... in builds with FFI support" and "can be disabled with the `--no-experimental-ffi` flag". Under the permission model it needs `--allow-ffi` ([node:ffi](https://nodejs.org/api/ffi.html)).
  - Node 26 is the Current line. The newest LTS on 19 October 2026 is v24.22.0 ([Node releases](https://nodejs.org/dist/index.json)).
  - Whether official Windows builds include it is **[not confirmed]**. It couldn't be tested here.
  - It would let Wheelhouse call `CreateRestrictedToken`, `CreateProcessAsUserW`, job-object functions and `SetNamedSecurityInfoW` with no package [inference].

The low-integrity route in 3.1 needs neither, except for the optional no-read-up labels.

---

## 4. Microsoft's newer offerings

### 4.1 Microsoft Execution Containers (MXC) — no admin, but needs Microsoft's SDK

- **Status.** Generally available. Microsoft's post of 7 October 2026 calls MXC the "containment layer" and says it is "now generally available" ([Windows blog](https://blogs.windows.com/windows/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)).
- **Who uses it.** Tools that already support it: "GitHub Copilot, OpenClaw, OpenAI Codex, Replit, LM Studio, and Unsloth AI". Tools that "will be releasing support": "Anthropic Claude Code", among others. Intune policy for process containers is "coming soon".
- **Backends.** Windows 11 x64 and ARM64, default backend `processcontainer`. Windows Sandbox, MicroVM and Hyperlight are experimental ([MXC README](https://github.com/microsoft/mxc)). The process container "resolves to AppContainer (legacy) or BaseContainer (newer OS sandbox API)" ([schema](https://github.com/microsoft/mxc/blob/main/docs/schema.md)).
- **Windows version.** The BaseContainer path needs Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278 (August 2026 update) or later ([OS support](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/os-version-support.md)).
- **No admin.**
  - The WFP filters are "applied with no UAC prompt per launch" ([networking](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/networking.md)).
  - Codex's MXC backend "never invokes MXC's AppContainer dispatcher, edits host ACLs, creates sandbox users, runs setup, or requests elevation" ([Codex mxc-sandbox](https://github.com/openai/codex/blob/main/codex-rs/mxc-sandbox/README.md)).
  - OpenAI's docs: "native process isolation without administrator-approved setup, additional Windows accounts, or local firewall rules" ([Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)).
  - The AppContainer fallback on older builds needs the admin host preparation in 3.2.
- **Protects.** File access is an allow list (`readwritePaths`, `readonlyPaths`, `deniedPaths`) ([schema](https://github.com/microsoft/mxc/blob/main/docs/schema.md)). The network blocks direct traffic, and "Proxy-only egress (recommended)" points the container at a local proxy that can enforce a host allow list ([networking](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/networking.md)). Codex pairs it with its own proxy: "Proxy domain rules still apply to proxied traffic; direct DNS remains denied."
- **The catch for Wheelhouse.**
  - The Node SDK `@microsoft/mxc-sdk` (1.0.1, 17 October 2026, MIT) depends on `koffi` and `node-pty` (npm registry). Alternatively the `wxc-exec.exe` binary ships with the SDK. Neither is part of Windows.
  - The underlying Windows API has no public documentation on Microsoft Learn that I could find **[not confirmed]**.
  - Codex notes host loopback is "bidirectional" under MXC, so a build command can reach local servers.

### 4.2 Windows Sandbox — needs IT or admin

- **What it is.** A "disposable virtual machine". It "Takes a few seconds to launch". It is available on Pro, Enterprise and Education, and "not supported on Windows Home edition". "Windows Sandbox enables network connection by default" (can be disabled). It "currently doesn't allow multiple instances to run simultaneously" ([overview](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview)).
- **Admin.** Turning it on needs BIOS virtualisation and enabling the optional feature, "open PowerShell as Administrator" ([install](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)).
- **CLI.** Windows 11 24H2 has a `wsb` command line (`start`, `exec`, `share` with `--allow-write`, `stop`). But "there is no way to retrieve the output of a command run in Sandbox" ([CLI](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli)).
- **Verdict.** Strong on all three threats, but it needs admin, only one sandbox can run at a time, nothing is installed inside it, and command output can't be read. Not workable for build commands [inference].

### 4.3 Windows "agent workspace" — needs IT or admin, preview

- **What it is.** "Each agent operates using its own account" in a separate Windows session. "This setting can only be enabled by an administrative user of the device." It is in preview for Windows Insiders and covers Copilot Actions and registered agent connectors ([experimental agentic features](https://support.microsoft.com/en-us/windows/ai/ai-features/experimental-agentic-features), last updated 5 December 2025).
- **Third-party command-line agents** aren't mentioned.

---

## 5. WSL2 with Claude Code's Linux sandbox — needs IT or admin

- **Supported.** "The sandbox runs on macOS, Linux, and WSL2." WSL1 shows "Sandboxing requires WSL2". It needs `bubblewrap` and `socat`, installed with `sudo apt-get` inside the distribution, plus an AppArmor profile on Ubuntu 24.04 if `kernel.apparmor_restrict_unprivileged_userns` is 1 ([sandboxing](https://code.claude.com/docs/en/sandboxing)).
- **Admin.** "Open PowerShell in **administrator** mode ... enter the wsl --install command, then restart" ([install](https://learn.microsoft.com/en-us/windows/wsl/install)). WSL2 needs the Virtual Machine Platform feature, enabled as Administrator, plus virtualisation support ([manual install](https://learn.microsoft.com/en-us/windows/wsl/install-manual)).
- **Enterprise policy.** Intune and Group Policy can turn WSL off: "Allow the Windows Subsystem For Linux ... disables access ... for all users on the machine" ([WSL Intune settings](https://learn.microsoft.com/en-us/windows/wsl/intune)). Claude Desktop "turns off WSL sessions by default on devices it detects as organization-managed". Turning them back on needs an `HKLM` policy, "which requires administrator privileges to write" ([admin setup](https://code.claude.com/docs/en/admin-setup)).
- **Claude Desktop runs whole sessions in WSL.** "The session's Claude Code process, its tools, and git all execute inside the distribution" ([Desktop in WSL](https://code.claude.com/docs/en/desktop-wsl)). But "Plugins aren't available in WSL sessions" ([Desktop](https://code.claude.com/docs/en/desktop)), and connectors and the integrated terminal aren't either. **Wheelhouse, a plugin, can't run in a Desktop WSL session today.** The alternatives would be:
  - a Windows session whose build commands go through `wsl.exe`, for example by a `PreToolUse` hook that rewrites the command with `updatedInput` ([hooks](https://code.claude.com/docs/en/hooks)) [inference];
  - an SSH session into the distribution, since SSH sessions support plugins ([Desktop](https://code.claude.com/docs/en/desktop)) **[not confirmed for WSL]**.
- **Gaps to close.**
  - **Windows files are readable from inside.** Sandboxed commands read "Most of the machine" by default, and the Windows drive is mounted at `/mnt/c` ([WSL config](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)), so `/mnt/c/Users/<you>/.ssh` and `~/.wheelhouse` on the Windows side are readable unless denied [inference]. `denyRead` on `/mnt/c` (or turning off automount) is needed.
  - **Interop is an escape.** "WSL hands a launch of a Windows binary ... to the Windows host over a Unix socket", and "the optional seccomp filter has to be installed to block the socket" (`npm install -g @anthropic-ai/sandbox-runtime`) ([sandboxing](https://code.claude.com/docs/en/sandboxing)). Without it, a sandboxed command can start `cmd.exe` on Windows outside every limit [inference]. `[interop] enabled=false` in `/etc/wsl.conf` "will block the launch of Windows processes" ([WSL config](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)). It needs `sudo` inside the distribution, not Windows admin.
- **Speed.** "For the fastest performance speed, store your files in the WSL file system" ([across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems)). Cross-OS file performance is worse in WSL2 than WSL1 ([compare versions](https://learn.microsoft.com/en-us/windows/wsl/compare-versions)). Native `node_modules` built on one side won't run on the other [inference].
- **Cost.** Free.

---

## 6. Containers — needs IT or admin

- **Docker Desktop.**
  - A per-user install "does not require administrator privileges". But it needs the WSL 2 backend or the "Hyper-V and Containers Windows features" ([Docker install](https://docs.docker.com/desktop/setup/install/windows-install/)), and those need admin (section 5).
  - A paid subscription is required for companies with "more than 250 employees OR more than $10 million USD in annual revenue".
- **Podman Desktop.** Per-user install needs no admin. Podman itself needs "administrator privileges" to enable WSL or Hyper-V ([Podman Desktop](https://podman-desktop.io/docs/installation/windows-install)). No licence cost stated.
- **Anthropic's reference dev container.**
  - `init-firewall.sh` "limits outbound traffic to the destinations the script allows". With it, `--dangerously-skip-permissions` is supported.
  - Anthropic's warning: dev containers "do not prevent a malicious project from exfiltrating anything accessible inside the container, including the Claude Code credentials". Also: "Avoid mounting host secrets such as `~/.ssh`" ([dev container](https://code.claude.com/docs/en/devcontainer)).
  - It isolates the whole Claude Code process. The director would work through VS Code, not Claude Desktop.
  - The format is the [containers.dev](https://containers.dev/) specification.
- **Docker Sandboxes.**
  - A microVM per agent. "Outside the workspace and shared skills store, the agent cannot access your host filesystem." Outbound traffic is "governed by a deny-by-default policy", though "The default allowed domains include broad wildcards" ([security](https://docs.docker.com/ai/sandboxes/security)).
  - On Windows it needs Windows 11 and the "Windows Hypervisor Platform", enabled from "an elevated PowerShell prompt". It needs no Docker Desktop ([install](https://docs.docker.com/ai/sandboxes/install/)). "The `sbx` CLI and local sandbox compute are free" ([overview](https://docs.docker.com/ai/sandboxes/)).

---

## 7. What other agent tools do on Windows

| Tool | Windows approach | Admin | Protects reads | Source |
|---|---|---|---|---|
| OpenAI Codex | MXC where available (recommended). Else an elevated mode (sandbox users, firewall rules). Else an unelevated mode (write-restricted token, ACLs, environment-level offline) | MXC: none. Elevated: admin setup. Unelevated: none | MXC and elevated: deny-read paths. Unelevated: no | [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox) |
| Gemini CLI | Native: restricted token, job object, Low integrity via `icacls`, and a list of secret files denied. Or Docker or Podman | None for native | Partly (scans for secret files to depth 3) | [sandbox.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md); [WindowsSandboxManager.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/sandbox/windows/WindowsSandboxManager.ts) |
| Cursor | "On Windows, we run our Linux sandbox inside WSL2" | WSL2 needs admin | Inside WSL2 | [Cursor blog, 18 February 2026](https://cursor.com/en-US/blog/agent-sandboxing) |
| VS Code agent (Copilot) | Windows marked "Experimental"; needs the 8 September 2026 security update (KB5124008). Mechanism not named; possibly the same new Windows feature as MXC **[not confirmed]**. Off by default; network not blocked by default | Not stated | "Git and GitHub CLI credentials are available to sandboxed processes by default" | [VS Code agent sandboxing](https://code.visualstudio.com/docs/agents/run/agent-sandboxing) |
| Claude Code | None on native Windows; WSL2 or containers | n/a | n/a | [sandboxing](https://code.claude.com/docs/en/sandboxing) |

Cline and others were not researched.

**Pattern** [inference]:
- Every tool that sandboxes natively on Windows without admin protects writes well and reads poorly. Codex's unelevated mode and Gemini both fall here.
- The tools that protect reads and network use either admin setup (separate user, WFP) or the new Windows 11 feature (MXC).

---

## 8. Recommendation for Wheelhouse [inference]

### 8.1 The recommended route on stock Windows: a low-integrity build runner

Wheelhouse adds a Windows build runner, in Node with no dependencies:

1. At setup, copy `node.exe` into a Wheelhouse folder and label the copy Low (`icacls ... /setintegritylevel L`).
2. For each worktree, label the worktree Low with inheritance. Set its `.git/hooks`, `.git/config`, `.claude/`, `.mcp.json` and `.vscode/` back to Medium, mirroring the paths Claude Code's sandbox protects ([sandboxing](https://code.claude.com/docs/en/sandboxing)).
3. Point npm's cache and `TEMP` at Low folders inside or beside the worktree.
4. Run build commands through the Low `node.exe`, so the command and everything it starts runs at Low. Route them with a `PreToolUse` hook that rewrites the command (`updatedInput`) and allows it ([hooks](https://code.claude.com/docs/en/hooks)). Add a job object for timeouts if `node:ffi` is available.
5. Where a Win32 call is available (`node:ffi` on Node 26, or FullLanguage PowerShell), label `~/.wheelhouse`, `~/.ssh` and the git credential files Medium with no-read-up.

**What it protects:**
- writes to Wheelhouse's own plugin, hooks and settings;
- writes to `~/.claude`, startup folders and `HKCU`;
- writes to anything else outside the worktree that isn't labelled Low;
- with step 5, reads of the folders it labels.

**What remains:**
- **The network is open.** A malicious dependency can send out the project source, environment variables and any unlabelled file it can read.
- **Reads of secrets Wheelhouse doesn't know to label**, such as browser data, other tools' tokens and Windows Credential Manager. Whether Credential Manager is reachable from Low is **[not confirmed]**.
- **Possible escapes** through medium-level brokers **[not confirmed]**.

**So run unattended only:**
- tests, lint, type checks, build scripts, `node` scripts already in the project, and local `git` (status, diff, add, commit, branch).

**Keep asking the director (or the dangerous switch) for:**
- anything that fetches and runs new third-party code: `npm install`, `npm ci`, `npx` of a package not in the lockfile;
- anything that pushes. The host helper does pushing already;
- anything that must write outside the worktree.

**Pick the cheaper write guard if `node:ffi` is confirmed.** A Codex-style write-restricted token protects the same things and doesn't need a copied `node.exe`.

### 8.2 What remains for the dangerous switch

- Unattended `npm install` and `npx` on Windows without IT help. No stock route limits the network, so a malicious install script could send out anything it can read.
- Commands that need to write outside the worktree.
- Anything on a Windows computer where the checks below fail.

### 8.3 Where IT will help, in order

1. **MXC**, on Windows 11 24H2 or 25H2 with the August 2026 update or later. No admin. It needs Microsoft's SDK installed (outside Wheelhouse's no-dependency rule) or Claude Code's own support when it ships. It gives reads, writes and a proxy allow list. Re-check Claude Code's changelog for MXC support each month.
2. **Anthropic's sandbox runtime, Windows alpha**. One admin step. It has the `Authenticated Users` gap on other drives (#402).
3. **WSL2 with Claude Code's sandbox**, build commands sent through `wsl.exe` from a Windows session (plugins don't load in Desktop WSL sessions). Needs `denyRead` on `/mnt/c`, the seccomp filter or interop off, and the project on the Linux file system for speed.
4. **Containers or Windows Sandbox.** Heavier, and they need IT. Not a fit for a director who works in Claude Desktop.

### 8.4 Checks to run on a real Windows computer before relying on it

Run as a standard user on a work-managed Windows 11 computer and on a personal one:

1. Copy `node.exe` to a folder under the user profile, label it Low with `icacls`, and run `whoami /groups` from a child it spawns. Confirm "Low Mandatory Level". Note whether AppLocker or App Control refuses to start the copy.
2. Label a worktree Low (`(OI)(CI)`), set `.git/hooks`, `.git/config` and `.claude/` back to Medium, and run `npm test`, a `node` script, `git add` and `git commit` through the Low `node.exe`. Note what fails and how long each takes compared with a normal run.
3. From the Low process, try to write to `~/.claude/settings.json`, Wheelhouse's plugin folder, the Startup folder, `HKCU\...\Run`, `.git/hooks/pre-commit` and a folder on a second drive. Each should fail.
4. From the Low process, try to read `~/.ssh`, `~/.wheelhouse`, a browser profile file and `git credential fill` output. Record what succeeds.
5. Set a no-read-up label on a test folder: first with `node:ffi` and `SetNamedSecurityInfoW` (Node 26), then with PowerShell `Set-Acl` or `Add-Type`. Confirm the Low process can't read it and the director's own tools still can.
6. Run `$ExecutionContext.SessionState.LanguageMode` in PowerShell, `node --version`, and `node -e "require('node:ffi')"`. Record which Win32-call route is open.
7. From the Low process, try to start a medium process (`schtasks /create`, `explorer.exe <file>`, `start` through the shell) and check its integrity level.
8. Run `winver`, and check whether the build is at or above 26100.9278 or 26200.9278 (MXC available without admin).
9. In Claude Desktop on Windows, check Settings → Claude Code for a "Local sandbox" row. Run `touch ~/sandbox-probe` (the docs' own test) in a local session and see whether it is blocked. This settles the conflicting reports in 2.1.
10. If WSL2 is present: check `wsl -l -v`, whether Desktop offers WSL sessions on the managed computer, and whether a sandboxed command inside can read `/mnt/c/Users/<you>/.ssh` or start `cmd.exe`.

---

## Sources

All read on 19 October 2026.

**Anthropic**
- Claude Code docs: [Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing); [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments); [Development containers](https://code.claude.com/docs/en/devcontainer); [Desktop application](https://code.claude.com/docs/en/desktop); [Claude Code Desktop in WSL](https://code.claude.com/docs/en/desktop-wsl); [Admin setup](https://code.claude.com/docs/en/admin-setup); [Hooks](https://code.claude.com/docs/en/hooks); [Settings reference](https://code.claude.com/docs/en/settings-reference)
- Claude Code [CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) (to 2.1.302); issues [#69495](https://github.com/anthropics/claude-code/issues/69495), [#77508](https://github.com/anthropics/claude-code/issues/77508), [#79300](https://github.com/anthropics/claude-code/issues/79300), [#96324](https://github.com/anthropics/claude-code/issues/96324), [#103098](https://github.com/anthropics/claude-code/issues/103098)
- [anthropics/sandbox-runtime README](https://github.com/anthropics/sandbox-runtime) (v0.0.80); issues [#105](https://github.com/anthropics/sandbox-runtime/issues/105), [#396](https://github.com/anthropics/sandbox-runtime/issues/396), [#402](https://github.com/anthropics/sandbox-runtime/issues/402), [#451](https://github.com/anthropics/sandbox-runtime/issues/451), [#457](https://github.com/anthropics/sandbox-runtime/issues/457), [#559](https://github.com/anthropics/sandbox-runtime/issues/559)
- Reference dev container: [.devcontainer](https://github.com/anthropics/claude-code/tree/main/.devcontainer)

**Microsoft**
- Win32: [Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control); [SECURITY_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-information); [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation); [Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer); [CreateAppContainerProfile](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createappcontainerprofile); [Restricted Tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens); [CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken); [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- Windows commands: [icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)
- PowerShell: [about_Language_Modes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes)
- WSL: [Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install); [Manual install](https://learn.microsoft.com/en-us/windows/wsl/install-manual); [Intune settings](https://learn.microsoft.com/en-us/windows/wsl/intune); [Advanced settings configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config); [Working across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems); [Comparing WSL versions](https://learn.microsoft.com/en-us/windows/wsl/compare-versions)
- Windows Sandbox: [overview](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview); [install](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install); [command line](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli)
- [Microsoft Execution Containers: policy-driven containment for AI agents](https://blogs.windows.com/windows/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/) (Windows blog, 7 October 2026)
- [microsoft/mxc](https://github.com/microsoft/mxc): README; [host-prep](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/host-prep.md); [networking](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/networking.md); [OS version support](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/os-version-support.md); [schema](https://github.com/microsoft/mxc/blob/main/docs/schema.md); npm package `@microsoft/mxc-sdk` 1.0.1
- [Experimental agentic features](https://support.microsoft.com/en-us/windows/ai/ai-features/experimental-agentic-features) (Microsoft Support)
- [VS Code: Sandbox agent terminal commands](https://code.visualstudio.com/docs/agents/run/agent-sandboxing)

**Node.js**
- [Permissions](https://nodejs.org/api/permissions.html) (v26.12.0 docs); [Command-line options](https://nodejs.org/api/cli.html); [node:ffi](https://nodejs.org/api/ffi.html); [release index](https://nodejs.org/dist/index.json)

**Other agent tools**
- OpenAI Codex: [Windows sandbox docs](https://learn.chatgpt.com/docs/windows/windows-sandbox); source [mxc-sandbox README](https://github.com/openai/codex/blob/main/codex-rs/mxc-sandbox/README.md), [token.rs](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/token.rs), [cap.rs](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/cap.rs)
- Gemini CLI: [sandbox.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md); [WindowsSandboxManager.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/sandbox/windows/WindowsSandboxManager.ts); [GeminiSandbox.cs](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/sandbox/windows/GeminiSandbox.cs)
- Cursor: [Agent sandboxing](https://cursor.com/en-US/blog/agent-sandboxing) (18 February 2026)
- Chromium: [Sandbox design](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md)

**Containers**
- Docker: [Install Docker Desktop on Windows](https://docs.docker.com/desktop/setup/install/windows-install/); [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/), [install](https://docs.docker.com/ai/sandboxes/install/), [security](https://docs.docker.com/ai/sandboxes/security)
- [Podman Desktop on Windows](https://podman-desktop.io/docs/installation/windows-install)
- [Development Containers specification](https://containers.dev/)
