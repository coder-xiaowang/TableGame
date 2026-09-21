import { ENGINE_VERSION, compilePattern, patternFingerprint } from "../core.js";
import { GENERIC_PALETTE } from "../palette.js";
import { CATEGORY_LABELS, DEFAULT_SCENARIOS, FIXTURES, FULL_SCENARIOS } from "./fixtures.js";

const $ = (id) => document.getElementById(id);
const RATING_KEY = "bead-benchmark-ratings-v1";
const ISSUE_LABELS = ["主体不清楚","五官丢失","轮廓粘连","背景干扰","颜色偏差","碎点过多","渐变断层","颜色过多","细节杂乱"];
const RATING_LABELS = ["主体辨识度","关键特征","色彩观感","制作便利性","综合满意度"];
let activeResults = [], baseline = new Map(), running = false;
let ratings = JSON.parse(localStorage.getItem(RATING_KEY) || "{}");

$("engineVersion").textContent = `内核 ${ENGINE_VERSION}`;
for (const [value,label] of Object.entries(CATEGORY_LABELS)) $("categoryFilter").add(new Option(label,value));

function loadImage(url) {
  return new Promise((resolve,reject) => { const image=new Image(); image.onload=()=>resolve(image); image.onerror=reject; image.src=url; });
}

function rasterize(image,width,height) {
  const scale=4, canvas=document.createElement("canvas"); canvas.width=width*scale; canvas.height=height*scale;
  const context=canvas.getContext("2d",{willReadFrequently:true});
  const factor=Math.max(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
  const drawWidth=image.naturalWidth*factor, drawHeight=image.naturalHeight*factor;
  context.drawImage(image,(canvas.width-drawWidth)/2,(canvas.height-drawHeight)/2,drawWidth,drawHeight);
  return context.getImageData(0,0,canvas.width,canvas.height);
}

function drawPattern(canvas,result) {
  canvas.width=result.width; canvas.height=result.height; const context=canvas.getContext("2d");
  for(let i=0;i<result.cells.length;i+=1){const color=result.cells[i]<0?"#fff":GENERIC_PALETTE[result.cells[i]].hex;context.fillStyle=color;context.fillRect(i%result.width,Math.floor(i/result.width),1,1);}
}

function resultKey(fixtureId,scenarioId,version=ENGINE_VERSION){return `${version}:${fixtureId}:${scenarioId}`;}
function metric(value,digits=1){return Number(value||0).toFixed(digits);}
function deltaText(item){const old=baseline.get(`${item.fixtureId}:${item.scenario.id}`);if(!old)return "";const m=item.metrics,o=old.metrics||{};return `较基准：颜色 ${m.colors-(o.colors||0)>=0?"+":""}${m.colors-(o.colors||0)} · 碎片 ${m.smallRegions-(o.smallRegions||0)>=0?"+":""}${m.smallRegions-(o.smallRegions||0)} · 色差 ${(m.meanLabDistance-(o.meanLabDistance||0)).toFixed(1)}`;}

function ratingPanel(item) {
  const fragment=$("ratingTemplate").content.cloneNode(true), panel=fragment.querySelector(".rating-panel"), grid=fragment.querySelector(".rating-grid"), issues=fragment.querySelector(".issue-grid"), note=fragment.querySelector("textarea");
  const key=resultKey(item.fixtureId,item.scenario.id), saved=ratings[key]||{scores:{},issues:[],manualEdits:"",note:""};
  for(const label of RATING_LABELS){const select=document.createElement("select");select.innerHTML='<option value="">未评分</option>'+[1,2,3,4,5].map(v=>`<option value="${v}">${v} 分</option>`).join("");select.value=saved.scores[label]||"";select.onchange=()=>saveRating(key,label,select.value,null,note.value);const wrapper=document.createElement("label");wrapper.textContent=label;wrapper.append(select);grid.append(wrapper);}
  const editInput=document.createElement("input");editInput.type="number";editInput.min="0";editInput.placeholder="格";editInput.value=saved.manualEdits||"";const editLabel=document.createElement("label");editLabel.textContent="预计手工修改";editLabel.append(editInput);grid.append(editLabel);editInput.onchange=()=>{const current=ratings[key]||{scores:{},issues:[],note:""};current.manualEdits=editInput.value;ratings[key]=current;localStorage.setItem(RATING_KEY,JSON.stringify(ratings));};
  for(const issue of ISSUE_LABELS){const input=document.createElement("input");input.type="checkbox";input.checked=saved.issues.includes(issue);input.onchange=()=>saveRating(key,null,null,[...issues.querySelectorAll("input:checked")].map(node=>node.value),note.value);input.value=issue;const label=document.createElement("label");label.append(input,issue);issues.append(label);}
  note.value=saved.note||"";note.oninput=()=>saveRating(key,null,null,[...issues.querySelectorAll("input:checked")].map(node=>node.value),note.value);
  return panel;
}

function saveRating(key,label,value,issues,note){const current=ratings[key]||{scores:{},issues:[],manualEdits:"",note:""};if(label)current.scores[label]=value;if(issues)current.issues=issues;current.note=note;ratings[key]=current;localStorage.setItem(RATING_KEY,JSON.stringify(ratings));}

function renderResults(fixtures,scenarios) {
  const root=$("results");root.replaceChildren();
  for(const fixture of fixtures){const section=document.createElement("section");section.className="fixture";section.innerHTML=`<div class="fixture-head"><div><h2>${fixture.title}</h2><p>${CATEGORY_LABELS[fixture.category]} · ${fixture.id}</p><ul class="focus-list">${fixture.focus.map(text=>`<li>${text}</li>`).join("")}</ul></div></div><div class="comparison-grid"><article class="source-card"><strong>原始测试图</strong><img src="${fixture.file}" alt="${fixture.title}"></article></div>`;const grid=section.querySelector(".comparison-grid");
    for(const scenario of scenarios){const item=activeResults.find(entry=>entry.fixtureId===fixture.id&&entry.scenario.id===scenario.id);if(!item)continue;const card=document.createElement("article");card.className="result-card";card.innerHTML=`<div class="result-head"><strong>${scenario.label}</strong><small>${scenario.width}×${scenario.height} / ${scenario.maximumColors}色上限</small></div><canvas></canvas><div class="metrics"><span>实际颜色 <b>${item.metrics.colors}</b></span><span>豆子 <b>${item.metrics.filled}</b></span><span>孤立豆 <b>${item.metrics.isolated}</b></span><span>小碎片 <b>${item.metrics.smallRegions}</b></span><span>平均色差 <b>${metric(item.metrics.meanLabDistance)}</b></span><span>高色差 <b>${metric(item.metrics.highErrorRatio*100)}%</b></span><span>轮廓保留 <b>${metric(item.metrics.edgeRetention*100)}%</b></span><span>耗时 <b>${metric(item.timings.totalMs)}ms</b></span></div><div class="delta">${deltaText(item)}</div>`;drawPattern(card.querySelector("canvas"),item);card.append(ratingPanel(item));grid.append(card);}root.append(section);}
}

async function run(scenarios){if(running)return;running=true;activeResults=[];$("exportResults").disabled=true;const category=$("categoryFilter").value;const fixtures=FIXTURES.filter(item=>category==="all"||item.category===category);const total=fixtures.length*scenarios.length;let completed=0;$("results").innerHTML='<p class="empty">正在生成基准结果……</p>';
  try{for(const fixture of fixtures){const image=await loadImage(fixture.file);for(const scenario of scenarios){$("statusText").textContent=`正在处理 ${fixture.title} · ${scenario.label}`;await new Promise(resolve=>requestAnimationFrame(resolve));const result=compilePattern(rasterize(image,scenario.width,scenario.height),GENERIC_PALETTE,scenario);activeResults.push({...result,fixtureId:fixture.id,category:fixture.category,scenario,fingerprint:patternFingerprint(result.cells)});completed+=1;$("progressBar").style.width=`${completed/total*100}%`;}}
    renderResults(fixtures,scenarios);$("statusText").textContent=`完成 ${completed} 项结果 · ${new Date().toLocaleTimeString()}`;$("exportResults").disabled=false;
  }catch(error){console.error(error);$("statusText").textContent=`运行失败：${error.message}`;}finally{running=false;}}

function exportResults(){const payload={schemaVersion:1,engineVersion:ENGINE_VERSION,createdAt:new Date().toISOString(),results:activeResults.map(({cells,...item})=>({...item,cells})),ratings};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`bead-benchmark-${ENGINE_VERSION}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}

$("baselineInput").onchange=async()=>{try{const payload=JSON.parse(await $("baselineInput").files[0].text());baseline=new Map((payload.results||[]).map(item=>[`${item.fixtureId}:${item.scenario.id}`,item]));$("statusText").textContent=`已载入 ${baseline.size} 项旧基准${payload.engineVersion?`（${payload.engineVersion}）`:""}`;if(activeResults.length)renderResults(FIXTURES.filter(item=>$("categoryFilter").value==="all"||item.category===$("categoryFilter").value),[...new Map(activeResults.map(item=>[item.scenario.id,item.scenario])).values()]);}catch{$("statusText").textContent="旧基准文件无法读取";}};
$("runDefault").onclick=()=>run(DEFAULT_SCENARIOS);$("runFull").onclick=()=>run(FULL_SCENARIOS);$("exportResults").onclick=exportResults;$("categoryFilter").onchange=()=>{$("results").replaceChildren();activeResults=[];$("progressBar").style.width="0";$("statusText").textContent="筛选已改变，请重新运行基准";$("exportResults").disabled=true;};
