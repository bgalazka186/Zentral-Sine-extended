#!/usr/bin/env node
/* Report what each standalone-capable module takes from the rest of the pack:
 * prefs owned elsewhere, root attributes set elsewhere, CSS variables, and other
 * CSS/JS files that style or read attributes this module sets. Run it before
 * adding a standalone.json and after changing a module. Informational: the hard
 * checks (prefs, runtime members) live in tools/build-standalone.cjs.
 * Usage: node tools/audit-standalone.cjs */
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.name==='node_modules'||e.name==='.git'?[]:e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const all=walk(root);
// who owns each pref
const owner={};
for(const f of all.filter(f=>/settings\.json$/.test(f)&&!f.includes('upstream'))){try{const j=JSON.parse(fs.readFileSync(f));for(const s of j.schema||[])owner[s.property]=(owner[s.property]||[]).concat(path.relative(root,f))}catch{}}
const cssFiles=all.filter(f=>f.endsWith('.css')&&!f.includes('upstream'));
const cssText=Object.fromEntries(cssFiles.map(f=>[f,fs.readFileSync(f,'utf8')]));
for(const mf of all.filter(f=>f.endsWith('standalone.json'))){
  const m=JSON.parse(fs.readFileSync(mf)),dir=path.dirname(mf);
  const src=fs.readFileSync(path.join(dir,m.entry),'utf8');
  const own=new Set((JSON.parse(fs.readFileSync(path.join(dir,'settings.json'))).schema||[]).map(s=>s.property));
  const prefs=new Set([...src.matchAll(/["'`]((?:zen\.|browser\.|arc-|zentral\.|extensions\.|sine\.|layout\.|widget\.|toolkit\.|ui\.)[A-Za-z0-9_.\-]+)["'`]/g)].map(x=>x[1]));
  const foreign=[...prefs].filter(p=>!own.has(p));
  const attrsSet=new Set([...src.matchAll(/(?:setAttribute|toggleAttribute|removeAttribute)\(\s*["'`]([a-z][\w-]+)["'`]/g)].map(x=>x[1]).filter(a=>/zentral|bgalazka/.test(a)));
  const attrsRead=new Set([...src.matchAll(/(?:getAttribute|hasAttribute)\(\s*["'`]([a-z][\w-]+)["'`]/g)].map(x=>x[1]).filter(a=>/zentral|bgalazka/.test(a)&&!attrsSet.has(a)));
  const vars=new Set([...src.matchAll(/var\(\s*(--[\w-]+)/g)].map(x=>x[1]));
  const varsSetBySelf=new Set([...src.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)].map(x=>x[1]));
  const ownCssFile=m.css?path.join(dir,m.css):null;
  const ownCss=ownCssFile?cssText[ownCssFile]||'':'';
  const cssVars=new Set([...ownCss.matchAll(/var\(\s*(--[\w-]+)/g)].map(x=>x[1]));
  // other css files that mention attributes this module sets
  const cssConsumers=[...attrsSet].map(a=>[a,cssFiles.filter(f=>f!==ownCssFile&&cssText[f].includes(a)).map(f=>path.relative(root,f))]).filter(x=>x[1].length);
  // other source that reads attributes set by this module
  const jsConsumers=[...attrsSet].map(a=>[a,all.filter(f=>/\.(js|cjs)$/.test(f)&&!f.includes('upstream')&&!f.includes('.standalone.')&&f!==path.join(dir,m.entry)&&!f.includes('/tests/')&&fs.readFileSync(f,'utf8').includes(a)).map(f=>path.relative(root,f))]).filter(x=>x[1].length);
  console.log('\n=== '+m.id);
  console.log(' foreign prefs:',foreign.length?foreign.map(p=>p+'  <'+(owner[p]||['NO OWNER']).join(',')+'>'):'none');
  console.log(' attrs read, not set here:',[...attrsRead].join(', ')||'none');
  console.log(' css vars used in js:',[...vars].filter(v=>!varsSetBySelf.has(v)).join(', ')||'none');
  console.log(' css vars used in own css:',[...cssVars].join(', ')||'none');
  console.log(' other CSS styling its attrs:',JSON.stringify(cssConsumers));
  console.log(' other JS using its attrs:',JSON.stringify(jsConsumers));
}
