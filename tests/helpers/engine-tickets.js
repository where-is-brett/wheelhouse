// tests/helpers/engine-tickets.js
// The engine routes as a run's own steps call them: '/engine/start' is the helper's own start (no route starts a run),
// and every other route's call carries the ticket the helper wrote into the run's artefacts folder.
import fs from 'node:fs';
import path from 'node:path';
import { TICKET_FILE } from '../../scripts/engine/ticket.js';

export function ticketedRoutes(made, engine, repo) {
  const ticketOf = (runId) => {
    try {
      return fs.readFileSync(path.join(engine.artefactsOf(runId, repo), TICKET_FILE), 'utf8').trim();
    } catch {
      return undefined;
    }
  };
  const routes = { '/engine/start': made.start };
  for (const [name, route] of Object.entries(made.routes)) {
    routes[name] = (body = {}) => {
      const ticket = ticketOf(body?.runId);
      return route(ticket ? { ...body, ticket } : body);
    };
  }
  return { ...made, routes };
}
