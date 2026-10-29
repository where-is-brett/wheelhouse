# probes/77-archon-skills/task/check.sh
# The done check: the whole suite passes, and formatPrice gives the receipts' examples.
set -e
bun test >/dev/null 2>&1 || { echo "suite fails"; exit 1; }
bun run checks/price.ts
