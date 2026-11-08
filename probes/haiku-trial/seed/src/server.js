// src/server.js
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.env.PORT ?? 3000);
const db = new DatabaseSync(process.env.LEDGER_DB ?? 'ledger.db');
db.exec(
  'CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, date TEXT, description TEXT, cents INTEGER)',
);

function page(body) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Spending tracker</title></head>
<body>
<main>
<h1>Spending tracker</h1>
${body}
</main>
</body>
</html>
`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM transactions').get();
    const body = n === 0 ? '<p>Nothing imported yet</p>' : `<p>${n} transactions imported</p>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page(body));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`listening on ${server.address().port}`);
});
