<!-- docs/checks/34-screens.md -->

# Check 34: screenshots from a hidden browser

**Answer:** Partly — on macOS (Apple silicon) the installed Chrome photographs a page headless, with no install, in about half a second to two seconds including the five-second settle (which it fast-forwards), and two pictures of the same still page always had the same pixels: in every run, at both sizes, across runs and in Edge too. A page drawn late by its script was photographed drawn. But neither Chrome nor Edge quits on macOS after taking its picture, so `shoot` as first written timed out on every page; it now stops Chrome as soon as its picture file holds a whole PNG. Edge photographs its own error page when a page fails to load and says nothing, so for now only Chrome's pictures count: with only Edge, no approval carries over until the Windows run shows how Edge reports a failed load. Windows waits for the Windows sitting.

## Question

Whether the helper can photograph a web page with an installed Chrome or Edge, headless, with no npm install, on macOS and Windows; whether two photographs of the same unchanged page give the same pixels; and how long one takes.

## Tested on

macOS 27.0.1 on Apple silicon (arm64), Node.js 22.22.1, 19 October 2026. Google Chrome 154.0.8037.98 and Microsoft Edge 152.0.4191.53, both from `/Applications` (Edge updated itself from 144.0.3719.82 during the day; the runs recorded here used 152). Chrome: five full runs: one with `shoot`'s first code, two with an earlier form of the change (which stopped every browser at its picture, the same as now for Chrome), and two with the probe exactly as committed. Edge: one run with that earlier form, and two with the probe as committed. Windows was not used.

Every run used a fresh profile folder per picture, under a new folder in the temporary folder, removed at the end (`scratchRemoved: true`). The browser opened only the probe's own pages, served by Node on 127.0.0.1.

## Method

**Documentation**, read on 19 October 2026:

- Chrome headless mode, <https://developer.chrome.com/docs/chromium/headless> (last updated 21 October 2024): `--headless` runs Chrome with no visible window; since Chrome 112 headless mode is the same browser as the visible one, and since Chrome 132 the old headless mode exists only as the separate `chrome-headless-shell` program.
- Headless command-line reference, <https://developer.chrome.com/docs/automation-and-testing/headless-cli> (last updated 21 October 2024): `--screenshot` saves a picture of the page (to `screenshot.png`, or to the path given), "especially useful" with `--window-size`; `--virtual-time-budget` fast-forwards a page's timers so it runs as fast as possible while believing time passes; `--timeout` caps the wait before capture.
- Chrome Headless shell, <https://developer.chrome.com/blog/chrome-headless-shell>: the old headless mode, shipped separately through Chrome for Testing; not installed with Chrome or Edge, so not used here.
- The pages do not describe `--user-data-dir`, `--hide-scrollbars` or `--force-device-scale-factor`, and say nothing about whether the browser quits after `--screenshot`. The community list of switches, <https://peter.sh/experiments/chromium-command-line-switches/> (generated 19 October 2026), is too long to read in full by fetch: it was read only as far as the switches beginning with "e", so none of these switches could be checked there. What they do is taken from what the runs showed.
- Chromium's own source for the headless command handler, `components/headless/command_handler/headless_command_handler.cc` (main branch, read the same day): when the page fails to load it logs `Page load failed: <error>` and, as the runs showed, Chrome writes no picture.

**The probe.** `node probes/34-screens/run.js [--browser <path>] [--stop-at-picture]` (no installs). It finds the browser with `findBrowser` (Chrome first, then Edge), serves seven local pages, and photographs each twice at both `SCREEN_SIZES` (1280 × 800 and 390 × 844), each picture in a fresh profile. It runs the browser exactly as `shoot` runs Chrome, through `runBrowser` in `scripts/screens/shoot.js` (the flags of `browserArgs`, including `--headless=new`, `--hide-scrollbars`, `--force-device-scale-factor=1` and `--virtual-time-budget=5000`, with the browser's sandbox on), and reads each picture with `pixelHash`. It records each picture's hash, time, and how the run ended, and prints a JSON summary.

The pages: **still** (text and a coloured block), **clock** (the time, changing every second), **animation** (a block moving continuously), **late** (blank at load; a script draws the still page's content after 1.5 seconds, as a single-page app would), **lateFinal** (that content from the start, to compare with late), **failsDrop** (the server drops the connection) and **failsClosed** (a port nothing listens on). Edge, which `shoot` does not use for now, is run the same way but not stopped at its picture; `--stop-at-picture` stops it there too, to see its pictures without waiting for each run's time limit.

Unit tests with no browser: `tests/probes/34-screens/run.test.js` (the pages, the server, the summary) and, for the change to `shoot`, `tests/scripts/screens/shoot.test.js` and `tests/scripts/lib/run.test.js`.

## Evidence

**The browser does not quit.** In the first full run, with `shoot`'s first code, every one of the 28 pictures was written but every run was ended at the 30-second limit (exit code 1, `timedOut`), so `shoot` would have answered "the browser timed out" for every page. The run took 14 minutes. One still page at one size was then photographed again and again, changing one thing at a time; in every case the picture was written within about 0.5 to 6 seconds and the browser was still running 15 to 40 seconds later:

| Changed | Result |
| :- | :- |
| `--virtual-time-budget` left out | still running |
| `--headless` in place of `--headless=new` (and `--headless=old`) | still running (the same mode since Chrome 132) |
| Only `--headless`, `--user-data-dir` and `--screenshot` | still running |
| The command sandbox off | still running |
| `about:blank`, or a `data:` address, in place of the probe's server | still running |
| The server sending `Connection: close` | still running |
| No pipes (output ignored), and started from the shell rather than Node | still running |
| The same profile used twice | still running both times |
| `--use-mock-keychain`, `--disable-background-networking`, `--disable-sync`, `--timeout=3000`, `--remote-debugging-port=0` | still running |
| Edge (144, and later 152) in place of Chrome | still running |

With logging on (`--enable-logging=stderr --v=1`), Chrome reported each hold on the browser being let go after the picture (`RemoveKeepAlive(Default, kHeadlessCommand). keep_alives=[]`) and unloaded the profile, and then nothing more. A sample of the process showed its main thread idle in the macOS application loop (`-[NSApplication run]`). So the browser has finished its work and is simply staying open, as a Mac app does with no windows left; nothing in the flags, the probe's server, the sandbox or the profile causes it. When the browser itself is killed, its helper processes end within 0.2 seconds.

**The cure.** `shoot` now watches the picture file while Chrome runs and stops the browser once the file holds a whole PNG (one `pixelHash` reads in full: a part-written file fails to read and is looked at again 100 ms later). A whole picture from Chrome is the page as drawn: Chrome writes the picture only after the page has loaded and the settle has run, and writes none when the load fails. An error status that only the browser is given (a 500 body, a protection page) still gives a picture of that page; only the status `shoot` reads before the browser runs covers it. A run that ends any other way is judged as before (time-out, a non-zero exit, no picture or a picture that can't be read all answer no picture), and a run in which the browser says `Page load failed` or `Page load timed out` never gives a picture.

**The runs as committed** (time per picture, in milliseconds, for the pages that gave one):

| | Chrome, run A | Chrome, run B | Edge, stopped at picture | Edge, not stopped |
| :- | :- | :- | :- | :- |
| still matched, both sizes | yes | yes | yes | yes, but every run timed out |
| clock matched | no (both sizes) | no (both sizes) | no (both sizes) | no (both sizes) |
| animation matched | 390 × 844 only | both sizes | both sizes | both sizes |
| late shows the drawn content | yes | yes | yes | yes |
| failed loads give a picture | no | no | **yes, its error page** | **yes, its error page** |
| browser says `Page load failed` | yes, all 8 | yes, all 8 | no, none of 8 | no, none of 8 |
| fastest–slowest picture | 511–635 | 614–942 | 2 137–9 723 | every run 30 001–30 004, ended at the limit |
| whole run | 4 min 12 s | 4 min 16 s | 1 min 55 s | 14 min 3 s |

- **The still page gave the same pixels every time:** 1280 × 800 hash `cf1282ad…`, 390 × 844 hash `c5612c9d…`, in all five Chrome runs and all three Edge runs.
- **Late pages are drawn before the picture.** The late page's picture had exactly the hash of lateFinal and of still at both sizes, in every run, in both browsers: the virtual-time settle let its script run first. With the settle fast-forwarded, a late page took no longer than a still one.
- **Clock pages differ** every time, as expected: their text is the real time.
- **The animation usually matched, but not always.** Virtual time puts the moving block at the same place in most runs, but in Chrome run A the two 1280 × 800 pictures differed (the second hash, `af14c805…`, also turned up in Edge), and in an earlier Edge run (the same pages, also stopped at the picture) both sizes differed. Moving pages can't be relied on either way; a difference asks again, as designed.
- **Failed loads.** Chrome logged `Page load failed` for every failed load (in single-page trials, `net::ERR_EMPTY_RESPONSE` for the dropped connection and `net::ERR_UNSAFE_PORT` for port 9) and wrote no picture; each such run ran to the 30-second limit, so a page that fails to load costs 30 seconds per picture and gives no picture. Edge wrote a picture of its own error page ("Hmmm… can't reach this page", with the address and the error code) and logged nothing about the failure; the two error pictures of the same address matched each other, and the closed port's picture changed with the port number, since the address is on the page. Not stopped, Edge never quit: all 28 runs ended at the 30-second limit.
- **Time.** Every Chrome picture took under two seconds with the five-second settle (slowest 942 ms in the runs as committed, 1 855 ms in an earlier run), far inside `SCREEN_TIMEOUT_MS` (30 000 ms). Edge, stopped at its picture, took 2 to 10 seconds. With the first code, every run took the full 30 seconds; with the cure, the whole probe went from 14 minutes to about 4, all but about 12 seconds of it the eight failed loads.
- **The 14-minute run with `shoot`'s first code** gave the same hashes as the later runs for the still, late and lateFinal pages, so the cure changes when the browser is stopped, not what it photographs.

## What it means for the design

- **The method works with Chrome on macOS, with one change to Task 11's code.** The helper photographs a preview page with the installed Chrome, headless, no install, and a still page gives the same pixels every time, so `screenshotsMatch` can stay as built: an approval carries over when every page at every size matches. The change (`runBrowser` and the `signal` option of `scripts/lib/run.js`) stops Chrome once its picture is whole; without it the gate could never carry an approval over.
- **Only Chrome's pictures count, for now.** Edge's picture of its own error page would match at both commits, so an approval could carry over a page that never loaded, and Edge says nothing that `shoot` could read. Until the Windows run shows how Edge reports a failed load, `shoot` answers no picture for any browser `stopsAtPicture` does not name ("only Chrome's pictures are trusted so far"), whatever its exit code, without running it. With Edge alone, every check answers no and the director is asked again: safe, at the cost of repeat approvals. The status `shoot` reads before the browser runs (it refuses a failure or an error status) narrows the case but would not close it, since a load can fail in the browser after that check passed.
- **Repeat approvals are expected meanwhile** when only Edge is found (on Windows that is the usual case), and when no browser is found: every comparison answers no, so the director is asked again. The board's health line doesn't say so yet; that is an open item for the board, to be named in the handover.
- **A failed load costs 30 seconds** per picture with Chrome (it neither quits nor writes a picture). At the gate that cost comes once per comparison at most. The gate photographs only the later commit (the approved commit's pictures are taken when its approval is recorded), and the comparison stops at the first picture that fails. A preview that is down fails the status read `shoot` makes first, so no browser runs and the answer is quick. The 30 seconds are spent only when that status read passes and the browser's own load then fails; that fits the gate's budget but is worth knowing.
- **Moving pages** may match or not; a difference asks again, so nothing is lost but an approval.

## Needs the director

Nothing for the Mac part. The Windows part waits for the board-and-usage plan's Windows sitting (its Task 19). The director's only part is being at that computer; the sitting's opening card names this run. The agent runs, from the Wheelhouse folder:

1. `node probes/34-screens/run.js --browser "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"` (Edge not stopped at its picture, to see whether it exits by itself; about 14 minutes if it never quits, as on macOS). The probe reads Edge's version from the version-named folder beside `msedge.exe` and never starts Edge outside a throwaway profile.
2. The same with `--stop-at-picture` added (a few minutes), to see Edge's pictures.
3. If Chrome is installed there, `node probes/34-screens/run.js` with no options.

Record from the JSON: whether the still page matched at both sizes; whether late shows the drawn content; how each run ended (`ended`: does Edge exit by itself on Windows, and with what code?); whether the failed loads gave a picture and whether the browser said `Page load failed`; the slowest picture; `profilesLeft` (profiles still there straight after `shoot`'s own removal); and `scratchRemoved`. Edge's pictures can be trusted, and `stopsAtPicture` widened to Edge, only if every failed load in those runs is reported in a way `shoot` reads: no picture at all, a non-zero exit before any picture, or a line in its output such as Chrome's `Page load failed`. If Edge writes a picture of its error page and exits 0, or says nothing, its pictures stay untrusted and the Windows answer is Chrome only. Then update this note's Answer, and the row in the README.
