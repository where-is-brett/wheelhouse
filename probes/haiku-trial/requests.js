// probes/haiku-trial/requests.js
// The director's words for each piece, with the lane, waves and path rows they exercise.
import { CATEGORIES, MERCHANTS } from './statement.js';

export const P5_SPARE = 'A payment on 31 August shows under September';
export const F2_ANSWER = 'No, nobody sees this';

const keysAndLabels = CATEGORIES.map((c) => `${c.key} (${c.label})`).join(', ');
const shops = MERCHANTS.map((m) => `${m.name} → ${m.category}`).join('; ');

const P1 =
  "Let me upload my bank statement and see it imported. Add a page at /import with a file upload field named `statement`. The statement is a CSV with the columns Date, Description, Amount; dates are DD/MM/YYYY, and an amount in brackets or with a minus sign is money coming back. Read amounts with `parseAmount` in src/lib/money.js and dates with `parseDate` in src/lib/dates.js. A duplicate has the same date, description and amount as a stored row: skip it. After an upload the page says 'Added n, skipped n' with the counts, so importing the same file twice adds nothing. A file that isn't a statement gets a plain error and adds nothing. The home page lists each month that has transactions, newest first, each linking to /month?m=YYYY-MM. Keep reading the port from PORT and the database path from LEDGER_DB, which can be `:memory:`.";

const P2 = `Sort transactions into categories by shop name. Put the rules in src/lib/categories.js with these category keys and labels: ${keysAndLabels}. A description belongs to a shop when it contains the shop name, ignoring case. The shops are: ${shops}. A description that matches no shop is \`other\`.`;

const P3 =
  'A page per month with totals by category and change from last month. Build it in two slices: first the totals, then the change. The page is /month?m=YYYY-MM; work out a transaction\'s month with `monthOf` in src/lib/dates.js. Show a row per category with its total and the change from the month before, and a grand total of every category, with money back and income counted as negative. Each total cell carries `data-category` (the category key) and `data-total` (a plain decimal such as 1234.50 or -40.00); the grand total\'s cell has `data-category="all"`. Link to the previous and next months.';

const P4 =
  'Let me move a transaction to a different category. On the month page, list that month\'s transactions, each linking to /edit?id=<id>. The edit page has a form that posts to /edit with a hidden `id` and a select `name="category"` with a label, whose options are the category keys; after saving, go back to that month.';

const P5 = 'A $40 refund shows as spending';
const P6 = 'Make CI also run on Node 24';
const P7 =
  "A button to download this month as a spreadsheet. Put a link 'Download this month' on the month page, going to /export?m=YYYY-MM, which sends a CSV named spending-YYYY-MM.csv with the header Date,Description,Amount,Category and that month's transactions.";
const P8 =
  "Rename the category key 'eating_out' to 'dining' in src/lib/categories.js, and touch nothing else. Nobody sees this.";

export const PIECES = [
  { id: 'P1', wave: 2, lane: 'feature', visible: true, rows: [3, 7, 8, 10, 25, 26, 27, 28], text: P1 },
  { id: 'P2', wave: 2, lane: 'small', visible: true, rows: [5, 10, 22, 28], text: P2 },
  { id: 'P3', wave: 3, lane: 'feature', visible: true, rows: [7, 11, 22, 25, 26, 28], text: P3 },
  { id: 'P4', wave: 4, lane: 'small', visible: true, rows: [13, 16, 17, 18, 31, 43], text: P4 },
  { id: 'P5', wave: 3, lane: 'bug', visible: false, rows: [6], text: P5 },
  { id: 'P6', wave: 2, lane: 'quick', visible: false, rows: [4, 29], text: P6 },
  { id: 'P7', wave: 4, lane: 'small', visible: true, rows: [12, 26, 28], text: P7 },
  { id: 'P8', wave: 3, lane: 'small', visible: false, rows: [30], text: P8 },
];

export const WAVES = { 1: ['S0'], 2: ['P1', 'P2', 'P6'], 3: ['P3', 'P5', 'P8'], 4: ['P4', 'P7'], 5: [], 6: [] };
