// Runs the real standalone shim against mocked Zen globals. Usage: node tools/test-standalone-lifecycle.js
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','additional','video','ZentralVideoPreview.standalone.uc.js'),'utf8');
const a=src.indexOf('const __ZENTRAL_STANDALONE_VERSION__'), b=src.indexOf('const __BUNDLE_URL__');
const shimSrc=src.slice(a,b);
const e1=src.indexOf('const __zentralExtras = ['), e2=src.indexOf('/*\n * ZENTRAL FILE GUIDE - additional/video/ZentralVideoPreview.uc.js');
const extrasSrc=src.slice(e1,e2);
function makeWindow(){
  const log=[];const attrs={};const style={};
  const prefs={};
  const Services={prefs:{getPrefType:k=>k in prefs?64:0,getIntPref:k=>prefs[k],getBoolPref:k=>prefs[k],getStringPref:k=>prefs[k],addObserver(){log.push('obs+')},removeObserver(){log.push('obs-')}},obs:{addObserver(){},removeObserver(){}}};
  const root={style:{setProperty:(k,v)=>style[k]=v,removeProperty:k=>delete style[k]},setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k],hasAttribute:k=>k in attrs,getAttribute:k=>attrs[k]};
  const win={log,attrs,style,Services,document:{documentElement:root,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]},
    setTimeout:(f,ms)=>setTimeout(f,ms),clearTimeout,addEventListener(){},removeEventListener(){},gBrowser:undefined,console};
  win.window=win;win.globalThis=win;
  return win;
}
async function loadBundle(win,{fullRuntime=false,initLog}){
  const ctx=vm.createContext(win);
  ctx.Services=win.Services;ctx.document=win.document;ctx.ChromeUtils={};ctx.Components={stack:{filename:'file:///x/'}};
  if(fullRuntime) win.ZentralRuntime={};
  win.initLog=initLog;
  const code='(function(){'+shimSrc+'\nconst __zentralEmbeddedLoader={destroy(){window.log.push("loader.destroy")}};\n'+extrasSrc+'\n__zentralShim.register({id:"video",init(){initLog.push("base.init");return ()=>initLog.push("base.cleanup")}});})();';
  vm.runInContext(code,ctx);
  await new Promise(r=>setTimeout(r,30));
  return ctx;
}
module.exports={makeWindow,loadBundle};
if(require.main===module)(async()=>{
 let ok=true;const t=(n,c)=>{console.log((c?'PASS ':'FAIL ')+n);if(!c)ok=false};
 // A: standalone alone
 let w=makeWindow(),il=[];await loadBundle(w,{initLog:il});
 t('A standalone alone: init ran',il.includes('base.init'));
 t('A look attr set',w.attrs['zentral-video-standalone']==='');
 w.__zentralStandalone.video.dispose();
 t('A dispose runs base cleanup',il.includes('base.cleanup'));
 t('A dispose removes attr+vars',!('zentral-video-standalone' in w.attrs)&&Object.keys(w.style).length===0);
 t('A loader destroyed',w.log.includes('loader.destroy'));
 t('A registry cleared',!w.__zentralStandalone.video);
 // B: full pack present first
 w=makeWindow();il=[];await loadBundle(w,{fullRuntime:true,initLog:il});
 t('B full present: standalone inert (no init, no look)',!il.length&&!w.attrs['zentral-video-standalone']&&Object.keys(w.style).length===0);
 // C: standalone running, full runtime activates later and disposes it
 w=makeWindow();il=[];await loadBundle(w,{initLog:il});
 w.ZentralRuntime={};w.__zentralStandalone.video?.dispose();
 t('C full takes over: standalone fully cleaned',il.includes('base.cleanup')&&!w.attrs['zentral-video-standalone']&&Object.keys(w.style).length===0);
 // D: double dispose + reload
 w=makeWindow();il=[];let c=await loadBundle(w,{initLog:il});
 const h=w.__zentralStandalone.video;h.dispose();h.dispose();
 t('D double dispose is idempotent',il.filter(x=>x=='base.cleanup').length===1);
 // E: re-run bundle in same window (Sine reload) disposes previous
 w=makeWindow();il=[];await loadBundle(w,{initLog:il});await loadBundle(w,{initLog:il});
 t('E reload: old instance cleaned, new one running',il.filter(x=>x=='base.cleanup').length===1&&il.filter(x=>x=='base.init').length===2&&w.attrs['zentral-video-standalone']==='');
 // F: runtime appears while standalone waits in nativeReady
 w=makeWindow();il=[];
 const ctxp=loadBundle(w,{initLog:il});w.ZentralRuntime={};await ctxp;
 t('F runtime appears during wait: no init, no leaks',!il.includes('base.init')||il.includes('base.cleanup'));
 // G: Sine live-disable via loader unload hook while window stays open
 w=makeWindow();il=[];let hook;w.addUnloadListener=f=>hook=f;await loadBundle(w,{initLog:il});
 t('G loader hook registered',typeof hook==='function');
 hook();
 t('G live disable: cleanup + attr/vars removed + loader destroyed',il.includes('base.cleanup')&&!w.attrs['zentral-video-standalone']&&!Object.keys(w.style).length&&w.log.includes('loader.destroy'));
 // H: hook fires before init finishes (disable during startup wait): must not start
 w=makeWindow();il=[];let hook2;w.addUnloadListener=f=>hook2=f;const p2=loadBundle(w,{initLog:il});hook2();await p2;
 t('H disabled during startup: never inits',!il.includes('base.init'));
 // I: no hook available (older loader): still starts and window unload still cleans
 w=makeWindow();il=[];await loadBundle(w,{initLog:il});
 t('I no loader hook: standalone still runs',il.includes('base.init'));
 console.log(ok?'ALL PASS':'FAILURES');
})();
