// probes/58-hook-input/mcp.js
// A stand-in MCP server for check 58: speaks MCP over stdio (one JSON message per line) and offers one tool,
// `echo`, which returns the text it is given. It exists so the probe can see what a Copilot guard is given for
// an MCP tool. It does nothing else and touches no files.
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const TOOL = {
  name: 'echo',
  description: 'Returns the text it is given. Used by a Wheelhouse probe.',
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text to return' } }, required: ['text'] },
};

export function respond(message) {
  if (!message || typeof message !== 'object' || message.id === undefined) return null; // a notification
  const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
  switch (message.method) {
    case 'initialize':
      return reply({ protocolVersion: message.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'wheelhouse-probe-58', version: '0.0.1' } });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: [TOOL] });
    case 'tools/call': {
      if (message.params?.name !== 'echo') return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Unknown tool: ${message.params?.name}` } };
      return reply({ content: [{ type: 'text', text: `echo: ${message.params?.arguments?.text ?? ''}` }] });
    }
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}

export function serve(input = process.stdin, output = process.stdout) {
  const lines = readline.createInterface({ input });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const reply = respond(message);
    if (reply) output.write(JSON.stringify(reply) + '\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
