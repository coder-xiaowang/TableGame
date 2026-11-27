const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const games = require('../shared/server/analytics-games.cjs');
const {beijingDay} = require('./import-visits.cjs');

const dayMs = 86400_000;
const pageNames = {home:'首页', lobby:'桌游大厅', notes:'随笔', tools:'实用工具', puzzle:'拼图', beads:'拼豆图纸工坊'};
function readStats(filename, table, read) {
  if (!fs.existsSync(filename)) return null;
  const db = new DatabaseSync(filename,{readOnly:true});
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) return null;
    return read(db);
  } finally { db.close(); }
}

function gameTotals(db, from, until) {
  const rooms = db.prepare(`SELECT count(*) rooms,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_matches m WHERE m.room_id=r.id)) opened,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_matches m WHERE m.room_id=r.id AND m.outcome='completed')) eligible,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_matches m WHERE m.room_id=r.id AND m.outcome='completed'
      AND EXISTS (SELECT 1 FROM analytics_matches later WHERE later.room_id=r.id AND later.rowid>m.rowid))) replay
    FROM analytics_rooms r WHERE created_at>=? AND created_at<?`).get(from,until);
  const matches = db.prepare(`SELECT count(*) matches, coalesce(sum(seats),0) seats,
    count(*) FILTER (WHERE outcome='completed') completed, count(*) FILTER (WHERE outcome='interrupted') interrupted,
    count(*) FILTER (WHERE outcome='expired') expired, count(*) FILTER (WHERE outcome IS NULL) ongoing
    FROM analytics_matches WHERE started_at>=? AND started_at<?`).get(from,until);
  return {...rooms,...matches};
}

function collect(visitsFile, now=Date.now(), env=process.env) {
  const today = beijingDay(now);
  const until = Date.parse(today+'T00:00:00+08:00') + dayMs;
  const dates = Array.from({length:30}, (_,i)=>beijingDay(until-(30-i)*dayMs));
  const visits = readStats(visitsFile, 'visits', db=>db.prepare(
    'SELECT day,page,count(*) n FROM visits WHERE day BETWEEN ? AND ? GROUP BY day,page'
  ).all(dates[0],today));
  const daily = dates.map(day=>({day,views:visits ? 0 : null, starts:0}));
  const periods = [7,30].map(days=>({days,pages:{},games:[]}));
  for (const v of visits || []) {
    daily.find(item=>item.day===v.day).views += v.n;
    for (const period of periods) if (v.day >= dates[30-period.days]) {
      period.pages[v.page] = (period.pages[v.page] || 0) + v.n;
    }
  }
  for (const game of games) {
    const file = env[game.directory.toUpperCase()+'_DB_PATH'] ||
      path.resolve(__dirname,'..',game.directory,'.data',game.directory+'.sqlite');
    const stats = readStats(file, 'analytics_matches', db=>{
      const starts = db.prepare(`SELECT date(started_at/1000,'unixepoch','+8 hours') day,count(*) n
        FROM analytics_matches WHERE started_at>=? AND started_at<? GROUP BY day`).all(until-30*dayMs,until);
      for (const row of starts) daily.find(item=>item.day===row.day).starts += row.n;
      return periods.map(p=>gameTotals(db,until-p.days*dayMs,until));
    });
    periods.forEach((p,i)=>p.games.push({...game, views:visits ? p.pages[game.id] || 0 : null, stats:stats?.[i]}));
  }
  return {today,daily,periods,hasVisits:!!visits,generatedAt:new Date(now).toISOString()};
}

function fraction(n,d) {
  return d ? n+' / '+d+'（'+Math.round(100*n/d)+'%）' : '—';
}
function render(data) {
  const connected = data.periods[0].games.filter(g=>g.stats).length;
  function periodPanel(p) {
    const days = data.daily.slice(-p.days);
    const max = Math.max(1,...days.map(d=>d.views || 0));
    const rows = [...p.games].sort((a,b)=>(b.stats?.matches ?? -1)-(a.stats?.matches ?? -1) || (b.views || 0)-(a.views || 0));
    return `<section id="p${p.days}"><h2>近 ${p.days} 天</h2><h3>每日访问与开局</h3><div class="scroll"><table>
      <thead><tr><th>北京时间</th><th>页面访问</th><th>开局</th></tr></thead><tbody>
      ${days.map(d=>`<tr><td>${d.day}</td><td>${d.views ?? '—'} <meter min="0" max="${max}" value="${d.views || 0}" aria-label="页面访问"></meter></td><td>${connected ? d.starts : '—'}</td></tr>`).join('')}</tbody></table></div>
      <h3>主站各入口访问</h3><p>${Object.entries(pageNames).map(([key,name])=>name+' '+(data.hasVisits ? p.pages[key] || 0 : '—')).join('　')}</p>
      <h3>桌游表现</h3><div class="scroll"><table><thead><tr>${['桌游','入口访问','成功开局桌 / 开桌','开局数','参与人次','正常完局','中断','过期','进行中','同桌再玩 / 已完局桌'].map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>
      ${rows.map(({name,views,stats:s})=>`<tr><th>${name}</th><td>${views ?? '—'}</td>${s ?
        [fraction(s.opened,s.rooms)+(s.rooms?'':' (0 桌)'),s.matches,s.seats,s.completed,s.interrupted,s.expired,s.ongoing,fraction(s.replay,s.eligible)].map(x=>'<td>'+x+'</td>').join('')
        : '<td colspan="8">尚未接入对局数据</td>'}</tr>`).join('')}</tbody></table></div></section>`;
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>桌游运营统计</title><style>
    *{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;color:#23352e;background:#faf9f5;max-width:78rem;margin:auto;padding:clamp(1rem,3vw,3rem)}
    h1,h2,h3{line-height:1.25}h3{margin-top:2rem}p{color:#42574e}.scroll{overflow-x:auto}table{border-collapse:collapse;background:white;font-variant-numeric:tabular-nums}td,th{padding:.45rem .8rem;border-bottom:1px solid #dde4dd;white-space:nowrap;text-align:right}th:first-child,td:first-child{text-align:left}meter{width:clamp(4rem,20vw,14rem)}label{cursor:pointer;padding:.5em}section{display:none}#week:checked~#p7,#month:checked~#p30{display:block}
    </style><main><h1>桌游运营统计</h1><p>更新于 ${new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间） · 对局数据 ${connected}/${games.length} 款${data.hasVisits?'':' · 访问库未接入'}</p>
    <input id="week" name="period" type="radio" checked><label for="week">近 7 天</label>
    <input id="month" name="period" type="radio"><label for="month">近 30 天</label>
    ${data.periods.map(periodPanel).join('')}
    <p>开局与结局按开局日归属。开桌率和再玩率按建桌日归属，随对局进展更新。仅统计已采集的数据，启用前及日志缺失期间的实际流量未知。</p></main></html>`;
}
function writeReport(visitsFile, output) {
  if (!visitsFile || !output || !/\.html$/i.test(output) || path.resolve(visitsFile)===path.resolve(output))
    throw new Error('用法：node scripts/analytics-report.cjs 访问库 私有目录/report.html');
  const html = render(collect(visitsFile));
  const tmp = output+'.'+randomUUID()+'.tmp';
  try { fs.writeFileSync(tmp,html,{mode:0o600,flag:'wx'}); fs.renameSync(tmp,output); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
module.exports = {collect,render,gameTotals,writeReport};
if (require.main === module) {
  try { writeReport(process.argv[2],process.argv[3]); }
  catch (error) { console.error(error.message); process.exitCode=1; }
}
