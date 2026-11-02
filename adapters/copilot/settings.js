// adapters/copilot/settings.js
// The adapter's settings part (design section 8.1): the sandbox settings for a Copilot project. Nothing is written
// into a project (the documentation says sandbox settings are not supported in repository-level files); the writer
// is the clean home's (scripts/agents/copilot/engine-home.js). `local` holds nothing of the person's.
import { sandboxSettings } from './sandbox.js';

export default Object.freeze({
  project: (options) => sandboxSettings(options),
  local: () => ({}),
});
