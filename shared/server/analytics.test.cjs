const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {gzipSync} = require('node:zlib');
const {DatabaseSync} = require('node:sqlite');
const {importVisits} = require('../../scripts/import-visits.cjs');
const {createSqliteRoomStore} = require('./sqlite-room-store');
const games = require('./analytics-games.cjs');
const {collect, render} = require('../../scripts/analytics-report.cjs');
const startServer = require('./start-authoritative-game-server');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tablegame-stats-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return dir;
}

test('visit import handles Beijing midnight, main site rewrite, rotated duplicates and off-site hosts', async t => {
  const dir = temporary(t);
  const file = path.join(dir, 'visits.db');
  const log = path.join(dir, 'access');
  const rows = [
    ['zillionx.xyz','root'], ['zillionx.xyz','index'], ['kttz.zillionx.xyz','index'],
    ['jo.zillionx.xyz','root'], ['zillionx.xyz','beads'], ['foo.invalid','index']
  ].map(([host,entry], i) => JSON.stringify({host,entry,id:String(i).padStart(32,'0'),
    at:i === 0 ? '2026-11-25T15:59:59Z' : '2026-11-25T16:00:00Z'})).join('\n');
  fs.writeFileSync(log, rows);
  fs.writeFileSync(log+'.gz', gzipSync(rows));
  assert.deepEqual(await importVisits(file, [log,log+'.gz']), {added:4,malformed:0});
  const db = new DatabaseSync(file);
  try { assert.deepEqual(db.prepare('SELECT day,page FROM visits ORDER BY id').all().map(r => [r.day,r.page]),
    [['2026-11-25','home'],['2026-11-26','lobby'],['2026-11-26','yacht'],['2026-11-26','beads']]); }
  finally { db.close(); }
});

test('visit reports preserve old counts and classify new requests once across sites and periods', async t => {
  const dir = temporary(t);
  const file = path.join(dir, 'visits.db');
  const log = path.join(dir, 'visits.log');
  const now = Date.parse('2026-11-28T12:00:00+08:00');
  const id = n => String(n).padStart(32,'0');
  const legacy = new DatabaseSync(file);
  legacy.exec('CREATE TABLE visits (id TEXT PRIMARY KEY, day TEXT NOT NULL, page TEXT NOT NULL)');
  for (const n of [1,2]) legacy.prepare("INSERT INTO visits VALUES (?, '2026-11-28','yacht')").run(id(n));
  legacy.close();
  assert.equal(collect(file, now, {}).periods[0].visits.unknown, 2);
  function entry(n, host, audience, day='28') {
    return JSON.stringify({id:id(n), host, audience, entry:'root', at:`2026-11-${day}T10:00:00+08:00`});
  }
  const game = 'kttz.zillionx.xyz';
  const lines = [entry(1,game), entry(2,game,'developer'), entry(3,game,'external'),
    entry(4,'zillionx.xyz','external'), entry(5,game,'external','08')].join('\n');
  fs.writeFileSync(log, lines);
  fs.writeFileSync(log+'.gz', gzipSync(lines));
  assert.deepEqual(await importVisits(file,[log,log+'.gz']), {added:3,malformed:0});
  const data = collect(file, now, {});
  const [week,month] = data.periods;
  assert.deepEqual(week.visits, {total:4,external:2,developer:1,unknown:1});
  assert.deepEqual(data.daily.at(-1).visits,week.visits);
  assert.deepEqual(month.visits, {total:5,external:3,developer:1,unknown:1});
  assert.deepEqual(week.pages.home, {total:1,external:1,developer:0,unknown:0});
  assert.deepEqual(week.games.find(g=>g.id==='yacht').visits, {total:3,external:1,developer:1,unknown:1});
  assert.match(render(data), /快艇骰子<\/th><td>3<\/td><td>1<\/td><td>1<\/td><td>1<\/td>/);
});

for (const [folder,game] of [['game3','yacht'],['game13','cabo']]) {
  test(game+' counts a real complete game, recovery, replay, manual end and room expiry', async t => {
    const engine = await import('../../'+folder+'/server/game-engine.mjs');
    const filename = path.join(temporary(t),'game.sqlite');
    const open = () => {
      const store = createSqliteRoomStore({filename});
      store.enableAnalytics(game);
      return store;
    };
    let store = open();
    const player = id => ({id, name:id, connected:true});
    let state = engine.createLobby({capacity:2,host:player('a')});
    let now = 1000;
    const save = cause => store.saveRoom('ABCD',{state,updatedAt:++now,createdAt:1000},cause);
    const act = (id, type, extra={}) => {
      engine.applyAction(state,id,{type,...extra},{now,random:()=>0.37});
      save('action:'+type);
    };
    save('create');
    assert.throws(() => act('a','start'));
    engine.addPlayer(state,player('b'));
    act('a','start');
    store.close();
    store = open();
    state = store.loadRooms()[0].snapshot.state;
    save('restore');
    if (game === 'yacht') {
      const {CATEGORIES} = await import('../../game3/rules.mjs');
      for (const {id:category} of CATEGORIES) for (const id of ['a','b']) {
        act(id,'roll'); act(id,'score',{category});
      }
    } else {
      for (let round=0; state.phase !== 'ended' && round < 20; round++) {
        if (round) act('a','start');
        for (const p of state.players) act(p.id,'initialPeek',{slotIds:p.slots.slice(0,2).map(s=>s.slotId)});
        now += 6000;
        engine.handleTimeout(state,{now}); save('timeout');
        const first = state.players[state.currentIndex].id;
        act(first,'callCabo');
        const other = state.players[state.currentIndex].id;
        act(other,'drawDeck'); act(other,'discardDrawn');
        if (!round) assert.equal(state.phase,'roundEnd');
      }
    }
    assert.equal(state.phase,'ended');
    save('restore');
    act('a',game === 'yacht' ? 'restart' : 'end');
    act('a','start'); act('a','end');
    act('a','start'); store.deleteRoom('ABCD'); store.close();
    const db = new DatabaseSync(filename);
    try {
      assert.deepEqual(db.prepare('SELECT outcome,seats FROM analytics_matches ORDER BY rowid').all().map(r=>[r.outcome,r.seats]),
        [['completed',2],['interrupted',2],['expired',2]]);
      assert.equal(db.prepare('SELECT count(*) n FROM analytics_rooms WHERE live_code IS NULL').get().n,1);
    } finally { db.close(); }
  });
}

test('the reporting registry covers every listed lobby id and production host', () => {
  const source = fs.readFileSync(path.resolve(__dirname,'../../homepage/lobby/app.js'),'utf8');
  const listed = [...source.matchAll(/\bid:\s*"([^"]+)"\s*,\s*host:\s*"([^"]+)"/g)]
    .map(([,id,host])=>id+' '+host+'.zillionx.xyz').sort();
  assert.deepEqual(games.map(g=>g.id+' '+g.hostname).sort(),listed);
});

test('cohorts distinguish replay, intermediate rounds, old snapshots and reused codes', async t => {
  const dir = temporary(t);
  const now = Date.parse('2026-11-27T12:00:00+08:00');
  const start = Date.parse('2026-11-26T23:59:55+08:00');
  const scenarios = [
    ['bull','selecting','roundEnd','gameEnd'], ['rummy','playing','gameEnd','matchEnd'],
    ['insider','questioning','discussion','roundEnd'], ['spy','questioning','roundEnd','roundEnd'],
    ['criminal','turn','roundReview','ended'], ['words','playing','playing','ended']
  ];
  const env = Object.fromEntries(games.map(g=>[g.directory.toUpperCase()+'_DB_PATH',path.join(dir,g.id)]));
  for (const [game,playing,between,end] of scenarios) {
    const store = createSqliteRoomStore({filename:path.join(dir,game)});
    store.enableAnalytics(game);
    let clock = start;
    function save(phase,cause,matchComplete=false) {
      const state = {phase,matchComplete,players:[{},{},{}]};
      store.saveRoom('TEST',{createdAt:start,updatedAt:clock++,state},cause);
    }
    save(playing,'restore'); save(end,'timeout',true); store.deleteRoom('TEST');
    save('lobby','create'); save(playing,'action:start'); save(between,'timeout');
    clock += 6000;
    save(end,game==='words' ? 'action:end' : 'timeout',true); save(playing,'action:restart');
    save('lobby','kick'); store.deleteRoom('TEST');
    save('lobby','create'); store.close();
  }
  const visits = path.join(dir,'visits.db');
  const report = collect(visits,now,env);
  for (const p of report.periods) for (const [id] of scenarios) {
    assert.deepEqual(p.games.find(g=>g.id===id).stats, {
      rooms:2,opened:1,eligible:1,replay:1,matches:2,seats:6,completed:1,interrupted:1,expired:0,ongoing:0
    });
  }
  assert.deepEqual(report.daily.slice(-2).map(d=>d.starts),[6,6]);
  assert.equal(report.hasVisits,false);
  assert.match(render(report),/对局数据 6\/21 款/);
});

test('a failed analytics write rolls back the room snapshot; default store collects nothing', t => {
  const filename = path.join(temporary(t),'atomic.db');
  const store = createSqliteRoomStore({filename});
  const db = new DatabaseSync(filename);
  try {
    const lobby = {state:{phase:'lobby',players:[{}]},createdAt:1,updatedAt:1};
    store.saveRoom('TEST',lobby,'create');
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='analytics_matches'").get().n,0);
    store.enableAnalytics('yacht');
    store.saveRoom('TEST',lobby,'restore');
    db.exec("CREATE TRIGGER fail_match BEFORE INSERT ON analytics_matches BEGIN SELECT RAISE(ABORT,'rollback test'); END");
    assert.throws(()=>store.saveRoom('TEST',{...lobby,state:{phase:'playing',players:[{},{}]}},'action:start'),/rollback test/);
    assert.equal(store.loadRooms()[0].snapshot.state.phase,'lobby');
    assert.equal(db.prepare("SELECT stage FROM analytics_rooms").get().stage,'lobby');
  } finally { db.close(); store.close(); }
});

test('production opt-in records HTTP room creation across the catalog and pilot actions exactly once', async t => {
  const dir = temporary(t);
  const oldFlag = process.env.TABLEGAME_ANALYTICS;
  process.env.TABLEGAME_ANALYTICS = '1';
  try {
    for (const game of games) {
      const engine = await import('../../'+game.directory+'/server/game-engine.mjs');
      const filename = path.join(dir,game.id+'.sqlite');
      const db = new DatabaseSync(filename);
      const store = createSqliteRoomStore({filename});
      const server = startServer({gameRoot:path.resolve(__dirname,'../../'+game.directory),engine,roomStore:store,defaultPort:0});
      await new Promise(resolve=>server.once('listening',resolve));
      const base = 'http://127.0.0.1:'+server.address().port;
      async function post(route,body) {
        const res = await fetch(base+route,{method:'POST',body:JSON.stringify(body)});
        const result = await res.json();
        assert.equal(res.status,200,game.id+' '+JSON.stringify(result.error));
        return result;
      }
      const streams = [];
      try {
        let capacity;
        for (let n=2;n<=10;n++) {
          try { engine.createLobby({capacity:n,host:{id:'a',name:'甲'}}); capacity=n; break; }
          catch { /* Try the next supported party size. */ }
        }
        const host = await post('/api/rooms',{hostId:'a',name:'甲',capacity});
        assert.equal(db.prepare('SELECT count(*) n FROM analytics_rooms WHERE created_at IS NOT NULL').get().n,1,game.id);
        if (!['yacht','cabo'].includes(game.id)) continue;
        const guest = await post('/api/join',{roomCode:host.roomCode,clientId:'b',name:'乙'});
        for (const session of [host,guest]) {
          const query = new URLSearchParams({clientId:session.clientId,roomCode:host.roomCode,resumeToken:session.resumeToken});
          streams.push(await fetch(base+'/api/events?'+query));
        }
        function action(type) {
          return post('/api/actions',{roomCode:host.roomCode,playerId:'a',resumeToken:host.resumeToken,actionId:type,action:{type}});
        }
        await action('start'); await action('start'); await action('end');
        assert.deepEqual(db.prepare('SELECT outcome,seats FROM analytics_matches').all().map(r=>[r.outcome,r.seats]),[['interrupted',2]]);
      } finally {
        await new Promise(resolve=>{ server.close(resolve); server.closeAllConnections(); });
        for (const stream of streams) await stream.body.cancel().catch(()=>{});
        db.close();
      }
    }
  } finally {
    if (oldFlag === undefined) delete process.env.TABLEGAME_ANALYTICS;
    else process.env.TABLEGAME_ANALYTICS = oldFlag;
  }
});
