// tests/helpers/outside-tests.js
// A run (scripts/lib/run.js) for a project's own tests, as they run outside this test runner, which marks its child
// processes as its own: a project's `node --test` under it would report to this runner instead of failing.
import { run as realRun } from '../../scripts/lib/run.js';

export const runOutsideTests = (file, args, options = {}) => realRun(file, args, { ...options, env: { ...options.env, NODE_TEST_CONTEXT: null } });
