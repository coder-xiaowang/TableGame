// Portable complete Node test entry point. Just One is intentionally excluded.
const fs = require('node:fs');
const path = require('node:path');
const {run} = require('node:test');
const root = path.resolve(__dirname,'..');
const output = path.join(root,'audit','test-suite');
fs.mkdirSync(output,{recursive:true});
function discover(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()&&!['node_modules','assets'].includes(entry.name))return discover(file);
    return entry.isFile()&&/\.test\.(?:js|mjs|cjs)$/.test(entry.name)?[file]:[];
  });
}
const directories=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()
  && ((/^game\d*$/.test(entry.name)&&entry.name!=='game12')||['shared','homepage'].includes(entry.name)));
const files=directories.flatMap(entry=>discover(path.join(root,entry.name))).sort();
const requested=Number(process.env.TEST_CONCURRENCY||4);
const concurrency=Number.isInteger(requested)&&requested>0?requested:4;
const failures=[],diagnostics=[];
console.log(`Running ${files.length} test files (Just One excluded).`);
const stream=run({files,concurrency});
stream.on('test:fail',event=>{
  const failure={name:event.name,file:event.file,message:String(event.details.error?.stack||event.details.error)};
  failures.push(failure);console.error(`${failure.name}\n${failure.message.slice(0,1600)}`);
});
stream.on('test:stderr',event=>diagnostics.push(event.message));
stream.on('test:summary',summary=>{
  if(summary.file!==undefined)return;
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({files:files.map(file=>path.relative(root,file)),...summary,failures},null,2));
  fs.writeFileSync(path.join(output,'stderr.log'),diagnostics.join(''));
  console.log(JSON.stringify(summary.counts));
  if(!summary.success)process.exitCode=1;
});
stream.on('error',error=>{console.error(error);process.exitCode=1;});
