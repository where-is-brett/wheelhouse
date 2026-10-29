<!-- probes/77-archon-skills/task/README.md -->
# A small shop library

`src/cart.ts` adds up a cart. The test suite is `bun test`.

## The work

Add `formatPrice(amount: number): string` in `src/price.ts`. It formats an amount in dollars for the shop's
receipts: a dollar sign, thousands separated by commas, always two decimal places, and a minus sign before the
dollar sign for negative amounts. Examples: `1234.5` gives `$1,234.50`, `0` gives `$0.00`, `-5` gives `-$5.00`.

The done check is `sh check.sh`.
