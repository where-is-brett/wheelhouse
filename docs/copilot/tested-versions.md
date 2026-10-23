<!-- docs/copilot/tested-versions.md -->

# Tested versions of VS Code and Copilot

VS Code and its Copilot runtime update every week, and Wheelhouse can't pin them. So Wheelhouse runs its safety scenarios on its own test computers for each new version, and lists here the versions that have been tested. The front desk compares the versions on a person's computer with this table at setup, and says when theirs haven't been tested yet (`scripts/agents/copilot/versions.js` reads it). An untested version still works; it only means Wheelhouse's safety scenarios haven't been run on it.

A row counts only when its Result says **passed**. Any other Result, or no row, means the pair of versions isn't tested.

| VS Code | Copilot runtime | Tested on | Result |
|---|---|---|---|

Nothing has been tested in VS Code yet: the check that does it (check 70) is held, so the table starts with no rows.
