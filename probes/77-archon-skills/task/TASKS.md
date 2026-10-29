<!-- probes/77-archon-skills/task/TASKS.md -->
# Tasks for the loop

Do the first unticked task only, then tick it and commit.

- [ ] `formatPrice(amount)` in `src/price.ts`: `1234.5` gives `$1,234.50`, `0` gives `$0.00`, `-5` gives `-$5.00`.
- [ ] `parsePrice(text)` in `src/price.ts`: the reverse of `formatPrice`; `'$1,234.50'` gives `1234.5`, `'-$5.00'` gives `-5`.
- [ ] `splitBill(total, people)` in `src/bill.ts`: splits a total into cents-exact shares, the extra cents going to the first people; `splitBill(10, 3)` gives `[3.34, 3.33, 3.33]`.
