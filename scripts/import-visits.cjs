const fs = require('node:fs');
const readline = require('node:readline');
const {createGunzip} = require('node:zlib');
const {DatabaseSync} = require('node:sqlite');
const games = require('../shared/server/analytics-games.cjs');

const hosts = new Map(games.map(game => [game.hostname, game.id]));
const mainPages = {root: 'home', index: 'lobby', tools: 'tools', puzzle: 'puzzle', beads: 'beads', notes: 'notes'};

function beijingDay(ms) {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

async function importVisits(file, logs) {
  if (!file || !logs.length) throw new Error('用法：node scripts/import-visits.cjs 私有访问库 日志文件 [更多日志或 .gz]');
  const db = new DatabaseSync(file);
  fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, day TEXT NOT NULL, page TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS visits_day_page ON visits(day,page);`);
  const insert = db.prepare('INSERT OR IGNORE INTO visits VALUES (?, ?, ?)');
  let added = 0;
  let malformed = 0;
  try {
    for (const log of logs) {
      const source = fs.createReadStream(log);
      const input = log.endsWith('.gz') ? source.pipe(createGunzip()) : source;
      if (source !== input) source.on('error', error => input.destroy(error));
      const lines = readline.createInterface({input, crlfDelay: Infinity});
      let batch = 0;
      db.exec('BEGIN');
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          let row;
          try { row = JSON.parse(line); } catch { malformed++; continue; }
          const ms = Date.parse(row?.at);
          if (!/^[a-f0-9]{32}$/i.test(row?.id) || !Number.isFinite(ms)) { malformed++; continue; }
          const page = row.host === 'zillionx.xyz' && Object.hasOwn(mainPages, row.entry)
            ? mainPages[row.entry] : ['index', 'root'].includes(row.entry) && hosts.get(row.host);
          if (!page) continue;
          added += insert.run(row.id, beijingDay(ms), page).changes;
          if (++batch === 2000) { db.exec('COMMIT; BEGIN'); batch = 0; }
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      finally { lines.close(); source.destroy(); }
    }
  } finally { db.close(); }
  return {added, malformed};
}

module.exports = {importVisits, beijingDay};
if (require.main === module) importVisits(process.argv[2], process.argv.slice(3))
  .then(result => { console.log(result); if (result.malformed) process.exitCode = 1; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
