// scripts/make-statement.js
// Prints a small example statement. Usage: node scripts/make-statement.js [file]
import fs from 'node:fs';

const lines = [
  'Date,Description,Amount',
  '03/08/2026,Greenbarrow Fresh REF 1021,54.20',
  '07/08/2026,Kestrel Coffee Bar,6.50',
  '12/08/2026,Brightfield Power,121.00',
  '19/08/2026,Marlowe Homewares,(40.00)',
  '25/08/2026,Brightwave Payroll,-2100.00',
];
const text = lines.join('\r\n') + '\r\n';

if (process.argv[2]) fs.writeFileSync(process.argv[2], text);
else process.stdout.write(text);
