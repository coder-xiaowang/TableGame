const {randomUUID} = require('node:crypto');

function stage(game, state) {
  if (state.phase === 'lobby') return 'lobby';
  if (game === 'bull' && state.phase === 'gameEnd') return 'finished';
  if (game === 'rummy' && state.phase === 'matchEnd') return 'finished';
  if (game === 'insider' && state.phase === 'roundEnd') return 'finished';
  if (game === 'spy' && state.phase === 'roundEnd' && state.matchComplete) return 'finished';
  return state.phase === 'ended' ? 'finished' : 'playing';
}

// Stored in the same database and transaction as the authoritative snapshot.
// Only live tables retain the reusable room code. Historical joins use random ids.
function matchAnalytics(db, game) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_rooms (
      id TEXT PRIMARY KEY, live_code TEXT UNIQUE, created_at INTEGER, stage TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analytics_matches (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES analytics_rooms(id),
      started_at INTEGER NOT NULL, seats INTEGER NOT NULL, ended_at INTEGER, outcome TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS analytics_current ON analytics_matches(room_id) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS analytics_match_room ON analytics_matches(room_id, started_at);
    CREATE INDEX IF NOT EXISTS analytics_match_date ON analytics_matches(started_at);
    CREATE INDEX IF NOT EXISTS analytics_room_date ON analytics_rooms(created_at);
  `);
  const live = db.prepare('SELECT id, stage FROM analytics_rooms WHERE live_code=?');
  const register = db.prepare('INSERT INTO analytics_rooms VALUES (?,?,?,?)');
  const update = db.prepare('UPDATE analytics_rooms SET stage=? WHERE id=?');
  const start = db.prepare('INSERT INTO analytics_matches VALUES (?,?,?,?,NULL,NULL)');
  const finish = db.prepare('UPDATE analytics_matches SET ended_at=?, outcome=? WHERE room_id=? AND ended_at IS NULL');
  const retire = db.prepare('UPDATE analytics_rooms SET live_code=NULL WHERE id=?');
  return {
    save(code, snapshot, cause) {
      const next = stage(game, snapshot.state);
      const room = live.get(code);
      if (!room) {
        // A restored pre-installation match has no observed start. Wait for its next game.
        register.run(randomUUID(), code, cause === 'create' ? snapshot.createdAt : null, next);
        return;
      }
      if (next === room.stage) return;
      const now = snapshot.updatedAt;
      if (next === 'playing') start.run(randomUUID(), room.id, now, snapshot.state.players.length);
      if (room.stage === 'playing') {
        // 我话你猜 is an open-ended score session. Host settlement is its normal ending.
        const interrupted = cause === 'presence' || cause === 'kick' || (cause === 'action:end' && game !== 'words');
        const completed = next === 'finished' && !interrupted;
        finish.run(now, completed ? 'completed' : 'interrupted', room.id);
      }
      update.run(next, room.id);
    },
    expire(code, now) {
      const room = live.get(code);
      if (room) { finish.run(now, 'expired', room.id); retire.run(room.id); }
    }
  };
}

module.exports = {matchAnalytics};
