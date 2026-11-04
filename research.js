'use strict';
// Four connected facets of each draw: certified-results reference, ordered white balls,
// local uploaded video motion measurements, and user's equipment observations.
// Each study uses the drawing date as its key. Video bytes never enter IndexedDB.
(() => {
  const STORE = 'draw_studies';
  const $r = id => document.getElementById(id);
  const dateRE = /^\d{4}-\d{2}-\d{2}$/;
  const fields = ['white-machine','red-machine','white-set','red-set','mixing-time','camera-view','study-video-url','study-notes'];
  let currentDate = '';
  let activeStudy = null;
  let studies = [];
  let updating = false;
  const sorted = nums => [...nums].sort((a,b)=>a-b);
  const fmt = n => String(n).padStart(2,'0');
  function validDate(s) {
    if (typeof s !== 'string' || !dateRE.test(s) || s < '2015-10-07') return false;
    const d = new Date(s+'T12:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0,10) === s;
  }
  function validateOrder(numbers, date) {
    if (!Array.isArray(numbers) || numbers.length !== 5 || numbers.some(n => !Number.isInteger(n) || n<1 || n>69) || new Set(numbers).size!==5)
      throw new Error('Draw order must contain exactly five different white numbers from 1 to 69.');
    const published = window.HistoryLab?.getDraw(date);
    if (published && sorted(numbers).join(',') !== published.main.join(','))
      throw new Error('The five numbers do not match the published winning numbers for this date. Check the drawing date and ball order.');
  }
  // On iOS, moving between the video picker and this screen may leave an old
  // IDBDatabase object in the 'closing' state. Reconnect and retry once rather
  // than losing the current in-memory Video Lab measurements.
  let reopeningDatabase = null;
  function isClosedConnection(error) {
    const description = String(error?.message || '');
    return error?.name === 'InvalidStateError' &&
      /clos(e|ing|ed)|connection|database|transaction/i.test(description) ||
      /database connection is closing|database is closed|connection is closing/i.test(description);
  }
  async function reconnectForStudy() {
    if (!reopeningDatabase) {
      reopeningDatabase = openDatabase()
        .then(connection => { db = connection; return connection; })
        .finally(() => { reopeningDatabase = null; });
    }
    return reopeningDatabase;
  }
  async function studyTransaction(operation) {
    try { return await operation(); }
    catch (error) {
      if (!isClosedConnection(error)) throw error;
      await reconnectForStudy();
      return await operation();
    }
  }
  function readAll() {
    return studyTransaction(() => new Promise((resolve,reject)=>{
      const req=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
      req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.date.localeCompare(a.date)));
      req.onerror=()=>reject(req.error);
    }));
  }
  function get(date) {
    return studyTransaction(() => new Promise((resolve,reject)=>{
      const req=db.transaction(STORE,'readonly').objectStore(STORE).get(date);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    }));
  }
  function put(row) {
    return studyTransaction(() => new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(row);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    }));
  }
  function remove(date) {
    return studyTransaction(() => new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).delete(date);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    }));
  }
  function msg(value, error=false) {
    const el=$r('study-feedback');
    if (!el) return;
    el.textContent=value;
    el.className=error?'research-error':'research-success';
  }
  function dateDisplay(date) {
    return new Date(date+'T12:00:00').toLocaleDateString(undefined,{dateStyle:'medium'});
  }
  function drawOfficial(date) {
    const result = window.HistoryLab?.getDraw(date);
    const target=$r('study-official');
    target.replaceChildren();
    const heading=document.createElement('strong'); heading.textContent=`${dateDisplay(date)} · Official historical result`;
    target.append(heading);
    if (!result) {
      const p=document.createElement('p');p.textContent='No public result saved for this date yet. Sync official history to cross-check the order.';
      target.append(p);
    } else {
      const p=document.createElement('p');p.textContent=`White balls (sorted): ${result.main.map(fmt).join(' · ')}  |  Red ball: ${fmt(result.special)}${result.main.includes(result.special)?' (matches a white ball)':''}`;
      target.append(p);
    }
    const link=document.createElement('a');link.href=`https://www.powerball.com/draw-result?date=${encodeURIComponent(date)}&gc=powerball`;
    link.target='_blank';link.rel='noopener noreferrer';link.textContent='Verify result on Powerball ↗';
    target.append(link);
  }
  function assignFields(row) {
    const value = (name) => row?.equipment?.[name] || '';
    $r('white-machine').value=value('whiteMachine');
    $r('red-machine').value=value('redMachine');
    $r('white-set').value=value('whiteSet');
    $r('red-set').value=value('redSet');
    $r('mixing-time').value=row?.equipment?.mixingSeconds ?? '';
    $r('camera-view').value=value('cameraView');
    $r('study-video-url').value=row?.videoUrl || '';
    $r('study-notes').value=row?.notes || '';
    const inputs=[...document.querySelectorAll('.order-input')];
    inputs.forEach((input,i)=>input.value=row?.drawOrder?.[i] ?? '');
    $r('order-provenance').value=['manual','texas','video','import','texas-snapshot'].includes(row?.orderSource)?
      (row.orderSource==='texas-snapshot'?'texas':row.orderSource):'manual';
  }
  function summarizeVideo(row) {
    const target=$r('linked-video');target.replaceChildren();
    if (!row?.video) {
      target.textContent='No saved video measurements linked to this drawing yet. Select a local clip in Video Lab, play it, then tap “Attach current Video Lab measurements” here.';
      if(row?.videoUrl){const link=document.createElement('a');link.href=row.videoUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open saved video link ↗';target.append(document.createElement('p'),link);}
      return;
    }
    const video = row.video;
    const title=document.createElement('strong');title.textContent='Linked video analysis';
    const body=document.createElement('p');
    body.textContent=`${video.filename||'Local video'} · ${video.sampleCount||0} frame samples · mean motion ${video.averageMotion==null?'—':video.averageMotion+'/100'} · peak ${video.peakMotion==null?'—':video.peakMotion+'/100'} · ${video.markers?.length||0} timestamp markers`;
    target.append(title,body);
    if (video.markers?.length) {
      const p=document.createElement('p');p.textContent=video.markers.map(m=>`${m.type==='main'?'White':'Red'} ${fmt(m.number)} at ${Number(m.time).toFixed(1)}s`).join(' · ');
      target.append(p);
    }
    if (row.videoUrl) {
      const link=document.createElement('a');link.href=row.videoUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open linked recording ↗';target.append(link);
    }
    const caveat=document.createElement('small');caveat.textContent='Only timestamps/measurements are saved here—not the actual video. Motion score reflects pixel changes, including camera cuts.';
    target.append(caveat);
  }
  function readEquipment() {
    const val=id=>$r(id).value.trim();
    const rawTime=val('mixing-time');
    const mixingSeconds=rawTime===''?null:Number(rawTime);
    if (mixingSeconds!==null && (!Number.isFinite(mixingSeconds) || mixingSeconds<0 || mixingSeconds>3600))
      throw new Error('Mixing time must be between 0 and 3600 seconds, or left blank.');
    return {whiteMachine:val('white-machine').slice(0,80), redMachine:val('red-machine').slice(0,80),
      whiteSet:val('white-set').slice(0,80),redSet:val('red-set').slice(0,80),
      mixingSeconds,cameraView:val('camera-view')};
  }
  function validateVideoURL(url) {
    if (!url) return '';
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('Video link must be a full https:// URL.'); }
    if (parsed.protocol !== 'https:') throw new Error('Video URL must start with https://');
    return parsed.toString().slice(0,600);
  }
  function readOrder() {
    const inputs=[...document.querySelectorAll('.order-input')];
    if (inputs.every(el=>el.value.trim()==='')) return null;
    if (inputs.some(el=>el.value.trim()==='')) throw new Error('Enter all five ball positions, or leave them all blank.');
    return inputs.map(el=>Number(el.value));
  }
  function defaultRow(date) {
    return {date,drawOrder:null,orderSource:'manual',equipment:{},notes:'',videoUrl:'',video:null,updatedAt:Date.now()};
  }
  async function openDate(date) {
    if (!validDate(date)) { msg('Choose a valid drawing date on or after October 7, 2015.',true);return; }
    currentDate=date;
    $r('study-date').value=date;
    activeStudy=await get(date);
    assignFields(activeStudy);
    drawOfficial(date);
    summarizeVideo(activeStudy);
    msg(activeStudy?'Existing drawing study loaded.':'No saved study for this date. You can add the ball order or observations.');
    $r('draw-research').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function saveStudy(event) {
    if (event) event.preventDefault();
    try {
      const date=$r('study-date').value;
      if (!validDate(date)) throw new Error('Choose a valid date on or after October 7, 2015.');
      const existing=await get(date);
      const order=readOrder();
      if(order) validateOrder(order,date);
      const row={...(existing||defaultRow(date)),date,drawOrder:order,
        orderSource:order?$r('order-provenance').value:'manual',equipment:readEquipment(),
        videoUrl:validateVideoURL($r('study-video-url').value.trim()),notes:$r('study-notes').value.trim().slice(0,2000),updatedAt:Date.now()};
      await put(row);
      currentDate=date;activeStudy=row;studies=await readAll();
      drawOfficial(date);summarizeVideo(row);renderStats();renderPatterns();
      msg('Drawing study saved locally. It is included in your JSON backup.');
    } catch(error) {msg('Could not save: '+error.message,true);}
  }
  async function attachVideo() {
    try {
      const date=$r('study-date').value;
      if (!validDate(date)) throw new Error('First select a valid drawing date.');
      const snapshot=window.VideoLab?.getSnapshot();
      if (!snapshot || (!snapshot.sampleCount && !snapshot.markers.length))
        throw new Error('First choose a local video in Video Lab and play some frames or mark balls.');
      const row=await get(date)||defaultRow(date);
      if (snapshot.markers.length===6) {
        const white=snapshot.markers.filter(m=>m.type==='main').map(m=>m.number);
        const red=snapshot.markers.filter(m=>m.type==='special').map(m=>m.number);
        if(white.length===5 && red.length===1) {
          // Never silently replace a previously saved order.
          validateOrder(white,date);
          if (!row.drawOrder) {row.drawOrder=white;row.orderSource='video';}
        }
      }
      row.video=snapshot;row.updatedAt=Date.now();
      await put(row);activeStudy=row;studies=await readAll();
      if(currentDate!==date) currentDate=date;
      assignFields(row);drawOfficial(date);summarizeVideo(row);renderStats();renderPatterns();
      msg('Video samples and timestamp markers attached. Original video stays on your device and is not saved.');
    } catch(error) {msg('Could not attach video: '+error.message,true);}
  }
  async function deleteStudy() {
    const date=$r('study-date').value;
    if (!validDate(date)) {msg('Select a study to clear.',true);return;}
    if(!confirm(`Clear study for ${date}? Published results will stay in the separate historical archive.`))return;
    await remove(date);studies=await readAll();activeStudy=null;
    assignFields(null);summarizeVideo(null);renderStats();renderPatterns();
    msg('Drawing study removed. The saved official result was not deleted.');
  }
  async function seedOrders() {
    // Only insert missing dates: preserves user edits and device data.
    const source=window.DrawOrderSeed||[];
    const tx=db.transaction(STORE,'readwrite');
    const store=tx.objectStore(STORE);
    for (const [date,nums] of source) {
      const req=store.get(date);
      req.onsuccess=()=>{if(!req.result)store.add({...defaultRow(date),drawOrder:nums,orderSource:'texas-snapshot',updatedAt:0});};
    }
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }
  function renderStats() {
    const withOrder=studies.filter(s=>Array.isArray(s.drawOrder)&&s.drawOrder.length===5);
    const video=studies.filter(s=>s.video?.sampleCount>0);
    const equipment=studies.filter(s=>s.equipment?.whiteMachine||s.equipment?.redMachine||s.equipment?.whiteSet||s.equipment?.mixingSeconds!=null);
    $r('research-stats').replaceChildren();
    for(const [label,value] of [['DRAW ORDERS',withOrder.length],['VIDEO STUDIES',video.length],['EQUIPMENT NOTES',equipment.length],['TOTAL DATE RECORDS',studies.length]]) {
      const card=document.createElement('div');card.className='research-stat';
      const small=document.createElement('small');small.textContent=label;
      const strong=document.createElement('strong');strong.textContent=value.toLocaleString();
      card.append(small,strong);$r('research-stats').append(card);
    }
    renderBrowser();
  }
  function renderBrowser() {
    const area=$r('study-browser');area.replaceChildren();
    if(!studies.length){area.textContent='No studies saved yet.';return;}
    for(const s of studies.slice(0,35)){
      const button=document.createElement('button');button.type='button';button.className='study-browser-row';
      const label=document.createElement('strong');label.textContent=s.date;
      const detail=document.createElement('span');
      detail.textContent=[s.drawOrder?'White order: '+s.drawOrder.map(fmt).join(' → '):'No draw order',s.video?.sampleCount?'Video '+s.video.sampleCount+' frames':null,s.equipment?.whiteMachine?'Machine '+s.equipment.whiteMachine:null].filter(Boolean).join(' · ');
      button.append(label,detail);button.addEventListener('click',()=>openDate(s.date));area.append(button);
    }
    if(studies.length>35){const p=document.createElement('small');p.textContent='Showing the latest 35. Choose an older date using the date field above.';area.append(p);}
  }
  function renderPatterns() {
    const area=$r('research-patterns');area.replaceChildren();
    const order=studies.filter(s=>Array.isArray(s.drawOrder) && s.drawOrder.length===5);
    const counts=Array(70).fill(0), positionTotals=[0,0,0,0,0];
    for(const s of order)for(let j=0;j<5;j++){const n=s.drawOrder[j];if(Number.isInteger(n)&&n>=1&&n<=69){if(j===0)counts[n]++;positionTotals[j]++;}}
    const prominent=counts.map((count,n)=>({n,count})).slice(1).filter(x=>x.count>0).sort((a,b)=>b.count-a.count||a.n-b.n).slice(0,6);
    const top= document.createElement('p');
    top.textContent=order.length ? `First ball frequency across ${order.length} logged draw orders: ${prominent.map(x=>fmt(x.n)+' ('+x.count+'×)').join(' · ')}.` : 'No draw orders recorded yet.';
    area.append(top);
    const group=new Map();
    for(const s of studies){
      const machine=s.equipment?.whiteMachine?.trim();
      if(!machine)continue;
      if(!group.has(machine))group.set(machine,{count:0,mix:[],motion:[]});
      const g=group.get(machine);g.count++;
      if(Number.isFinite(s.equipment.mixingSeconds))g.mix.push(s.equipment.mixingSeconds);
      if(Number.isFinite(s.video?.averageMotion))g.motion.push(s.video.averageMotion);
    }
    if(group.size){
      const title=document.createElement('strong');title.textContent='Group by observed white-ball machine';area.append(title);
      const list=document.createElement('ul');list.className='comparison-list';
      const mean=vals=>vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1):'not observed';
      [...group.entries()].sort((a,b)=>b[1].count-a[1].count).slice(0,12).forEach(([name,g])=>{
        const li=document.createElement('li');li.textContent=`${name}: ${g.count} studied draw(s) · average recorded mixing ${mean(g.mix)}s · average video motion ${mean(g.motion)}/100`;
        list.append(li);
      });area.append(list);
    }
    const footer=document.createElement('small');footer.textContent=`Samples and machine identifiers are user-observed and may be incomplete. Comparing groups without controlling for other variables does not demonstrate a causal bias. ${order.length<100?'Fewer than 100 draw orders: especially limited evidence.':''}`;
    area.append(footer);
  }
  async function exportStudies() {return await readAll();}
  async function importStudies(records) {
    if (!Array.isArray(records)) throw new Error('Invalid drawing-study backup.');
    let added=0;
    for (const s of records) {
      if (!s || !validDate(s.date)) continue;
      try {
        if(s.drawOrder) validateOrder(s.drawOrder,s.date);
        // Never overwrite an existing study (especially user observations).
        const old=await get(s.date);
        if(old && !(old.orderSource==='texas-snapshot' && old.updatedAt===0)) continue;
        await put({ ...defaultRow(s.date),date:s.date,drawOrder:s.drawOrder||null,
          orderSource:['manual','texas','video','import','texas-snapshot'].includes(s.orderSource)?s.orderSource:'import',
          equipment:typeof s.equipment==='object'&&s.equipment?s.equipment:{},
          videoUrl:validateVideoURL(s.videoUrl||''), notes:String(s.notes||'').slice(0,2000),
          video:s.video&&typeof s.video==='object'?s.video:null,
          updatedAt:Number.isFinite(s.updatedAt)?s.updatedAt:Date.now()});
        added++;
      }catch(e){console.warn('Skipped malformed study:',s?.date,e.message);}
    }
    studies=await readAll();renderStats();renderPatterns();
    return {added};
  }
  async function importDrawOrderCSV(ev) {
    const file=ev.target.files?.[0];if (!file)return;
    try {
      const lines=(await file.text()).replace(/^\uFEFF/,'').trim().split(/\r?\n/);
      let imported=0,skipped=0;
      for (let i=0;i<lines.length;i++){
        const line=lines[i].trim();if(!line)continue;
        const cells=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
        if(i===0 && /^(date|draw_date)$/i.test(cells[0]))continue;
        if(cells.length<6||!validDate(cells[0]))throw new Error(`Line ${i+1}: expected date YYYY-MM-DD and five ball numbers.`);
        const nums=cells.slice(1,6).map(x=>x===''?NaN:Number(x));
        validateOrder(nums,cells[0]);
        const old=await get(cells[0]);
        if (old?.drawOrder && old.orderSource!=='texas-snapshot'){skipped++;continue;}
        await put({...old,...defaultRow(cells[0]),...old,date:cells[0],drawOrder:nums,orderSource:'import',updatedAt:Date.now()});
        imported++;
      }
      studies=await readAll();renderStats();renderPatterns();
      if(currentDate) await openDate(currentDate);
      msg(`${imported} draw order(s) imported, ${skipped} existing order(s) preserved.`);
    }catch(error){msg('CSV import failed: '+error.message,true);}
    finally{ev.target.value='';}
  }
  function csv(value) {const s=String(value??'');return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
  function exportCSV() {
    const rows=[['date','ball1','ball2','ball3','ball4','ball5','source','white_machine','red_machine','white_ball_set','red_ball_set','mixing_seconds','camera_view','video_filename','frame_samples','avg_motion','peak_motion','white_ball_timestamps','notes']];
    for (const s of studies) rows.push([s.date,...(s.drawOrder||['','','','','']),s.orderSource,s.equipment?.whiteMachine,s.equipment?.redMachine,s.equipment?.whiteSet,s.equipment?.redSet,s.equipment?.mixingSeconds,s.equipment?.cameraView,s.video?.filename,s.video?.sampleCount,s.video?.averageMotion,s.video?.peakMotion,s.video?.markers?.map(m=>m.type+':'+m.number+'@'+Number(m.time).toFixed(1)).join(';'),s.notes]);
    downloadBlob(rows.map(r=>r.map(csv).join(',')).join('\r\n'),`powerball-drawing-studies-${new Date().toISOString().slice(0,10)}.csv`,'text/csv');
  }
  async function onHistorySync() {
    if (!currentDate)return;
    drawOfficial(currentDate);
    if (activeStudy?.drawOrder) {
      try {validateOrder(activeStudy.drawOrder,currentDate);}
      catch(error){msg('Check stored draw order: '+error.message,true);}
    }
  }
  async function init() {
    if (updating||!db)return;updating=true;
    try {
      await seedOrders();
      studies=await readAll();renderStats();renderPatterns();
      const initial=studies[0]?.date || new Date().toISOString().slice(0,10);
      await openDate(initial);
    }catch(error){msg('Drawing research storage unavailable: '+error.message,true);}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $r('study-load').addEventListener('click',()=>openDate($r('study-date').value));
    $r('study-date').addEventListener('change',()=>openDate($r('study-date').value));
    $r('study-form').addEventListener('submit',saveStudy);
    $r('attach-video').addEventListener('click',attachVideo);
    $r('clear-study').addEventListener('click',deleteStudy);
    $r('export-studies').addEventListener('click',exportCSV);
    $r('import-order-csv').addEventListener('change',importDrawOrderCSV);
    if(db)init();else document.addEventListener('number-bank-ready',init,{once:true});
  });
  window.ResearchLab={openDate,onHistorySync,exportStudies,importStudies,validateOrder};
})();
