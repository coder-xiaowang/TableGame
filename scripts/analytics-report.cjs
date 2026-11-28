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

function visitCounts() {
  return {total:0, external:0, developer:0, unknown:0};
}

function addVisits(counts, row) {
  counts.total += row.n;
  counts[row.audience] += row.n;
}

function collect(visitsFile, now=Date.now(), env=process.env) {
  const today = beijingDay(now);
  const until = Date.parse(today+'T00:00:00+08:00') + dayMs;
  const dates = Array.from({length:30}, (_,i)=>beijingDay(until-(30-i)*dayMs));
  const visits = readStats(visitsFile, 'visits', db=>{
    const classified = db.prepare("SELECT 1 FROM pragma_table_info('visits') WHERE name='audience'").get();
    const group = classified ? "coalesce(audience,'unknown')" : "'unknown'";
    return db.prepare(`SELECT day,page,${group} audience,count(*) n FROM visits
      WHERE day BETWEEN ? AND ? GROUP BY 1,2,3`).all(dates[0],today);
  });
  const daily = dates.map(day=>({day,visits:visitCounts(), starts:0}));
  const periods = [7,30].map(days=>({days,visits:visitCounts(),pages:{},games:[]}));
  for (const v of visits || []) {
    addVisits(daily.find(item=>item.day===v.day).visits, v);
    for (const period of periods) if (v.day >= dates[30-period.days]) {
      addVisits(period.visits, v);
      period.pages[v.page] ??= visitCounts();
      addVisits(period.pages[v.page], v);
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
    periods.forEach((p,i)=>p.games.push({...game, visits:p.pages[game.id] || visitCounts(), stats:stats?.[i]}));
  }
  return {today,daily,periods,hasVisits:!!visits,generatedAt:new Date(now).toISOString()};
}

function fraction(n,d) {
  return d ? n+' / '+d+'（'+Math.round(100*n/d)+'%）' : '—';
}
function render(data) {
  const connected = data.periods[0].games.filter(g=>g.stats).length;
  const visitHeaders = '<th>总访问</th><th>外部访问</th><th>开发者</th><th>未分类</th>';
  function visitCells(counts) {
    return [counts.total,counts.external,counts.developer,counts.unknown]
      .map(n=>`<td>${data.hasVisits ? n : '—'}</td>`).join('');
  }
  function periodPanel(p) {
    const days = data.daily.slice(-p.days);
    const max = Math.max(1,...days.map(d=>d.visits.total));
    const rows = [...p.games].sort((a,b)=>(b.stats?.matches ?? -1)-(a.stats?.matches ?? -1) || b.visits.external-a.visits.external || b.visits.total-a.visits.total);
    return `<section id="p${p.days}"><h2>近 ${p.days} 天</h2>
      <p>${data.hasVisits ? `全站外部访问 <strong>${p.visits.external}</strong> 次　开发者 ${p.visits.developer} 次　未分类 ${p.visits.unknown} 次　合计 ${p.visits.total} 次` : '访问库未接入'}</p>
      <p>外部访问按未标记浏览器的入口请求次数统计。同一个人可以访问多次。旧日志归入未分类。对局列包含所有已采集的对局。</p>
      <h3>每日访问与开局</h3><div class="scroll"><table>
      <thead><tr><th>北京时间</th>${visitHeaders}<th>访问趋势</th><th>开局</th></tr></thead><tbody>
      ${days.map(d=>`<tr><td>${d.day}</td>${visitCells(d.visits)}<td><meter min="0" max="${max}" value="${d.visits.total}" aria-label="页面访问"></meter></td><td>${connected ? d.starts : '—'}</td></tr>`).join('')}</tbody></table></div>
      <h3>主站各入口访问</h3><div class="scroll"><table><thead><tr><th>入口</th>${visitHeaders}</tr></thead><tbody>
      ${Object.entries(pageNames).map(([key,name])=>`<tr><th>${name}</th>${visitCells(p.pages[key] || visitCounts())}</tr>`).join('')}</tbody></table></div>
      <h3>桌游表现</h3><div class="scroll"><table><thead><tr><th>桌游</th>${visitHeaders}${['成功开局桌 / 开桌','开局数','参与人次','正常完局','中断','过期','进行中','同桌再玩 / 已完局桌'].map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>
      ${rows.map(({name,visits,stats:s})=>`<tr><th>${name}</th>${visitCells(visits)}${s ?
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
