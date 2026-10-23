// adapters/copilot/sessions.js
// How Copilot sessions are started: not built yet (the plan's Part 7). The project's session registry
// (scripts/agents/project-agent.js) and the adapter hold this very object, so the waker and the foreman's
// start find a plain answer, NOT_BUILT_YET, where Copilot is the project's agent. It imports only the
// contract, so the waker and the registry can both load it without a cycle.
import { pendingPart } from '../../scripts/agents/contract.js';

export default pendingPart('sessions', ['checkFeature', 'foremanCall', 'featureStartCall', 'featureResumeCall', 'finalAnswer']);
