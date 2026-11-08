<!-- docs/superpowers/plans/2026-11-08-haiku-trial-kit.md -->

# Haiku Trial Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the kit that runs the Haiku trial: a seed for the test project, a held-back score, the signal checks for the 45 paths, the faults, the model audit and a runner that drives the whole trial (full or smoke). Building it does not run the trial.

**Architecture:** The kit lives in `probes/haiku-trial/`, run on purpose and never by `npm test`, like the other probes. Every piece that can be checked without a live Claude session has a fast test under `tests/probes/haiku-trial/` that runs in `npm test`. Those tests use stand-ins: a reference product, synthetic event records, fake transcripts, a fake tmux and a fake `gh`. The runner is a list of steps over injected input and output, so its order, its smoke subset and its fault timing are tested without spending anything.

**Tech Stack:** Node.js 22 ES modules, `node:test`, `node:http`, `node:sqlite` (Node 22.13 or later), `fetch`, `tmux`, `gh`, `git`. At run time only, `playwright-core` and `axe-core` are installed into a scratch folder, pinned.

**Spec:** `docs/specs/2026-11-08-haiku-trial-design.md` (section numbers below are the spec's).

## Global Constraints

- **Path comment.** Every file starts with a comment giving its repository-relative path, straight after any front matter. JSON and CSV are exempt.
  - Files under `probes/haiku-trial/seed/` are the test project's own files, so their comment gives the path inside the test project (`// src/server.js`).
- **Language.** British or Australian English. Dates as day month year.
  - Never use "enhanced", "improved" or "fixed" in names, comments or user-facing text.
  - Refer to the director as "the director", with they/them.
- **No model identifiers.** Commits, pull requests and comments carry no model identifiers and no AI attribution.
  - The one exception is the alias `haiku` where the spec needs it as a value: `WHEELHOUSE_SETUP_MODEL=haiku`, `--model haiku`, the project settings, and the audit's matcher.
- **The repository is public.**
  - Statements are generated, with made-up merchants only.
  - No raw results go into it. Raw results go to `~/.wheelhouse-trials/haiku-<date>/`; only the summary goes to `docs/trials/<date>-haiku-trial-results.md`.
- **Nothing outside the scratch area during tests.** Tests create no GitHub repository, Vercel project, tmux session or network call.
  - Everything that does any of those takes an injected client. The runner's real clients are used only by a run with the director's go.
- **Set numbers come from the code they name.** Never copy these as numbers:
  - `STUCK_AFTER` from `scripts/feature/cli.js`;
  - `RESUME_LIMIT` from `scripts/watcher/resume.js`;
  - `WHY_LIMIT_MS` from `scripts/decisions/why.js`;
  - `BAR` from `scripts/watcher/reliability.js`.
- **The step 9 names were checked against #396.** As merged, they are:
  - `digestAt`, `digestDue`, `alertText`, `sendAlert`, `deliverAlert`;
  - `NTFY_SERVER`, `goodTopic`, `makeDigestTicker`;
  - the command `alerts ntfy <topic>`.
- **Product contract strings are typed into the requests word for word** (§5.4):
  - `PORT`, `LEDGER_DB` (a path or `:memory:`);
  - the upload field `statement`;
  - `data-category` and `data-total`;
  - the routes `/import`, `/month?m=YYYY-MM`, `/edit?id=` and `/export?m=YYYY-MM`.
- **Amounts are integer cents** throughout the kit. Spending is positive; money back and income are negative. A month's grand total is the signed sum.

## Review Focus

1. **A product that never starts or hangs a request.** The score must fail that part with a reason, not hang. Pinned by `startProduct rejects within timeoutMs when nothing listens` and `held-back marks a check failed when a request times out` (Task 2).
2. **Totals written with float noise or few decimals** (`12.3`, `12.30`, `-0.10`, `12.301`). Reconciliation must compare exact cents from the decimal text and refuse three decimals. Pinned by `centsOf reads plain decimals exactly` (Task 3).
3. **Transcripts with lines that are not JSON, `<synthetic>` model entries, or tool-only turns.** The audit must skip what isn't an assistant model turn and never crash. Pinned by `audit skips broken lines and synthetic entries` (Task 4).
4. **A session reading the held-back folder through Bash** (`cat …/held-back/…`), not just through Read. The peek check must flag any tool input naming `probes/haiku-trial` or `held-back`. Pinned by `peek flags a Bash command naming the held-back folder` (Task 4).
5. **A run stopped half way** (Ctrl-C, a crash, a reboot). `restore` must leave no tmux session, product server or tunnel behind, and must touch nothing outside the run's own folder. Pinned by `restore stops only what the run recorded` (Task 7).

---

## Calls made for this plan

These are the planner's calls, made where the spec leaves a choice:

- **Layout.**
  - The kit is in `probes/haiku-trial/`, with fast tests in `tests/probes/haiku-trial/`.
  - The reference product, a correct small implementation of §5.4, exists only to prove the score: it lives in `tests/probes/haiku-trial/reference-app/` and is never copied into the test project.
- **Staged install.** `stage-plugin.js` makes `git archive HEAD` of this checkout without `probes/` and `tests/`, and a scratch marketplace (`makeScratchMarketplace`) whose source is that folder.
  - The test project's sessions therefore cannot reach the kit, the held-back score or the reference product.
  - Installing it is a run-time step under the director's go.
- **Seed stack.** No dependencies: `node:http`, `node:sqlite`, `node --test` with `fetch`.
  - `package.json` gives `"engines": {"node": ">=22.13"}`, `"start": "node src/server.js"` and `"test": "node --test"`.
- **Dates.** The seed has `src/lib/dates.js`, string-based:
  - `parseDate('31/08/2026') -> '2026-08-31'`;
  - `monthOf('31/08/2026') -> '2026-08'`.
  - P1's request names `parseAmount` and `parseDate`; P3's names `monthOf`. This gives the spare bug a place to land.
- **Planted bug.** `parseAmount('(40.00)')` returns `4000` (the sign is lost). Minus signs work.
- **Spare bug** (§5.3). `applySpareBug(dir)` rewrites `monthOf` to read the date through `Date` in UTC and add a day, so `31/08/2026` lands in `2026-09`.
  - If `src/lib/dates.js` is missing, or nothing in `src/` calls `monthOf`, it applies nothing and returns why; P5 is then marked not covered.
- **Duplicates.** A duplicate has the same date, description and amount as a stored row. The expected totals count it once. This rule goes word for word into P1's request.
- **Category keys.** `data-category` carries the category key:
  - `groceries`, `eating_out`, `transport`, `bills`, `shopping`, `health`, `income`, `other`;
  - the grand total cell's key is `all`.
  - P8 renames `eating_out` to `dining`, so the score reads `dining` as the same category (`ALIASES`).
- **Merchants.** P2's request lists every made-up merchant with its category, generated from `MERCHANTS`. The held-back statement uses the same list plus one unknown merchant. That merchant must land in `other`.
- **Edit contract** (§5.4 item 4, pinned in P4's request):
  - the month page lists the month's transactions, each linking to `/edit?id=<id>`;
  - the edit page has a form that POSTs to `/edit`, with a hidden `id` and a `<select name="category">` with a `<label>`, whose option values are the category keys;
  - after the POST it redirects to the month.
- **Export contract** (pinned in P7's request):
  - a link with the text "Download this month" to `/export?m=YYYY-MM`;
  - `Content-Disposition` filename `spending-YYYY-MM.csv`;
  - header `Date,Description,Amount,Category`.
- **Import message.** It must match `/added (\d+), skipped (\d+)/i`; the review card shows "added 41, skipped 0".
- **Slices.** P3's typed request says it comes in two slices, so the foreman adds `--slices 2`, as `skills/foreman/SKILL.md` says.
- **Signals** come from `listEvents` and `buildViews` on `stateDir(project)`, plus `gh api` for pull requests, statuses and commits.
  - Event kind strings the rows read are kept in one table, `KINDS`. A test checks each appears as a literal under `scripts/`, so a renamed event fails the kit's tests rather than the trial.
- **Transcripts.**
  - The front desk's are found under `~/.claude/projects/<slug>/` by the `cwd` on their lines.
  - The foreman's and feature sessions' come from the stream-json files the engine keeps.
  - Process ids to kill come from `listProcesses` (`scripts/engine/stop.js`).
- **Faults that call the feature CLI** (F1, F1b, F1c) run it as a child process. That child gets a copy of the feature session's `WHEELHOUSE_*` variables, with its worktree as the working folder.
- **Digest.** The runner sets `digestAt` to 10 minutes ahead, so the digest arrives during the run.
- **Accessibility.** `playwright-core` and `axe-core`, pinned (`PLAYWRIGHT_CORE = '1.48.2'`, `AXE_CORE = '4.10.2'`), are installed at run time into `<run>/a11y-tools/`. The browser is found with `findBrowser` (`scripts/pictures/browser.js`); tests inject `browse`.

## File structure

```
probes/haiku-trial/
  README.md                  how to run full, smoke and restore; what needs the director's go (Task 7)
  statement.js               generated statements and their expected totals (Task 1)
  seed/                      the test project's first commit (Task 1)
    package.json  README.md  .claude/settings.json  .github/workflows/ci.yml
    src/server.js  src/lib/money.js  src/lib/dates.js
    scripts/make-statement.js  data/sample-statement.csv  tests/smoke.test.js
  seed.js                    makeTestProject (Task 1)
  spare-bug.js               applySpareBug (Task 1)
  requests.js                PIECES, P5_SPARE, WAVES (Task 1)
  lib/html.js                small HTML reading helpers (Task 2)
  product.js                 startProduct (Task 2)
  held-back/held-back.js     runHeldBack, seed 7 (Task 2)
  acceptance.js              runAcceptance, 15 items (Task 2)
  score/reconcile.js  score/own-tests.js  score/a11y.js  score/health.js  score/total.js   (Task 3)
  audit.js  usage.js         model audit, peek check, usage (Task 4)
  tmux.js  faults.js         clean front desk, faults F1–F6 (Task 5)
  signals.js  results.js     ROWS 1–45, results folder and summary (Task 6)
  runner.js  review-card.js  stage-plugin.js   (Task 7)
tests/probes/haiku-trial/
  reference-app/             a correct small product, for the score's own tests (Task 2)
  *.test.js                  one per kit file
```

Each task is one pull request, with base `main`. The tasks are independent apart from the imports named in their Interfaces block. Stack a pull request on the one before only when that one has not merged yet.

---

### Task 1: Statements, seed, spare bug and requests

**Files:**
- Create:
  - `probes/haiku-trial/statement.js`
  - `probes/haiku-trial/seed/**` (the files listed above)
  - `probes/haiku-trial/seed.js`
  - `probes/haiku-trial/spare-bug.js`
  - `probes/haiku-trial/requests.js`
- Test:
  - `tests/probes/haiku-trial/statement.test.js`
  - `tests/probes/haiku-trial/seed.test.js`
  - `tests/probes/haiku-trial/spare-bug.test.js`
  - `tests/probes/haiku-trial/requests.test.js`

**Interfaces:**
- Produces:
  - `CATEGORIES: Array<{key, label}>`: the eight keys listed in the calls, with labels Groceries, Eating out, Transport, Bills, Shopping, Health, Income, Other.
  - `ALIASES: {dining: 'eating_out'}`.
  - `canonical(key) -> key`.
  - `MERCHANTS: Array<{name, category}>`: at least 3 merchants per category except `other`, all made up. One name contains a comma (`'Pasta, Pizza & Co'`).
  - `UNKNOWN_MERCHANT = 'Zephyr Odd Lot'`.
  - `makeStatement({seed, start: 'YYYY-MM', months, perMonth = 40, extras = {}}) -> {csv, rows, expected}`.
    - `rows`: `Array<{date: 'DD/MM/YYYY', description, cents, category}>`, in file order.
    - `expected`: `{ 'YYYY-MM': { byCategory: {key: cents}, total: cents, count } }`. Duplicates are counted once.
    - `extras`, all optional:
      - `bom: true`;
      - `bracketRefund: {month, cents, merchant}` writes `(40.00)`;
      - `minusRefund: {month, cents, merchant}` writes `-12.50`;
      - `duplicate: true` repeats one row byte for byte;
      - `monthEnd: true` adds a row on each month's last day;
      - `unknown: true` adds one `UNKNOWN_MERCHANT` row;
      - `income: true` adds one income row per month as a negative amount.
  - `formatCents(cents) -> '1234.50' | '-40.00'`.
  - `SAMPLE = {seed: 42, start: '2026-08', months: 3, extras: {bracketRefund: {month: '2026-09', cents: -4000, merchant: <a shopping merchant>}, minusRefund, monthEnd: true, income: true}}`. There is no duplicate in the sample.
  - `HELD_BACK = {seed: 7, start: '2026-05', months: 4, extras: {bom: true, bracketRefund, minusRefund, duplicate: true, monthEnd: true, unknown: true, income: true}}`.
  - `TRY_ME = {seed: 99, start: '2026-11', months: 1, perMonth: 41, extras: {}}`, which gives 41 rows and no duplicates.
  - `SEED_DIR` (absolute path of `seed/`).
  - `makeTestProject({dir, git = true}) -> {dir, sha}`: copies `seed/`, writes `data/sample-statement.csv` from `SAMPLE`, then `git init -b main`, adds everything and makes a first commit "Seed the spending tracker". It refuses a `dir` outside the temp folder (`assertUnderTmp` from `probes/lib/scratch.js`) unless `{allowAnywhere: true}`.
  - `applySpareBug(dir) -> {applied: true, file: 'src/lib/dates.js'} | {applied: false, why}`.
  - `PIECES: Array<{id, wave, lane, visible, rows: number[], text}>`, for P1–P8.
  - `WAVES: {1: ['S0'], 2: ['P1','P2','P6'], 3: ['P3','P5','P8'], 4: ['P4','P7'], 5: [], 6: []}`.
  - `P5_SPARE = 'A payment on 31 August shows under September'`.
  - `F2_ANSWER = 'No, nobody sees this'`.

- [ ] **Step 1: Write the failing tests**

`statement.test.js`:

- **`makeStatement is the same for the same seed`.** Two calls with `SAMPLE` give equal `csv`.
- **`amounts reconcile`.** For every month, `total === sum(byCategory)`, and `byCategory` equals the sum of `rows` in that month by `category`, with the duplicate counted once.
- **`bracket refund is written in brackets and counted negative`.** The CSV contains `,(40.00)`. `expected['2026-09'].byCategory.shopping` is 4000 less than the same statement without `bracketRefund`.
- **`held-back has a BOM, a duplicate, an unknown merchant and a quoted comma`.** All four of these hold:
  - `csv.startsWith('﻿')`;
  - exactly one data line appears twice;
  - a line contains `Zephyr Odd Lot` and its row's category is `other`;
  - a line contains `"Pasta, Pizza & Co`.
- **`month-end rows fall in their own month`.** Each month has a row dated on its last day (`31/05/2026`, `30/06/2026`, `31/07/2026`, `31/08/2026`), counted in that month.
- **`try-me has 41 rows in November 2026 and no duplicates`.**
- **`formatCents`.** `formatCents(-4000) === '-40.00'` and `formatCents(5) === '0.05'`.
- **`every merchant name is made up`.** No `MERCHANTS` name matches `/woolworths|coles|aldi|uber|netflix|amazon|kmart|telstra|optus/i`.

`seed.test.js`:

- **`makeTestProject builds a repository whose smoke test passes`.**
  - Run `npm test` in the copy (spawn `node --test`): exit 0.
  - `git log --oneline` has one commit.
- **`home page says Nothing imported yet`.** Start `node src/server.js` with `PORT=0` and `LEDGER_DB=:memory:`. The server prints `listening on <port>`. `GET /` contains `Nothing imported yet`.
- **`parseAmount has the planted bug`.**
  - `parseAmount('(40.00)') === 4000`;
  - `parseAmount('-12.50') === -1250`;
  - `parseAmount('1,234.50') === 123450`.
- **`dates read DD/MM/YYYY without a clock`.** `parseDate('31/08/2026') === '2026-08-31'` and `monthOf('31/08/2026') === '2026-08'`.
- **`project settings run every session on haiku`.** `.claude/settings.json` deep-equals `{"model":"haiku","env":{"CLAUDE_CODE_SUBAGENT_MODEL":"haiku"}}`.
- **`ci runs npm ci and npm test on Node 22`.**
  - The workflow text contains `npm ci` and `npm test`.
  - Its `node-version` list is exactly `22`, so P6 has something to add.
- **`refuses a folder outside the temp folder`.**

`spare-bug.test.js` (each case on a fresh `makeTestProject` in a temp folder):

- **`applies when monthOf is used`.**
  - Add one line to `src/server.js` that imports `monthOf`.
  - `applySpareBug` returns `{applied: true}`.
  - In a child process with `TZ` unset and then with `TZ=Australia/Sydney`, the imported `monthOf('31/08/2026') === '2026-09'` and `monthOf('15/08/2026') === '2026-08'`.
- **`does not apply when monthOf is unused`.** Returns `{applied: false, why: /monthOf/}` and leaves the file byte for byte.
- **`does not apply when dates.js is gone`.** Returns `{applied: false, why: /dates\.js/}`.

`requests.test.js`:

- **`P1 carries the import contract`.** The text contains each of:
  - `statement`, `PORT`, `LEDGER_DB`, `:memory:`, `DD/MM/YYYY`;
  - `parseAmount`, `parseDate`;
  - `added`, `skipped`;
  - the duplicate rule sentence: `A duplicate has the same date, description and amount as a stored row`.
- **`P2 lists every merchant and every key`.**
  - Every `MERCHANTS[i].name` and every category key appear.
  - The text contains `src/lib/categories.js` and `other`.
- **`P3 asks for two slices and names monthOf and the data attributes`.** It contains `two slices`, `monthOf`, `data-category`, `data-total` and `data-category="all"`.
- **`P4 carries the edit contract and says nothing about rules`.**
  - It contains `/edit?id=`, `name="category"` and `label`.
  - It does not match `/\brule/i`, so the behaviour decision arises on its own.
- **`P5, P6 and P8 are the spec's words`.**
  - P5 is `A $40 refund shows as spending`.
  - P6 is `Make CI also run on Node 24`.
  - P8 is `Rename the category key 'eating_out' to 'dining' in src/lib/categories.js, and touch nothing else. Nobody sees this.`
- **`P7 carries the export contract and names the month page`.** It contains `Download this month`, `/export?m=`, `spending-YYYY-MM.csv` and `Date,Description,Amount,Category`.
- **`waves match section 7`.** `WAVES` deep-equals the value above, and each piece's `wave` matches it.
- **`lanes and rows match section 7`.**
  - P6 has lane `quick` and `visible: false`.
  - P5 has lane `bug`.
  - P1 and P3 have lane `feature`.
  - P2, P4, P7 and P8 have lane `small`.
  - The rows are as in §7's table.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/probes/haiku-trial/`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

**`statement.js`:**
- Use a seeded generator (mulberry32).
- Each row has a random day within its month, a random merchant from `MERCHANTS` (not income), and an amount from 3.00 to 180.00.
- The description is the merchant name plus an optional ` REF ` and 4 digits.
- Quote any field containing a comma.
- Lines end in `\r\n`, after the header `Date,Description,Amount`.

**`seed/`:**
- `src/server.js` serves `/` only and reads `PORT` (default 3000). It opens `LEDGER_DB` (default `ledger.db`) with `node:sqlite`, creating a table `transactions(id INTEGER PRIMARY KEY, date TEXT, description TEXT, cents INTEGER)`. It prints `listening on <port>`.
- `scripts/make-statement.js` is a copy-free stand-in that writes a small statement. It must not import from the kit.
- The README says what the app is and how to run and test it, in five lines.

**`requests.js`:** these are the exact texts; their sentences are copy that the tests pin.

> **P1**: "Let me upload my bank statement and see it imported. Add a page at /import with a file upload field named `statement`. The statement is a CSV with the columns Date, Description, Amount; dates are DD/MM/YYYY, and an amount in brackets or with a minus sign is money coming back. Read amounts with `parseAmount` in src/lib/money.js and dates with `parseDate` in src/lib/dates.js. A duplicate has the same date, description and amount as a stored row: skip it. After an upload the page says 'Added n, skipped n' with the counts, so importing the same file twice adds nothing. A file that isn't a statement gets a plain error and adds nothing. The home page lists each month that has transactions, newest first, each linking to /month?m=YYYY-MM. Keep reading the port from PORT and the database path from LEDGER_DB, which can be `:memory:`."
>
> **P2**: "Sort transactions into categories by shop name. Put the rules in src/lib/categories.js with these category keys and labels: <keys and labels from CATEGORIES>. A description belongs to a shop when it contains the shop name, ignoring case. The shops are: <one line per merchant: name → key>. A description that matches no shop is `other`."
>
> **P3**: "A page per month with totals by category and change from last month. Build it in two slices: first the totals, then the change. The page is /month?m=YYYY-MM; work out a transaction's month with `monthOf` in src/lib/dates.js. Show a row per category with its total and the change from the month before, and a grand total of every category, with money back and income counted as negative. Each total cell carries `data-category` (the category key) and `data-total` (a plain decimal such as 1234.50 or -40.00); the grand total's cell has `data-category="all"`. Link to the previous and next months."
>
> **P4**: "Let me move a transaction to a different category. On the month page, list that month's transactions, each linking to /edit?id=<id>. The edit page has a form that posts to /edit with a hidden `id` and a select `name="category"` with a label, whose options are the category keys; after saving, go back to that month."
>
> **P7**: "A button to download this month as a spreadsheet. Put a link 'Download this month' on the month page, going to /export?m=YYYY-MM, which sends a CSV named spending-YYYY-MM.csv with the header Date,Description,Amount,Category and that month's transactions."

The other three texts are the spec's own words, as the tests give them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/probes/haiku-trial/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add probes/haiku-trial tests/probes/haiku-trial
git commit -m "Add the Haiku trial's statements, seed project, spare bug and requests"
```

---

### Task 2: Reference product, held-back checks and acceptance items

**Files:**
- Create:
  - `probes/haiku-trial/lib/html.js`
  - `probes/haiku-trial/product.js`
  - `probes/haiku-trial/held-back/held-back.js`
  - `probes/haiku-trial/acceptance.js`
  - `tests/probes/haiku-trial/reference-app/**`
- Test:
  - `tests/probes/haiku-trial/held-back.test.js`
  - `tests/probes/haiku-trial/acceptance.test.js`
  - `tests/probes/haiku-trial/product.test.js`

**Interfaces:**
- Consumes (from Task 1): `makeStatement`, `HELD_BACK`, `CATEGORIES`, `canonical`, `formatCents`.
- Produces:
  - `startProduct({dir, env = {}, timeoutMs = 20000}) -> Promise<{url, stop(): Promise<void>, pid}>`.
    - It picks a free port, spawns `npm start` in `dir` with `PORT` and `LEDGER_DB=:memory:`, and polls `GET /` until it answers.
    - If nothing answers within `timeoutMs`, it kills the process group and rejects with `Error('product did not start: …')`.
  - `request(url, {method, body, form, file, timeoutMs = 10000}) -> {status, headers, text}`.
    - `file` is `{field, name, content}` and sends `multipart/form-data`.
    - It never throws on a status; on a timeout it returns `{status: 0, text: 'timed out'}`.
  - `html.js`:
    - `findAll(html, tagName) -> Array<{attrs, inner, outer}>`;
    - `textOf(fragment)`;
    - `totalsOf(html) -> {key: cents | null}`, which reads every element carrying `data-category` and `data-total` and applies `canonical` to keys;
    - `labelled(html) -> {fields, unlabelled}`. Every `input`, `select` and `textarea` that isn't hidden or submit needs a `<label for>` matching its id, a wrapping label, or an `aria-label`.
  - `runHeldBack({dir, statement = makeStatement(HELD_BACK)}) -> Promise<{checks: Array<{id, pass, detail}>, passed, total, share}>`.
    - It starts its own product with `startProduct`, so every run begins empty.
  - `HELD_BACK_CHECKS: string[]`, the check ids in order.
  - `runAcceptance({dir}) -> Promise<{items: Array<{id, pass, detail}>, passed, total: 15}>`.
  - `ACCEPTANCE_ITEMS: string[]`, 15 ids.

**Held-back check ids** (24), each using the statement's `expected`:

| Group | Ids |
|---|---|
| Import | `import-ok`, `added-count`, `skipped-duplicate`, `again-adds-none`, `again-skips-all`, `bad-file-plain`, `bad-file-adds-none` |
| Totals per month | `totals-2026-05` to `totals-2026-08` (every key in `byCategory` to the cent, aliases applied) |
| Grand total per month | `grand-2026-05` to `grand-2026-08` |
| Particular rows | `bom-first-row`, `bracket-refund`, `minus-refund`, `quoted-comma-whole`, `month-end-own-month`, `unknown-is-other`, `income-negative` |
| Edit and export | `edit-moves-one`, `export-matches` |
| Odd months | `empty-month-ok`, `bad-month-ok` |

What some checks mean:
- **`bad-file-plain`:** status 400–499, and the body has no stack trace (`/\n\s+at /`).
- **`edit-moves-one`:** this check:
  1. finds the `/edit?id=` link in the `<tr>` holding a known groceries row's description;
  2. POSTs `id` and `category=health`;
  3. passes when groceries fell and health rose by exactly that row's cents, and every other key is unchanged.
- **`export-matches`:** the filename contains the month; there is a row per transaction; and the Amount column, summed and grouped by Category, equals that month's totals.
- **`empty-month-ok` and `bad-month-ok`:** `/month?m=2026-01` and `/month?m=nonsense` answer below 500.

**Acceptance item ids** (15), each passing when its condition holds:

| Id | Passes when |
|---|---|
| `home-empty-state` | `/` before import contains `Nothing imported yet` or another sentence saying nothing is imported |
| `import-form` | `/import` has a `form` with `method=post`, `enctype=multipart/form-data` and an `input type=file name=statement` |
| `import-field-labelled` | the import form's fields are all labelled |
| `import-message` | the message matches `/added (\d+), skipped (\d+)/i` with the right counts |
| `home-lists-months` | `/` lists every imported month, each linking to `/month?m=` |
| `titles-name-pages` | the `<title>` of `/`, `/import`, `/month` and `/edit` each differ, and `/month`'s names the month as text (`May 2026`) |
| `month-rows` | the month page has a `data-category` cell for every key with money that month, plus `all` |
| `month-change` | the month page shows a change for each category row after the first month |
| `prev-next` | the second month links to the first and third; the first has no previous link |
| `transaction-links` | every transaction links to `/edit?id=` |
| `edit-form` | the edit page has a labelled `select name=category` offering every category key (aliases allowed) |
| `edit-returns` | after the POST, the response redirects or links to `/month?m=` |
| `export-link` | the text `Download this month` links to `/export?m=` |
| `export-file-name` | `Content-Disposition` names `spending-YYYY-MM.csv` |
| `all-fields-labelled` | every page's fields are labelled |

**The reference app** (about 250 lines over a few files) is the product as §5.4 and the requests describe it, with `node:sqlite`. It exists to make these tests pass, and its broken copies make them fail.

- [ ] **Step 1: Write the failing tests**

`product.test.js`:

- **`startProduct starts the reference app and stops it`.** `GET url` gives 200. After `stop()`, the pid is gone (`process.kill(pid, 0)` throws).
- **`startProduct rejects within timeoutMs when nothing listens`.** With a dir whose `npm start` runs `setInterval(()=>{},1000)`, it rejects in under `timeoutMs + 2000` and leaves no process.
- **`request times out without throwing`.** Against a server that never answers, it returns `{status: 0}`.

`held-back.test.js`:

- **`the reference app passes every check`.** `share === 1` and `total === HELD_BACK_CHECKS.length`, which is at least 24.
- **`a copy with the bracket bug fails the refund checks`.** Copy the reference app to a temp folder and make `(40.00)` read positive.
  - `bracket-refund` fails, and so does at least one `totals-*`.
  - `minus-refund` passes.
- **`a copy that ignores duplicates fails the duplicate checks`.** `skipped-duplicate` and `again-adds-none` fail.
- **`a copy that drops the BOM's first row fails bom-first-row`.**
- **`a copy that reads dates in UTC plus a day fails month-end-own-month`.**
- **`held-back marks a check failed when a request times out`.** Use a copy whose `/export` never answers.
  - `export-matches` has `pass: false` and a `detail` matching `/timed out/`.
  - The run finishes.

`acceptance.test.js`:

- **`the reference app passes all 15 items`.** `passed === 15`.
- **`a copy without labels fails the label items`.** `import-field-labelled` and `all-fields-labelled` fail, and nothing else does.
- **`a copy with the same title on every page fails titles-name-pages`.**
- **`a copy whose export is named export.csv fails export-file-name`.**

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/probes/haiku-trial/product.test.js tests/probes/haiku-trial/held-back.test.js tests/probes/haiku-trial/acceptance.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Broken copies** are made in the test by copying `reference-app/` to a temp folder and replacing one marked line. Each such line carries a comment `// variant: <name>` so the test can find it.
- **`startProduct`** spawns with `detached: true` and kills the process group, so `npm`'s child goes too.

- [ ] **Step 4: Run the tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add probes/haiku-trial tests/probes/haiku-trial
git commit -m "Add the held-back checks and acceptance items, proved on a reference product"
```

---

### Task 3: The score

**Files:**
- Create:
  - `probes/haiku-trial/score/reconcile.js`
  - `probes/haiku-trial/score/own-tests.js`
  - `probes/haiku-trial/score/a11y.js`
  - `probes/haiku-trial/score/health.js`
  - `probes/haiku-trial/score/total.js`
- Test: `tests/probes/haiku-trial/score.test.js`

**Interfaces:**
- Consumes:
  - from Task 2: `startProduct`, `request`, `totalsOf`, `runHeldBack`, `runAcceptance`;
  - from Task 1: `makeStatement`, `HELD_BACK`.
- Produces:
  - `centsOf(text) -> number | null`. It accepts `/^-?\d+(\.\d{1,2})?$/` after trimming and returns integer cents with no float arithmetic. Anything else gives `null`.
  - `reconcile({dir, statement}) -> {points: 0 | 15, mismatches: Array<{month, key, want, got}>}`.
    - It imports the held-back statement into a fresh product.
    - It reads `/month?m=` for each of the four months.
    - It passes only when every key with money, and `all`, matches exactly.
  - `ownTests({dir, baseSha, gh}) -> {points, of: 15, parts: {written: 0–5, green: 0–3, kept: 0–4, bite: 0–3}, notes}`. The parts are:
    - **written (5):** one point each for a unit test calling `parseAmount`, one calling `categorise` (or the function exported by `src/lib/categories.js`), one on month totals, and an e2e test that posts to `/import` and reads `/month`. The fifth point needs every file under `src/` changed since `baseSha` to have a test file changed in the same pull request (read from `gh`).
    - **green (3):** the last CI run on main passed.
    - **kept (4):** one point each for:
      - `git log --diff-filter=D --format=%H <baseSha>..HEAD -- tests/` is empty;
      - no `.skip(`, `todo(` or `{ skip` under `tests/`;
      - the test count never fell (counted from `node --test --test-reporter=tap` at each merge on main);
      - the count at the end is higher than at the start.
    - **bite (3):** in a scratch copy, flip the refund sign in `parseAmount` and run `npm test`; then, separately, change one merchant's category and run it again. Each must fail: 1.5 points each, rounded down to a whole point.
  - `a11y({dir, browse}) -> {points, of: 10, pages: {path: {serious, critical, ids}}}`.
    - The pages are `/`, `/import`, `/month?m=<first month>` and `/edit?id=<first id>`, after importing the held-back statement.
    - The score starts at 10 and loses 2 per serious rule id (counted once across pages).
    - Any critical gives 0. The floor is 0.
    - `browse(url) -> Promise<AxeResults>` is injected. The real one is `makeBrowse({toolsDir})`: it installs the pinned `playwright-core` and `axe-core` with `npm install --prefix toolsDir`, then launches `findBrowser()` headless.
  - `health({dir}) -> {points, of: 5, parts}`. One point each for:
    - no file in `src/`, `tests/` or `scripts/` over 300 lines;
    - no `TODO` or `FIXME`;
    - no unused dependency (each name in `dependencies` imported somewhere in `src/`);
    - `npm audit --omit=dev --json` with no `high` or `critical`;
    - a fresh `git clone` passing `npm ci && npm test` and `npm start` answering `/`.
  - `scoreAll({dir, baseSha, gh, browse, smoke = false}) -> {total, parts: {heldBack, reconcile, acceptance, ownTests, a11y, health}, pass, why: string[]}`.
    - `heldBack` is `share × 40`, rounded to a whole point.
    - `acceptance` is `passed` (out of 15).
    - When `smoke` is true, only `reconcile` and `ownTests` are run. `pass` is then `null`, as smoke has no bar.
  - `passBar({total, parts, heldBackShare, critical}) -> {pass, why}`. It passes when all of these hold:
    - `total >= 80`;
    - `parts.reconcile === 15`;
    - `heldBackShare >= 0.9`;
    - `!critical`.

- [ ] **Step 1: Write the failing tests**

- **`centsOf reads plain decimals exactly`.**
  - `centsOf('12.3') === 1230`;
  - `centsOf('12.30') === 1230`;
  - `centsOf('-0.10') === -10`;
  - `centsOf('0.29') === 29`;
  - `centsOf('12.301') === null`;
  - `centsOf('$12') === null`;
  - `centsOf('') === null`.
- **`reconcile gives 15 on the reference app and 0 on a one-cent slip`.** Use the `rounding` variant, which adds 1 cent to `shopping` in one month: `mismatches.length === 1`.
- **`ownTests scores the parts from a fixture repository`.** Build a temp git repository with:
  - a test calling `parseAmount`;
  - a deleted test file in history;
  - a `.skip(`.
  - A fake `gh` returns one green run.
  - Expect `written >= 1`, `kept <= 2` and `green === 3`.
- **`bite needs both mutations to fail the tests`.** A fixture whose tests check nothing gets `bite === 0`. The reference app gets `bite === 3`, because it ships the tests a builder would write.
- **`a11y takes 2 per serious rule and 0 for any critical`.** Use a fake `browse`:
  - two serious ids across pages gives `points === 6`;
  - one critical gives 0.
- **`health counts each part`.**
  - A fixture with a 301-line file and a `TODO` scores `points <= 3`.
  - The reference app scores 5 with `npm audit` stubbed through an injected `run`.
- **`passBar`.**
  - `{total: 85, reconcile: 15, share: 0.92}` passes.
  - Each of these fails, with its own reason in `why`:
    - `total: 79`;
    - `reconcile: 0`;
    - `share: 0.89`;
    - `critical: true`.
- **`smoke scores reconciliation and own tests only`.** In `scoreAll({smoke: true})`, the other parts are `null` and `pass === null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/probes/haiku-trial/score.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Add `bite` tests to the reference app, so that it is a fair yardstick.
- Every child process (`npm`, `git`) runs through an injected `run(cmd, args, {cwd})` that defaults to `spawnSync`. This keeps tests offline.

- [ ] **Step 4: Run the tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add probes/haiku-trial/score tests/probes/haiku-trial
git commit -m "Add the Haiku trial's score: reconciliation, own tests, accessibility, health and the pass bar"
```

---

### Task 4: Model audit, peek check and usage

**Files:**
- Create:
  - `probes/haiku-trial/audit.js`
  - `probes/haiku-trial/usage.js`
- Test:
  - `tests/probes/haiku-trial/audit.test.js`
  - `tests/probes/haiku-trial/usage.test.js`

**Interfaces:**
- Produces:
  - `HAIKU = /haiku/i`.
  - `findTranscripts({project, claudeHome = ~/.claude, engineDir}) -> Array<{file, role, session}>`.
    - **Front desk:** files under `<claudeHome>/projects/*/` whose first line with a `cwd` names the project folder; their role is `front-desk`.
    - **Subagents:** the same, from `subagents/` folders beside them.
    - **Foreman and feature sessions:** the stream-json files the engine keeps for the project. Their role comes from the file's own `WHEELHOUSE_ROLE` record or its folder name.
    - **Why forks:** their role is `why`.
  - `auditModels(transcripts) -> {clean: boolean, offenders: Array<{file, role, session, model, count}>}`.
    - It reads every line and keeps assistant entries (`type === 'assistant'`, `message.model` a string).
    - It skips lines that aren't JSON and models equal to `<synthetic>`.
    - Any other model that does not match `HAIKU` is an offender.
  - `PEEK_PATTERNS = [/probes\/haiku-trial/, /held-back/, /reference-app/]`.
  - `auditPeek(transcripts) -> {clean, hits: Array<{file, role, tool, text}>}`. It checks every `tool_use` input (any tool, serialised to JSON) against `PEEK_PATTERNS`.
  - `readUsage(transcripts) -> {byRole: {role: {input, output, cacheRead, cacheWrite}}, total}`. It sums `message.usage` from assistant entries.
  - `usageNote(usage) -> string`, one line per role for the results summary.

- [ ] **Step 1: Write the failing tests**

All fixtures are written as JSONL into a temp `claudeHome`.

- **`a clean run passes`.** Every assistant entry's model is `claude-haiku-…`: `clean: true`.
- **`a sonnet entry fails and names the session and role`.** One feature-session line with a non-Haiku model gives `offenders[0]` with `role: 'feature'`, the right `session` and `count: 1`.
- **`audit skips broken lines and synthetic entries`.** A file with `not json`, an entry with `model: '<synthetic>'` and a user entry is still `clean: true`.
- **`front desk transcripts are matched by cwd`.** Two project folders exist; only the one whose `cwd` equals the project is returned.
- **`peek flags a Bash command naming the held-back folder`.** A `tool_use` with `{command: 'cat ../probes/haiku-trial/held-back/held-back.js'}` gives one hit with `tool: 'Bash'`.
- **`peek ignores the word in plain assistant text`.** Text that mentions "held-back" in a reply, with no tool use, gives no hit.
- **`usage sums by role`** (in `usage.test.js`). Two roles with known usage give the totals.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/probes/haiku-trial/audit.test.js tests/probes/haiku-trial/usage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Before writing `findTranscripts`, read `scripts/engine/` (the session starter and where it writes stream-json). Use the path it uses; don't guess. Read `scripts/decisions/why.js` for where the why fork's output goes.

- [ ] **Step 4: Run the tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add probes/haiku-trial/audit.js probes/haiku-trial/usage.js tests/probes/haiku-trial
git commit -m "Add the Haiku trial's model audit, peek check and usage reader"
```

---

### Task 5: Clean front desk and the faults

**Files:**
- Create:
  - `probes/haiku-trial/tmux.js`
  - `probes/haiku-trial/faults.js`
- Test:
  - `tests/probes/haiku-trial/tmux.test.js`
  - `tests/probes/haiku-trial/faults.test.js`

**Interfaces:**
- Consumes:
  - `startedByScript`, `typedRepliesOn` from `scripts/decisions/answer.js`;
  - `STUCK_AFTER` from `scripts/feature/cli.js`;
  - `listProcesses` from `scripts/engine/stop.js`;
  - `F2_ANSWER` from Task 1.
- Produces:
  - `cleanEnv(from = process.env) -> env`. It is a copy without:
    - `CLAUDE_CODE_ENTRYPOINT` when it matches `/^sdk-/`;
    - `WHEELHOUSE_ROLE`, `WHEELHOUSE_SESSION`, `WHEELHOUSE_AGENT`, `WHEELHOUSE_ENGINE_RUN`;
    - `CLAUDECODE`.
    - Its contract: `startedByScript(cleanEnv(x)) === false` for any `x`.
  - `makeTmux({run = spawnSync}) -> {start({name, cwd, command, env}), type(name, text), keys(name, ...keys), capture(name) -> string, kill(name), list() -> string[]}`.
    - `type` sends the text literally (`send-keys -l`) and then `Enter`.
    - Session names start with `haiku-trial-`.
  - `frontDeskCommand({claude = 'claude'}) -> {command: [claude, '--model', 'haiku'], env: cleanEnv()}`.
  - `featureEnvOf({project, piece, listProcesses}) -> {env, cwd}`. It finds the feature session for a piece's change and copies its environment.
    - It reads `ps eww` output for the `claude -p` whose `WHEELHOUSE_SESSION` names it, takes the `WHEELHOUSE_*` variables, and uses its worktree as the cwd.
  - `faults`:
    - `f1WrongShape({env, cwd, run}) -> {code, sentBack: boolean, stdout}`. It runs `node <plugin>/scripts/feature/cli.js ask …` with one option, no undo, no meanwhile, and the question text `Trial check: is this question the right shape?`.
    - `f1bStuck({env, cwd, run}) -> {tries: [{code, stuck}], stuckAt}`. It repeats until stuck, never more than `STUCK_AFTER` times.
    - `f1cDirectorKind({env, cwd, run}) -> {code, text}`. It runs `log --kind behaviour …`.
    - `f3KillFeature({project, piece, listProcesses, kill = process.kill}) -> {pid}`. It sends `SIGKILL` to that piece's `claude -p` only.
    - `f3bKillForeman({project, listProcesses, kill}) -> {pid}`.
    - `f6AllStop(tmux)` types `all stop`. `undoTyped(tmux, sha)` types `undo <sha>`. `liftTyped(tmux)` types `lift all stop`.
    - `decisionFallback({env, cwd, run})` raises P4's behaviour decision in P4's environment if none was raised. Its question is "Should moving one transaction also make a rule for that shop?", with `--about behaviour --level 3`, two options each with cost and undo, a recommendation, a because and a meanwhile.
    - `secondDecision({env, cwd, run})` raises a second decision of the right shape for §9 step 3.

- [ ] **Step 1: Write the failing tests**

`tmux.test.js`:

- **`cleanEnv removes every starter variable`.** For `{CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', WHEELHOUSE_ROLE: 'feature', WHEELHOUSE_SESSION: 's', WHEELHOUSE_AGENT: 'a', WHEELHOUSE_ENGINE_RUN: 'r', PATH: '/bin'}`:
  - `startedByScript(cleanEnv(x)) === false`;
  - `PATH` is kept.
- **`cleanEnv keeps a non-script entrypoint`.** `CLAUDE_CODE_ENTRYPOINT: 'cli'` is kept.
- **`type sends the text literally then Enter`.** A fake `run` records `['send-keys','-t','haiku-trial-desk','-l','1 B']` and then `['send-keys','-t','haiku-trial-desk','Enter']`.
- **`front desk runs on haiku`.** `frontDeskCommand().command` deep-equals `['claude','--model','haiku']`.

`faults.test.js` (the feature CLI is real; its client is the repository's own stand-in helper, as in `tests/feature/cli.test.js`, so read that file first):

- **`f1 gets exit 2 and a send-back`.** `code === 2` and `sentBack === true`.
- **`f1b is stuck by the STUCK_AFTER-th try`.** `stuckAt <= STUCK_AFTER` and the last try has `stuck: true`.
- **`f1c is refused and points to ask`.** `text` matches `/"behaviour" is the director's to decide/` and `/ask --about behaviour --level 3/`.
- **`f3 kills only the named piece's session`.** A fake `listProcesses` returns two `claude -p` entries with different `WHEELHOUSE_SESSION` values; `kill` is called once, with the right pid and `'SIGKILL'`.
- **`featureEnvOf copies WHEELHOUSE variables and the worktree`.** From a fake `ps eww` line, `env.WHEELHOUSE_SESSION` and `cwd` are as written.
- **`decisionFallback asks the spec's question at level 3`.** The recorded `ask` call includes the exact question text, `--about behaviour` and `--level 3`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/probes/haiku-trial/tmux.test.js tests/probes/haiku-trial/faults.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Read `scripts/feature/cli.js` for the exact `ask` and `log` flags, and use those spellings. The flag names in this plan are the spec's.

- [ ] **Step 4: Run the tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add probes/haiku-trial/tmux.js probes/haiku-trial/faults.js tests/probes/haiku-trial
git commit -m "Add the Haiku trial's clean front desk and its faults"
```

---

### Task 6: Signal rows and results

**Files:**
- Create:
  - `probes/haiku-trial/signals.js`
  - `probes/haiku-trial/results.js`
- Test:
  - `tests/probes/haiku-trial/signals.test.js`
  - `tests/probes/haiku-trial/results.test.js`

**Interfaces:**
- Consumes:
  - `listEvents` from `scripts/state/events.js`;
  - `buildViews` from `scripts/state/views.js`;
  - `stateDir` from `scripts/lib/paths.js`;
  - `readIncidents` from `scripts/watcher/reliability.js`;
  - `RESUME_LIMIT` from `scripts/watcher/resume.js`;
  - `WHY_LIMIT_MS` from `scripts/decisions/why.js`;
  - `UNDO_BRANCH` and `undoTitle` from `scripts/host/undo.js`;
  - `auditModels` and `auditPeek` from Task 4;
  - `PIECES` from Task 1.
- Produces:
  - `KINDS`: every event kind string any row reads, for example `'self-merged'`, `'agent-call'`, `'decision-answer'`, `'card-answer'`, `'approval'`, `'merge'`, `'incident'`, `'stopped'`, `'lift-stop'`, and the names the engine writes for intake, work-ready, sent back and resumed. Take each from the module that writes it.
  - `ROWS: Array<{id: 1..45, path, pieces: string[], wave, smoke: boolean, check(ctx) -> {pass: boolean | null, evidence: string}}>`.
    - `pass: null` means not covered, with the reason in `evidence`.
  - The rows with `smoke: true` are exactly 1, 2, 3, 4, 5, 7, 8, 9, 10, 13, 16, 17, 18, 19, 21, 22, 25, 26, 27, 28, 29, 31, 33, 35, 43, 44 and 45.
  - `FULL_ONLY = [34, 41]`.
  - `ctx`, which `gatherContext` builds:
    - `{events, views, prs: Array<{number, title, head, body, mergedAt, mergeSha, commits, statuses}>, transcripts, audit, panes: {name: text[]}, runLog: Array<{at, step, note}>, incidents, pieces: {id: {change, prs: number[]}}, scores, previews: 'vercel' | 'tunnel' | 'none'}`.
  - `gatherContext({project, gh, runLog, panes, transcripts}) -> ctx`.
  - `checkAll(ctx, {smoke}) -> Array<{id, path, pass, evidence}>`. In smoke mode, rows without `smoke` are left out. `FULL_ONLY` rows are left out of smoke mode as well.
  - `PROOF_HEADINGS`:
    - What changed;
    - Why;
    - Decided on its own;
    - Decisions followed;
    - How it was checked;
    - What it looks like;
    - The data before and after.
  - `results.js`:
    - `runFolder(date, home = os.homedir()) -> '<home>/.wheelhouse-trials/haiku-<date>'`.
    - `writeRaw({folder, transcripts, events, panes, runLog, usage})` copies files in and writes `events.jsonl`, `panes/*.txt`, `signals.jsonl` and `usage.json`.
    - `LABELS = ['kit fault', 'Wheelhouse fault', 'Haiku floor']`.
    - `writeSummary({file, date, rows, score, audit, usage, labels: {rowId: label}, verdict}) -> markdown`. It writes `docs/trials/<date>-haiku-trial-results.md`, with these sections:
      - Result;
      - Score;
      - Paths (a table of row, path, result, label);
      - Model audit;
      - Usage;
      - What's next.
      - The summary holds no transcript text, no merchant data and no project path outside the repository.

**Row checks.** Each row's `check` is the spec's pass signal for that row, from §6 (the pinned strings are copy).

**Setup, intake and lanes**

| Row | Check |
|---|---|
| 1 | An event or pane line saying setup is done. `views.settings` roles are all `haiku`, and `tiers.pins.mostCapable` and `tiers.pins.midSized` are `haiku`. Premium is off. The health check passed. |
| 2 | The front desk's pane shows the session-start context. Every front-desk reply the stand-in saw fits the phone limit (from `scripts/lib/` where the limit is defined). The audit is clean for role `front-desk`. |
| 3 | Each piece has an intake event whose lane equals `PIECES[i].lane`. |
| 4 | P6: no plan file in its change; `work-ready` with no approval card before it. |
| 5 | P2, P4 and P7: a plan file exists. An approval card exists only when `visible`. |
| 6 | P5: the first commit of its pull request adds or changes only test files, and that test fails at that commit (taken from the pull request's checks or a local run). |

**Approvals, pace and sessions**

| Row | Check |
|---|---|
| 7 and 8 | P1 and P3: `needsApproval`, a `card-answer` through the picker that is signed, then `work-ready`. |
| 9 | At no instant in `runLog` or the views' history are more than 3 sessions building, or more than one feature lane. |
| 10 | Every piece's pull request includes test files, and the log has the review and tester steps. |
| 11 | P3 has two pull requests, each with its own plan file, merged in order. |
| 12 | P7's wait text matches `/waits: its plan touches src\/pages\/month\.js, which .* is changing/`. P7's first commit is after P4's merge. |

**Decisions**

| Row | Check |
|---|---|
| 13 | P4's decision has 2–4 options, each with a cost and an undo, plus a recommendation, a because and a meanwhile, and its message fits the phone limit. |
| 14 | F1's result: `code === 2`, `sentBack`, and a right-shaped try within `STUCK_AFTER`. |
| 15 | A `stuck --why` message reached the front desk (pane text). |
| 16 | The status context `wheelhouse/decision` reads `Waiting on decision 1`; the gate reason is `waiting-on-decision`; no merge happens while it waits. |
| 17 | Another piece started while P4 waited. |
| 18 | A `decision-answer` with `where: 'chat'` and label `B`; the status then reads `No decision waiting`; P4 merged. |
| 19 | For each §9 edge reply, the pane shows its note (the texts in `scripts/decisions/answer.js`) and no new `decision-answer`. |
| 20 | A `decision-answer` with `private: true`, and no new file under `docs/decisions/` from it. |
| 21 | A non-fallback why answer in the pane within `WHY_LIMIT_MS` of `why 1`. |
| 22 | At least one `agent-call` from P2 or P3. |
| 23 | F1c's `text` (the refusal quoted in Task 5). |
| 24 | `pull-back` gave a confirm card. |

**Proof, gate and records**

| Row | Check |
|---|---|
| 25 | Every merged pull request's body has all of `PROOF_HEADINGS`. |
| 26 | P1, P3, P4 and P7: "What it looks like" has two images (desktop and phone). `null` when `previews === 'none'`. |
| 27 | P1's data section names route `test`. |
| 28 | P1, P2, P3 and P7: no `self-merged`, an approval card, and the merge after the card's answer. |
| 29 | P6: `self-merged` with reason `internal`. |
| 30 | P8: intake `visible: false`, then the gate `visible: true` with a text reason; no self-merge; an approval card. |
| 31 | A file under `docs/decisions/` from decision 1. |
| 32 | A branch `wheelhouse/decisions-<date>` made at the first tick after midnight, and `self-merged` with reason `decision-records`. |

**Crash and stops**

| Row | Check |
|---|---|
| 33 | A `resumed` incident for P1, with resumes at or under `RESUME_LIMIT`; P1 merged. |
| 34 | `work-ready` with `detail.recovered === true` within 10 minutes of F3b. A `lost` row in `reliability.jsonl` is reported in `evidence` as a finding, not a fail. |
| 35 | Routine moves were settled by the watcher, and `reliability.jsonl` has rows (`readIncidents`). Any kind at or over `BAR` is reported. |
| 36 | A pull request titled `undoTitle(…)` on a branch matching `UNDO_BRANCH`, merged; main's CI no longer lists Node 24. |
| 37 | The reply `The undo clashes with later work, so nothing was changed: it is now a decision for the director` in the pane; a card titled `Undo of the merge <sha> clashes with later work`; no undo branch on the remote. |
| 38 | `stopped` set; no new start for 5 minutes (from `runLog`); a merge refused with `All stop is on`. |
| 39 | Refused by the stop-guard hook (pane text); no undo branch. |
| 40 | A lift card was answered, `lift-stop` recorded, and starts resumed. |
| 41 | An incident froze merges and was then lifted. |

**Alerts, tests and audit**

| Row | Check |
|---|---|
| 42 | The digest arrived within 2 minutes after `digestAt` (from the ntfy record or the pane). |
| 43 | An ntfy message reading `1 decision waits in <project>`. |
| 44 | `scores.ownTests` was reached (any points); `evidence` carries the parts. |
| 45 | `audit.models.clean && audit.peek.clean`. |

- [ ] **Step 1: Write the failing tests**

`signals.test.js` (fixtures are synthetic events written with the repository's own helpers into a temp `stateDir`, as `tests/state/` does; read one of those tests first):

- **`there are 45 rows, numbered 1 to 45, each with a check`.**
- **`the smoke rows are exactly the listed ones`.**
- **`every kind a row reads is written somewhere in scripts`.** For each `KINDS` value, a grep of `scripts/**/*.js` finds the literal `'<kind>'`.
- **`row 29 passes on a self-merge for internal and fails on another reason`.**
- **`row 28 fails when a visible piece self-merged`.**
- **`row 16 needs the waiting status and no merge`.** Fixture `prs[0].statuses` has `{context: 'wheelhouse/decision', description: 'Waiting on decision 1'}` and no `mergedAt` before the answer: pass. With a merge before it: fail.
- **`row 18 needs where chat and label B`.** `where: 'card'` fails.
- **`row 25 lists the missing headings`.** A body without "Decisions followed" fails with that heading in `evidence`.
- **`row 26 is not covered without previews`.** `previews: 'none'` gives `pass: null`.
- **`row 34 reports a lost row as a finding`.** Recovered within 10 minutes plus a `lost` row gives pass, with `evidence` matching `/lost/`.
- **`row 45 fails on an offender and names its role`.**
- **`smoke checkAll leaves out full-only rows`.** Rows 34 and 41 are absent.

`results.test.js`:

- **`runFolder is under .wheelhouse-trials`.**
- **`writeSummary has the six sections and labels each failure`.**
- **`writeSummary leaves out transcript text and paths outside the repository`.** Given `rows` whose `evidence` includes `/Users/someone/x` and a transcript line, the markdown contains neither.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/probes/haiku-trial/signals.test.js tests/probes/haiku-trial/results.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`gatherContext` calls `gh api` through the injected `gh(args) -> json`:
- `repos/{o}/{r}/pulls?state=all`;
- `…/pulls/{n}/commits`;
- `…/commits/{sha}/statuses`;
- `…/actions/runs`.

Before writing any row that reads an engine event, read the module that writes it and copy the kind and field names into `KINDS`. Start from `scripts/engine/` and `scripts/watcher/`.

- [ ] **Step 4: Run the tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add probes/haiku-trial/signals.js probes/haiku-trial/results.js tests/probes/haiku-trial
git commit -m "Add the Haiku trial's 45 signal rows and its results writer"
```

---

### Task 7: Runner, review card, staged plugin and README

**Files:**
- Create:
  - `probes/haiku-trial/runner.js`
  - `probes/haiku-trial/review-card.js`
  - `probes/haiku-trial/stage-plugin.js`
  - `probes/haiku-trial/README.md`
- Test:
  - `tests/probes/haiku-trial/runner.test.js`
  - `tests/probes/haiku-trial/review-card.test.js`
  - `tests/probes/haiku-trial/stage-plugin.test.js`

**Interfaces:**
- Consumes: every earlier task's exports.
- Produces:
  - `stagePlugin({repo, out}) -> {pluginDir, marketplaceDir}`.
    - It runs `git archive HEAD` with `:(exclude)probes` and `:(exclude)tests` into `out/plugin`.
    - It calls `makeScratchMarketplace({name: 'wheelhouse-trial', plugins: [{name: 'wheelhouse', source: pluginDir}]})`.
    - It installs nothing.
  - `installCommand({marketplaceDir, configDir}) -> string[][]`: the `claude plugin marketplace add` and `claude plugin install` lines for a run to execute after the go.
  - `reviewCard({project, date, decisionN, stepsUrl}) -> {title, text, options}`.
    - `title === 'Check the spending tracker Wheelhouse built on Haiku'`.
    - `options` are A "Tag it as working on Haiku", B "Tag it without the claim and record the floors" and C "Hold the tag".
    - It has a recommendation and a meanwhile.
    - The text is at most 1,400 characters and 18 lines.
  - `stepsPage({decisionN}) -> markdown`: "Show the steps", the nine steps of §11 in order, with `added 41, skipped 0` and `added 0, skipped 41`.
  - `writeTryMe(dir)` writes `try-me.csv` from `TRY_ME`.
  - `STEPS: Array<{id, wave, smoke: boolean, needsGo?: true, director?: true, after?: string, run(ctx, io)}>`, in order. Each `id` is unique. Each is one of:
    - `stage`, `create-repo`, `create-preview`, `install`, `seed`, `setup-s0`, `front-desk`;
    - `w2-type`, `f3-kill-p1`, `w2-merge-wait`;
    - `w3-type`, `f1`, `f1b`, `f1c`, `f6-stop`, `f6-undo`, `f6-wait-5m`, `f6-lift`, `f5a-undo-p6`, `w3-merge-wait`;
    - `w4-type`, `f4-check`, `f3b-kill-foreman`, `s9-1`, `s9-2`, `s9-3`, `s9-4`, `s9-5`, `s9-6`, `f5b-undo-p2`, `pull-back`, `digest`, `w4-merge-wait`;
    - `w5-incident`, `w5-midnight`;
    - `score`, `signals`, `results`, `review-card`.
  - Which steps carry flags:
    - `smoke: true`: `stage`, `create-repo`, `install`, `seed`, `setup-s0`, `front-desk`, `w2-type`, `f3-kill-p1`, `w2-merge-wait`, the P4 part of `w4-type` (smoke types P4 only), `s9-1`, `s9-2`, `s9-4`, `score`, `signals` and `results`.
    - `needsGo: true`: `create-repo`, `create-preview` and `install`.
    - `director: true`: `create-preview` (the sign-in), `f5a-undo-p6`, `f5b-undo-p2`, `f6-lift` (only when the runner can't click it) and `review-card`.
  - `planRun({mode: 'full' | 'smoke'}) -> STEPS[]`, filtered and in order.
  - `run({mode, io, from}) -> Promise<{done: string[], stoppedAt?: string, why?}>`.
    - `io` is `{tmux, gh, clock, signals, faults, score, results, ask(text) -> Promise<answer>, log}`.
    - A `needsGo` step calls `io.ask` and stops the run unless the answer is `go`.
    - Each step appends `{at, step, note}` to `<run folder>/run-log.jsonl` (`appendJsonl` from `probes/lib/log.js`), so `from` can resume after the last completed step.
  - `waitFor(predicate, {io, timeoutMs, everyMs = 15000}) -> Promise<boolean>`.
  - Planted bug fixed early. After `w2-merge-wait`, the runner checks the main branch's `parseAmount('(40.00)')`. If it is negative already:
    - it logs `planted bug fixed early`;
    - it runs `applySpareBug` on a branch, merges it by `gh` before `w3-type`, and types `P5_SPARE` instead of P5's text;
    - if `applySpareBug` returns `applied: false`, it marks P5 `not covered` with the `why`.
  - `restore({folder, io}) -> {stopped: string[]}`.
    - It reads `run-log.jsonl` for what this run started: tmux sessions named `haiku-trial-*`, the product pid, and the tunnel pid.
    - It stops only those.
    - It deletes nothing: no repository, project or folder.
  - CLI: `node probes/haiku-trial/runner.js full | smoke | restore | plan [--from <step>] [--out <folder>]`.
    - `plan` prints the steps and spends nothing.

- [ ] **Step 1: Write the failing tests**

`runner.test.js` (all with a fake `io` that records calls):

- **`full plan follows the waves`.**
  - Every `w2-*` step comes before every `w3-*`, and so on through W6.
  - `f6-lift` comes before `f5a-undo-p6`.
  - `w3-type` comes after `w2-merge-wait`.
- **`smoke plan is section 14`.**
  - `planRun({mode: 'smoke'}).map(s => s.id)` contains `setup-s0`, `w2-type`, `f3-kill-p1`, `s9-1`, `s9-2`, `s9-4` and `score`.
  - It contains none of `f1`, `f6-stop`, `f5a-undo-p6`, `s9-5`, `w5-midnight` or `review-card`.
- **`steps that create things wait for go`.**
  - With `io.ask` answering `not yet`, the run stops at `create-repo`.
  - `gh` was never called with `repo create`.
  - `done` has only `stage`.
- **`a run resumes after the last logged step`.** With a run log ending at `w2-type`, `run({from: 'auto'})` starts at `f3-kill-p1`.
- **`f3 fires only after P1's first commit`.** A fake `gh` reports no commits on P1's branch for two polls, then one; the kill is called once, after the third poll.
- **`planted bug fixed early switches P5 to the spare bug`.**
  - Fake main has a negative `parseAmount('(40.00)')`.
  - The log has `planted bug fixed early`.
  - `applySpareBug` is called.
  - The text typed in `w3-type` includes `P5_SPARE` and not `A $40 refund`.
- **`spare bug that cannot apply marks P5 not covered`.**
- **`f6 waits five minutes with no new start`.** A fake clock advances; `f6-lift` is not reached before 300,000 ms after `f6-stop`.
- **`restore stops only what the run recorded`.**
  - Given a log with tmux `haiku-trial-desk` and product pid 4242, and a fake `tmux.list()` that also returns `other-session`:
    - only `haiku-trial-desk` is killed;
    - only pid 4242 gets a signal;
    - nothing is deleted.
- **`plan prints steps and calls nothing`.**

`review-card.test.js`:

- **`card fits the phone limit`.** `text.length <= 1400` and `text.split('\n').length <= 18`.
- **`card has the title, three options, a recommendation and a meanwhile`.**
- **`steps page has the nine steps with the import counts`.**
- **`try-me has 41 rows and no duplicates`.**

`stage-plugin.test.js`:

- **`staged plugin leaves out probes and tests`.** On a temp clone of this checkout (`git clone --local`), `pluginDir` has `scripts/`, `skills/` and `.claude-plugin/`, and no `probes/` or `tests/`.
- **`stagePlugin installs nothing`.** A fake `run` sees no `claude` call.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/probes/haiku-trial/runner.test.js tests/probes/haiku-trial/review-card.test.js tests/probes/haiku-trial/stage-plugin.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

**`runner.js`:**
- It is a top-level CLI. Its real `io` is built only inside `main()`.
- It reads `HAIKU_TRIAL_CLAUDE`, the full path to `claude`.
- It reads `HAIKU_TRIAL_GH_OWNER`, the account for the test repository, created at run time after the go.
- It reads `HAIKU_TRIAL_PREVIEW`, one of `vercel`, `tunnel` or `none`.

**`README.md`:**
- what the kit is;
- full against smoke;
- what needs the director's go: the GitHub repository, the Vercel project or tunnel, the staged plugin install, and Haiku usage;
- the director's three steps (§7);
- `restore`;
- where results go.

- [ ] **Step 4: Run the tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add probes/haiku-trial tests/probes/haiku-trial
git commit -m "Add the Haiku trial runner, review card and staged plugin"
```

---

## Self-review against the spec

1. **Coverage.**

   | Spec section | Task |
   |---|---|
   | §1 three passing conditions | `passBar` (Task 3), the review card (Task 7) and the signal rows (Task 6) |
   | §4 Haiku everywhere | `setup-s0` with `WHEELHOUSE_SETUP_MODEL=haiku` and `frontDeskCommand` (Tasks 5 and 7), the seed settings (Task 1), the audit (Task 4), row 1 (Task 6) |
   | §5.2–5.4 seed and product | Task 1, and the request texts' contract strings |
   | §5.5 previews | `create-preview` with three modes, and row 26's `null` (Tasks 6 and 7) |
   | §6 all 45 rows | Task 6 |
   | §7 waves | `WAVES` and `STEPS` (Tasks 1 and 7) |
   | §8 faults | Task 5, and their timing in Task 7 |
   | §9 steps 1–6 | `s9-*` (Task 7), rows 16–21 and 31 (Task 6) |
   | §9 step 7 | the review card (Task 7) |
   | §10.1–10.7 | Tasks 2 and 3 |
   | §11 | Task 7 |
   | §12 | `results.js` (Task 6) |
   | §13 out of scope | nothing built for it |
   | §14 smoke | `planRun('smoke')` and `scoreAll({smoke})` |

   The step 9 names were checked against #396 (see Global Constraints).

2. **Step scan.**
   - Every test step names its assertions with the spec's values.
   - The places where an implementer must read existing code first are named: engine event kinds, CLI flags, transcript paths and the state fixture helpers. Each such step has a test that fails on a wrong guess (the `KINDS` grep test, and the CLI run against the real feature CLI).
3. **Type consistency.**
   - `makeStatement` returns `expected` in cents, everywhere.
   - `startProduct` is used by `runHeldBack`, `runAcceptance`, `reconcile`, `a11y` and `health` with the same signature.
   - `ctx` is built only by `gatherContext`.
   - `canonical` is applied in `totalsOf`, so `dining` and `eating_out` agree.
4. **Review Focus.** Each of the five lines has its named test in its owning task.
5. **Proportion.** About 1,000 lines against the spec's 549. There are no function bodies, apart from the request texts, which are copy the spec's contract fixes.
