// scripts/agents/copilot/versions.js
// Reads docs/copilot/tested-versions.md, the list of VS Code and Copilot runtime versions Wheelhouse's safety scenarios have been
// run on (design section 6.4, "Versions"). VS Code and its Copilot runtime update every week and can't be pinned, so the front desk
// compares the person's versions with this list and says when theirs haven't been tested yet.
//
// The table's header is `VS Code | Copilot runtime | Tested on | Result`. A row counts only when its Result says it passed.

const cell = (text) => text.trim().replace(/^`+|`+$/g, '').trim();

// The rows of the table in `text`, as { vscode, runtime, testedOn, result }. A line that is not a table row, the header and the
// separator are left out.
function rows(text) {
  const out = [];
  for (const line of String(text ?? '').replaceAll('\r\n', '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.slice(1, -1).split('|').map(cell);
    if (cells.length < 4) continue;
    if (/^:?-+:?$/.test(cells[0])) continue;
    if (cells[0] === 'VS Code' && cells[1] === 'Copilot runtime') continue;
    out.push({ vscode: cells[0], runtime: cells[1], testedOn: cells[2], result: cells[3] });
  }
  return out;
}

// isTested({ vscode, runtime }, text) -> boolean
//   Whether a row of the table names both versions, exactly, and says in its Result that it passed.
export function isTested({ vscode, runtime } = {}, text) {
  if (typeof vscode !== 'string' || typeof runtime !== 'string') return false;
  const wantVscode = cell(vscode);
  const wantRuntime = cell(runtime);
  if (wantVscode === '' || wantRuntime === '') return false;
  return rows(text).some((row) => row.vscode === wantVscode && row.runtime === wantRuntime && /^passed\b/i.test(row.result));
}
