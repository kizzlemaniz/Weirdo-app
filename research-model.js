'use strict';
/*
 * Weirdo App v5: transparent, on-device experimental research-informed sampler.
 * No learned parameter is a claim of increased winning odds. All weights are
 * deliberately shrunk toward the fair baseline, especially sparse video data.
 * Only draws *before* a test draw can enter the walk-forward evaluation.
 */
(() => {
  const $ = id => document.getElementById(id);
  const range = max => Array.from({length:max}, (_,i)=>i+1);
  const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
  const safe = n => Number.isFinite(Number(n)) ? Number(n) : 0;
  let snapshot = null, lastStudies = [], lastDraws = [];
  let loading = null;
  const RANDOM_WORD = new Uint32Array(1);
  function randomUnit() { crypto.getRandomValues(RANDOM_WORD); return RANDOM_WORD[0] / 4294967296; }
  function choose(candidates, weights) {
    const total = candidates.reduce((t, n) => t + Math.max(0.01,weights[n]||1),0);
    let x = randomUnit()*total;
    for(const n of candidates){x -= Math.max(0.01,weights[n]||1);if(x < 0)return n;}
    return candidates[candidates.length-1];
  }
  function validDraw(draw) {
    return draw && /^\d{4}-\d{2}-\d{2}$/.test(draw.date || '') &&
      Array.isArray(draw.main) && draw.main.length===5 &&
      new Set(draw.main).size===5 && draw.main.every(n=>Number.isInteger(n)&&n>=1&&n<=69) &&
      Number.isInteger(draw.special)&&draw.special>=1&&draw.special<=26;
  }
  function validOrder(s, expected) {
    const a = s?.drawOrder;
    return Array.isArray(a) && a.length===5 && a.every(n=>Number.isInteger(n)&&n>=1&&n<=69) &&
      new Set(a).size===5 && a.slice().sort((x,y)=>x-y).join(',')===expected.main.join(',');
  }
  // Pure estimator (no date information beyond its supplied TRAINING data).
  function train(drawsInput, studiesInput=[]) {
    const draws=drawsInput.filter(validDraw).slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,240);
    const byDate=new Map(draws.map(d=>[d.date,d]));
    const studies=studiesInput.filter(s=>s && byDate.has(s.date));
    const videos=studies.filter(s=>safe(s.video?.sampleCount)>0);
    const ordered=studies.filter(s=>validOrder(s,byDate.get(s.date)));
    const equipment=studies.filter(s=>{
      const e=s.equipment||{};
      return !!(e.whiteMachine||e.redMachine||e.whiteSet||e.redSet||e.cameraView||e.mixingSeconds!=null);
    });
    const notes=studies.filter(s=>typeof s.notes==='string' && s.notes.trim());
    const timestamps=studies.filter(s=>Array.isArray(s.video?.markers)&&s.video.markers.length>0);
    const wc=Array(70).fill(0),rc=Array(27).fill(0),pos=Array.from({length:5},()=>Array(70).fill(0));
    const pair=new Map();
    let whiteTotal=0,redTotal=0;
    for(let i=0;i<draws.length;i++){
      const d=draws[i], w=Math.exp(-i/95); whiteTotal+=5*w;redTotal+=w;
      for(const n of d.main)wc[n]+=w;
      rc[d.special]+=w;
      if(i<150)for(let j=0;j<5;j++)for(let k=j+1;k<5;k++){
        const a=d.main[j],b=d.main[k], key=a*100+b;
        pair.set(key,(pair.get(key)||0)+w);
      }
    }
    const white=Array(70).fill(1),red=Array(27).fill(1), position=Array.from({length:5},()=>Array(70).fill(1));
    if(draws.length){
      const we=whiteTotal/69, re=redTotal/26;
      for(let n=1;n<=69;n++)white[n]=clamp(1+0.13*(wc[n]-we)/(we+5),0.85,1.15);
      for(let n=1;n<=26;n++)red[n]=clamp(1+0.13*(rc[n]-re)/(re+4),0.85,1.15);
    }
    // Selection-position observations: 12 records cannot establish a bias.
    // These small priors let incoming draw-order records update each position.
    const orderStrength=Math.min(0.075,0.075*ordered.length/(ordered.length+80));
    const expectedPos=ordered.length/69;
    for(const s of ordered)for(let j=0;j<5;j++)pos[j][s.drawOrder[j]]++;
    if(ordered.length)for(let j=0;j<5;j++)for(let n=1;n<=69;n++)
      position[j][n]=clamp(1+orderStrength*(pos[j][n]-expectedPos)/(expectedPos+1),0.94,1.06);

    // Video footage provides only camera/pixel-motion indices, not a physics
    // prediction of a future machine. Assign a VERY SMALL exploratory effect
    // to the historical draw paired with each saved clip; shrink by sample count
    // and quality, and never extrapolate a large weight from two recordings.
    const videoStrength=0.045*videos.length/(videos.length+30);
    const equipmentStrength=0.035*equipment.length/(equipment.length+45);
    const machineTotals=new Map();
    for(const s of equipment){
      const machine=s.equipment?.whiteMachine?.trim();
      if(machine)machineTotals.set(machine,(machineTotals.get(machine)||0)+1);
    }
    for(const s of studies){
      const d=byDate.get(s.date); if(!d)continue;
      let change=0;
      const v=s.video;
      if(v && safe(v.sampleCount)>0){
        const motion=clamp(safe(v.averageMotion),0,100);
        const peak=clamp(safe(v.peakMotion),0,100);
        const frames=clamp(safe(v.sampleCount)/180,0.1,1);
        const stable=s.equipment?.cameraView==='fixed'?1:s.equipment?.cameraView==='changing'?0.3:0.65;
        const peakReliability=peak>=95?0.45:1; // peaks can be editing cuts
        change+=videoStrength*clamp((motion-12)/18,-1,1)*frames*stable*peakReliability;
        const markers=(v.markers||[]).filter(m=>Number.isFinite(Number(m.time)));
        if(markers.length>=2){
          const times=markers.map(m=>Number(m.time)).sort((a,b)=>a-b);
          const intervals=times.slice(1).map((t,i)=>t-times[i]).filter(x=>x>0&&x<100);
          if(intervals.length) {
            const mean=intervals.reduce((a,b)=>a+b,0)/intervals.length;
            change+=videoStrength*0.25*clamp((mean-3)/8,-1,1);
          }
        }
      }
      if(s.equipment){
        const e=s.equipment;
        if(Number.isFinite(e.mixingSeconds)&&e.mixingSeconds>=0)
          change+=equipmentStrength*clamp((e.mixingSeconds-20)/45,-1,1);
        const machine=e.whiteMachine?.trim();
        if(machine && (machineTotals.get(machine)||0)>1)
          change+=equipmentStrength*0.15*((machineTotals.get(machine)||0)/(machineTotals.get(machine)+5));
        // Identifiers and notes are retained as context, not interpreted as
        // numeric causal signals without a known future machine/ball set.
      }
      const boost=clamp(change,-0.02,0.02);
      for(const n of d.main)white[n]*=1+boost;
      red[d.special]*=1+boost;
    }
    for(let n=1;n<=69;n++)white[n]=clamp(white[n],0.82,1.18);
    for(let n=1;n<=26;n++)red[n]=clamp(red[n],0.82,1.18);
    return {white,red,position,pair,counts:{official:draws.length,order:ordered.length,video:videos.length,equipment:equipment.length,
      timestamps:timestamps.length,notes:notes.length},trainedThrough:draws[0]?.date || null};
  }
  function sample(model, allowRedMatch=true) {
    if(!model?.counts?.official)return null;
    const special=choose(range(26),model.red);
    const available=range(69).filter(n=>allowRedMatch||n!==special);
    const main=[];
    for(let j=0;j<5;j++){
      const w=Array(70).fill(1);
      for(const n of available){
        let pairFactor=1;
        for(const picked of main){
          const a=Math.min(n,picked),b=Math.max(n,picked), freq=model.pair.get(a*100+b)||0;
          // Pair evidence remains a tiny tie-breaker, NOT a forecast.
          pairFactor *= clamp(1+0.008*(freq-2.0)/4,0.988,1.012);
        }
        w[n]=model.white[n]*model.position[j][n]*clamp(pairFactor,0.98,1.02);
      }
      const n=choose(available,w); main.push(n);available.splice(available.indexOf(n),1);
    }
    return {main:main.sort((a,b)=>a-b),special};
  }
  function score(model,draw){
    const whiteSum=model.white.slice(1).reduce((a,b)=>a+b,0), redSum=model.red.slice(1).reduce((a,b)=>a+b,0);
    const set=new Set(draw.main); let brier=0, baseline=0;
    for(let n=1;n<=69;n++){
      const y=set.has(n)?1:0, p=clamp(5*model.white[n]/whiteSum,0,1), q=5/69;
      brier+=(p-y)**2;baseline+=(q-y)**2;
    }
    for(let n=1;n<=26;n++){
      const y=n===draw.special?1:0, p=model.red[n]/redSum, q=1/26;
      // Each group weighted equally; scores are proper marginal Brier losses.
      brier+=(p-y)**2*(69/26); baseline+=(q-y)**2*(69/26);
    }
    return {model:brier/69,baseline:baseline/69};
  }
  function backtest(drawsInput,studiesInput){
    const dates=drawsInput.filter(validDraw).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const tests=Math.min(90,Math.max(0,dates.length-60));
    if(!tests)return {tests:0};
    let modelLoss=0,baseLoss=0, withVideo=0, withOrder=0;
    for(let i=dates.length-tests;i<dates.length;i++){
      const target=dates[i];
      const beforeStudies=studiesInput.filter(s=>s?.date<target.date);
      const m=train(dates.slice(0,i),beforeStudies);
      const result=score(m,target);
      modelLoss+=result.model;baseLoss+=result.baseline;
      if(m.counts.video)withVideo++;
      if(m.counts.order)withOrder++;
    }
    return {tests,modelLoss:modelLoss/tests,baseLoss:baseLoss/tests,
      diffPercent:100*(baseLoss-modelLoss)/baseLoss,withVideo,withOrder,
      firstTest:dates[dates.length-tests].date,lastTest:dates[dates.length-1].date};
  }
  async function refresh(){
    if(loading)return loading;
    loading=(async()=>{
      const draws=window.HistoryLab?.getDraws?.()||[];
      let studies=[];
      try {studies=await window.ResearchLab?.exportStudies?.()||[];}
      catch(e){console.warn('Research data temporarily unavailable:',e.message);}
      lastDraws=draws;lastStudies=studies;snapshot=train(draws,studies);
      render();return snapshot;
    })().finally(()=>{loading=null;});
    return loading;
  }
  function render(){
    const m=snapshot;if(!m)return;
    const area=$('research-model-summary');if(!area)return;
    const c=m.counts;
    area.textContent=`Using ${c.official.toLocaleString()} official results, ${c.order} verified draw orders, ${c.video} saved video studies, ${c.timestamps} timestamped studies, and ${c.equipment} equipment records. ${c.notes} descriptive notes preserved. Current data are re-read every time you generate.`;
    const detail=$('research-model-detail');
    if(detail)detail.textContent=c.video<10
      ? 'Video evidence is sparse; its numerical influence is intentionally extremely small. Motion is affected by camera cuts. Qualitative notes and machine IDs remain documented, but cannot responsibly predict an unknown future setup.'
      : 'Video and equipment features have a limited exploratory influence. No proven predictive advantage.';
  }
  async function runBacktest(){
    const button=$('run-model-test'),out=$('model-test-result');if(!button||!out)return;
    button.disabled=true;out.textContent='Testing chronological holdout drawings without using later results…';
    try {
      await refresh();
      const result=backtest(lastDraws,lastStudies);
      if(!result.tests)out.textContent='Not enough historical drawings loaded. Refresh official results first.';
      else {
        const p=result.diffPercent;
        out.textContent=`Walk-forward test: ${result.tests} later drawings (${result.firstTest} to ${result.lastTest}). `+
          `Research model Brier loss ${result.modelLoss.toFixed(5)} vs uniform baseline ${result.baseLoss.toFixed(5)} `+
          `(lower is better; ${Math.abs(p).toFixed(2)}% ${p>=0?'lower':'higher'}). `+
          `Earlier video records could inform ${result.withVideo} test drawings; earlier draw orders ${result.withOrder}. `+
          `This is retrospective and not proof of improved future odds.`;
      }
    }catch(e){out.textContent='Test could not run: '+e.message;}
    finally{button.disabled=false;}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('run-model-test')?.addEventListener('click',runBacktest);
    $('refresh-model')?.addEventListener('click',()=>refresh().catch(console.warn));
    $('strategy-select')?.addEventListener('change',()=>{
      if($('strategy-select').value==='research')refresh().catch(console.warn);
    });
    // Recalculate after result sync; generation itself always refreshes.
    document.addEventListener('number-bank-ready',()=>setTimeout(()=>refresh().catch(console.warn),350));
    document.addEventListener('research-data-updated',()=>refresh().catch(console.warn));
    document.addEventListener('official-history-updated',()=>refresh().catch(console.warn));
  });
  window.ResearchModel={train,sample,backtest,score,refresh,getSnapshot:()=>snapshot};
})();
