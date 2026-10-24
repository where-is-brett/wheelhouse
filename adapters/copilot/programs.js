// adapters/copilot/programs.js
// What starts Copilot from a shell, for the tool guard's refusal of a nested agent (ruling P8-9): the program's name,
// and the npm package a package runner (npx, npm exec, pnpm dlx, bunx) fetches it as. The guard reads these through
// scripts/agents/programs.js and never names an agent itself. Starting the package's own script through `node` is
// not caught there; the rules' `shell(copilot:*)` deny (permissions.js) and the sandbox stand behind it.
export default Object.freeze({
  programs: Object.freeze(['copilot']),
  packages: Object.freeze(['@github/copilot']),
});
