// adapters/claude-code/settings.js
// The settings each Claude Code project gets: the shared ones (sandbox, deny rules, pins) and this
// computer's own. Both are the protection module's functions, passed on exactly as they are.
import { projectSettings, localSettings } from '../../scripts/protection/settings.js';

export default Object.freeze({ project: projectSettings, local: localSettings });
