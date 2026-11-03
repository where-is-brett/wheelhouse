<!-- probes/94-host-access/run.md -->

# Check 94: host access on the Windows work laptop, for the director's sitting

What this finds out: whether Wheelhouse's `curl` transport (`scripts/host/curl.js`) and its proxy reading (`scripts/host/proxy.js`) work on the director's Windows work laptop, which has a company GitLab behind an NTLM proxy and a company certificate authority in the computer's own store. The design is `docs/specs/2026-11-03-host-access-design.md` (sections 9.1 to 9.3 and 16). The five things it confirms are the design's "untried live" list.

Every step an agent can do is a command below. Only a password, a sign-in the director must type, and clicks in a window are the director's. The key used is the director's own, borrowed from the computer's store for these steps only; it is never typed into a command line, a file or a chat, and never put in an environment variable.

**Use the company GitLab only if the director has said yes in chat for this sitting.** The memory note on the work laptop says the throwaway GitLab project is the exception for the earlier sittings; real use of the company GitLab waits for the director's own yes. Write `gitlab.example.org` below as whatever address the director gives.

**Notes** go in `%TEMP%\wheelhouse-check94\notes.md`, appended as each result is made. Nothing is written in the repository.

## Before the sitting

1. Find the tools by full path, and write each answer in the notes:
   - `where git` and `git --version`;
   - `%SystemRoot%\System32\curl.exe --version` (it must say `Schannel` and list `NTLM` and `SSPI`);
   - `node --version` (22 or later).
2. Read the director's proxy settings, as Wheelhouse will:
   - `git config --get-urlmatch http.proxy https://gitlab.example.org`
   - `git config --get-urlmatch http.proxyAuthMethod https://gitlab.example.org`
   - `echo %HTTPS_PROXY% %ALL_PROXY% %NO_PROXY%`

   A proxy address with a password in it is the finding "refused, and said so", not something to copy anywhere. Record whether the address names a user; record the method.
3. Run the unit tests this check stands on: `node --test tests/scripts/host/curl.test.js tests/scripts/host/proxy.test.js tests/scripts/host/company-ca.test.js`. All pass before the sitting starts.

## Part 1: a read through `curl.exe` and the proxy, with no certificate file

The point: `curl.exe` uses Schannel, so it trusts the company authority in the computer's own store without any file of Wheelhouse's.

1. Make sure `%USERPROFILE%\.wheelhouse\ca\company.pem` does not exist (if it does, move it aside and say so in the notes).
2. Run this from the repository, which asks `readProxy` what the director's git says and then makes one anonymous read of `/api/v4/version`:

   ```
   node --input-type=module -e "import {request, curlPath} from './scripts/host/curl.js'; import {readProxy} from './scripts/host/proxy.js'; import {run} from './scripts/lib/run.js'; const url='https://gitlab.example.org/api/v4/version'; const proxy=await readProxy({address:url, run}); console.log(JSON.stringify({curl:curlPath(), proxy:proxy&&{auth:proxy.auth,user:proxy.user,source:proxy.source}})); try { const got=await request({run, curl:curlPath(), url, proxy}); console.log(got.status, got.connect); } catch (e) { console.log(e.code, e.message); }"
   ```
3. Expected: a status of 200 or 401 (GitLab answers; a key is not needed to answer 401), and `connect` of 200 through the proxy. Record the status, `connect`, and the proxy line printed.
4. What each other answer means:
   - `PROXY_REFUSED`: the proxy answered 407. Record whether the proxy wants a typed password or refuses the Windows sign-in; Wheelhouse does not support a typed password for `curl`.
   - `CERTIFICATE_NOT_TRUSTED`: Schannel does not trust the company authority. Open `certlm.msc`, look in Trusted Root Certification Authorities for the company's authority, and record whether it is there. If it is not, this is the finding; ask the director who looks after the laptops.
   - `HOST_UNREACHABLE`: off the company network, or the proxy settings were not read. Record the printed proxy line.

## Part 2: a blocked revocation check

Only if Part 1 gave `CERTIFICATE_NOT_TRUSTED` or a message about revocation. Run it again and record whether the second attempt (made inside `request` with `--ssl-revoke-best-effort`) succeeds. To see which attempt worked, compare with `%SystemRoot%\System32\curl.exe -sS -o NUL -w "%{http_code}" https://gitlab.example.org/api/v4/version` and with `--ssl-revoke-best-effort` added. Record all three exit codes. Never use `-k` or `--insecure`, not even to look.

## Part 3: a merge through `curl.exe` and the proxy

Only on the throwaway project, and only with the director's yes for this sitting.

1. The director has a merge request in the throwaway project that is ready to merge, and tells the agent its number `N` and the project's id `P`.
2. The agent borrows the key through git's credential interface (Part 4 shows the form) and passes it to the transport on standard input through the request's `headers`, never in a command line. The script reads the key from `git credential fill` inside the same process:

   ```
   node --input-type=module -e "import {request, curlPath, MERGE_SECONDS} from './scripts/host/curl.js'; import {readProxy} from './scripts/host/proxy.js'; import {run} from './scripts/lib/run.js'; const base='https://gitlab.example.org'; const proxy=await readProxy({address:base, run}); const filled=await run('git',['credential','fill'],{input:'protocol=https\nhost=gitlab.example.org\n\n',env:{GCM_INTERACTIVE:'never'},timeoutMs:20000}); const key=/^password=(.*)$/m.exec(filled.stdout)?.[1]; if(!key){console.log('no key');process.exit(0)} const head=await request({run,curl:curlPath(),url:base+'/api/v4/projects/P/merge_requests/N',headers:{'PRIVATE-TOKEN':key},proxy}); console.log('read',head.status); const sha=JSON.parse(head.body).sha; const merged=await request({run,curl:curlPath(),url:base+'/api/v4/projects/P/merge_requests/N/merge',method:'PUT',headers:{'PRIVATE-TOKEN':key,'Content-Type':'application/json'},body:JSON.stringify({sha}),proxy,maxSeconds:MERGE_SECONDS}); console.log('merge',merged.status)"
   ```

   Replace `P` and `N` first. The script prints statuses only, never the key or the body.
3. Expected: `read 200`, then `merge 200`. Record both. A `merge 405`, `406`, `409` or `422` is GitLab's refusal read by status, which is a good result for this check: it shows the PUT went through the proxy.

## Part 4: `git credential fill` with Git Credential Manager

The point: whether the key can be borrowed with no window opening.

1. Run, from a command prompt (not through the script above):

   ```
   set GCM_INTERACTIVE=never
   printf "protocol=https\nhost=gitlab.example.org\n\n" | git credential fill
   ```

   On Windows without `printf`, use `(echo protocol=https& echo host=gitlab.example.org& echo.) | git credential fill`.
2. Expected: lines `protocol=`, `host=`, `username=` and `password=` come back with no window and no prompt. Do not copy the output anywhere: record only which keys were present (`username`, `password`) and whether any window opened.
3. If git says it could not prompt, or a window opened, record which: the design then asks for a key card instead of borrowing, and says what to do. Close any window without typing in it.
4. Clear the variable: `set GCM_INTERACTIVE=`.

## Afterwards

- Write the notes into `docs/checks/94-host-access.md` as the director's check record: each of the five things (SSPI through the NTLM proxy; Schannel trusting the company authority; the revocation retry; a merge through the proxy; `git credential fill` with `GCM_INTERACTIVE=never`) as confirmed, refused or not reached, with what was seen.
- Remove `%TEMP%\wheelhouse-check94` once the record is written.
