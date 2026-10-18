# SMV Data Bank
Requires Node.js 22.13+ (no npm install needed). Run: `node server.js` then open http://localhost:3000
First run creates data/smv.db, seeds the 184 records from DATA_BANK.xlsx and a Super Admin: admin@smv.local / Admin@12345
(set ADMIN_PASSWORD before the first run to choose your own; change it right after login). Optional: PORT=8080.
Standard users: view, add, edit, export. Super Admin: also delete, import, users, audit trail, backup/restore.
Put the server behind HTTPS (e.g. a reverse proxy) when used beyond a trusted LAN. Bootstrap, Chart.js and SheetJS load from jsdelivr CDN.
