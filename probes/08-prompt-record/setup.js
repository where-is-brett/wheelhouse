// probes/08-prompt-record/setup.js
// Check 8: makes a scratch project whose hooks log every director message
// and every answer to a clickable question, and prints its folder.
import { fileURLToPath } from 'node:url';
import { makeScratchProject } from '../lib/scratch.js';

const logger = fileURLToPath(new URL('../lib/hook-logger.js', import.meta.url));
const hook = (event) => [{ type: 'command', command: `node "${logger}" 08-prompt-record ${event}` }];

const project = await makeScratchProject({
  name: 'prompt-record',
  settings: {
    hooks: {
      UserPromptSubmit: [{ hooks: hook('UserPromptSubmit') }],
      PostToolUse: [{ matcher: 'AskUserQuestion', hooks: hook('PostToolUse') }],
    },
  },
});
console.log(project.dir);
