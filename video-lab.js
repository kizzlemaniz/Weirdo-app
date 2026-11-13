'use strict';
// Offline video study companion for Number Bank. This intentionally does not
// identify individual moving balls or claim to predict a lottery outcome.
(() => {
  let clipURL = null;
  let timer = null;
  let previous = null;
  let previousTime = -1;
  let points = [];
  let markers = [];
  let rackRegion = null;
  let rackFrame = null;
  let rackCapturedAt = null;
  let rackPoints = [];
  let rackReleaseAt = null;
  let dragStart = null;
  let rackPreviousTime = -1;

  const $lab = id => document.getElementById(id);
  const video = () => $lab('drawing-video');
  const ctx = () => $lab('video-sample-canvas').getContext('2d', { willReadFrequently: true });
  const pretty = n => String(n).padStart(2, '0');
  const seconds = n => `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2, '0')}`;

  function resetMeasurements(clearMarkers = false) {
    points = [];
    previous = null;
    previousTime = -1;
    if (clearMarkers) markers = [];
    if (clearMarkers) { rackRegion=null; rackFrame=null; rackCapturedAt=null; rackPoints=[]; rackReleaseAt=null; rackPreviousTime=-1; drawRackPreview(); renderRackZoom(); updateRackStatus(); }
    renderChart();
    updateStats();
    drawMarkers();
    $lab('video-status').textContent = 'Press Play to begin measuring motion.';
    $lab('video-feedback').textContent = '';
  }
  function openClip(file) {
    if (!file || !file.type.startsWith('video/')) {
      $lab('video-feedback').textContent = 'Please choose a valid video file.';
      return;
    }
    stopSampling();
    if (clipURL) URL.revokeObjectURL(clipURL);
    clipURL = URL.createObjectURL(file);
    video().src = clipURL;
    video().load();
    $lab('video-player-wrap').hidden = false;
    $lab('video-filename').textContent = file.name;
    resetMeasurements(true);
  }
  function frameSample() {
    const vid = video();
    if (!vid || vid.paused || vid.ended || vid.readyState < 2 || !vid.videoWidth) return;
    const t = vid.currentTime;
    if (Math.abs(t - previousTime) < 0.11) return;
    const canvas = $lab('video-sample-canvas');
    const cx = ctx();
    try {
      // A coarse motion proxy from grayscale image changes, downsampled to
      // 112x64. Sudden camera edits or overlays can appear as false 'motion'.
      cx.drawImage(vid, 0, 0, canvas.width, canvas.height);
      const rgba = cx.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = new Uint8Array(canvas.width * canvas.height / 2);
      let j = 0;
      for (let p = 0; p < canvas.width * canvas.height; p += 2) {
        const i = p * 4;
        gray[j++] = (rgba[i] * 0.299 + rgba[i+1] * 0.587 + rgba[i+2] * 0.114) | 0;
      }
      if (previous && t > previousTime && t - previousTime < 1.6) {
        let sum = 0;
        for (let k = 0; k < gray.length; k++) sum += Math.abs(gray[k] - previous[k]);
        const meanDifference = sum / gray.length;
        const index = Math.max(0, Math.min(100, meanDifference / 64 * 100));
        points.push({ time: t, motion: index });
        // Motion inside the user-selected loading rack region only. This does
        // not establish any numbered-ball identity or trajectory.
        if (rackRegion && t > rackPreviousTime) {
          const x0=Math.max(0,Math.floor(rackRegion.x*canvas.width/2)*2),
            x1=Math.min(canvas.width,Math.ceil((rackRegion.x+rackRegion.w)*canvas.width/2)*2),
            y0=Math.max(0,Math.floor(rackRegion.y*canvas.height)),
            y1=Math.min(canvas.height,Math.ceil((rackRegion.y+rackRegion.h)*canvas.height));
          let rackSum=0, rackCount=0;
          for(let yy=y0;yy<y1;yy++) for(let xx=x0;xx<x1;xx+=2){
            const idx=(yy*canvas.width+xx)/2;
            rackSum+=Math.abs(gray[idx]-previous[idx]);rackCount++;
          }
          if(rackCount) {
            const change=Math.max(0,Math.min(100,(rackSum/rackCount)/64*100));
            rackPoints.push({time:t,motion:change});
            if(rackPoints.length>40000)rackPoints=rackPoints.filter((_,i)=>i%2===0);
            if(rackPoints.length%3===0)updateRackStatus();
          }
          rackPreviousTime=t;
        }

        // Avoid unbounded in-memory video frame samples for very long files.
        // Summarize in fixed-size averaged bins if above 40k observations.
        if (points.length > 40000) {
          const reduced = [];
          for (let k = 0; k < points.length; k += 2) {
            if (points[k+1]) reduced.push({time:points[k+1].time,motion:(points[k].motion + points[k+1].motion)/2});
            else reduced.push(points[k]);
          }
          points = reduced;
        }
        if (points.length % 3 === 0) { updateStats(); renderChart(); }
      }
      previous = gray;
      previousTime = t;
    } catch (error) {
      stopSampling();
      $lab('video-status').textContent = 'Video frames cannot be analyzed on this device: ' + error.message;
    }
  }
  function startSampling() {
    stopSampling();
    $lab('video-status').textContent = 'Analyzing the video while it plays…';
    frameSample();
    timer = setInterval(frameSample, 240);
  }
  function stopSampling() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (points.length) {
      updateStats(); renderChart(); updateRackStatus();
      $lab('video-status').textContent = `Measured ${points.length.toLocaleString()} motion samples. Rewind or play more to continue.`;
    }
  }
  function updateStats() {
    const count = points.length;
    const mean = count ? points.reduce((a, p) => a + p.motion, 0) / count : 0;
    const peak = count ? Math.max(...points.map(p => p.motion)) : 0;
    $lab('motion-samples').textContent = count.toLocaleString();
    $lab('motion-average').textContent = count ? mean.toFixed(1) + '/100' : '—';
    $lab('motion-peak').textContent = count ? peak.toFixed(1) + '/100' : '—';
  }
  function renderChart() {
    const canvas = $lab('motion-chart');
    const cx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    cx.clearRect(0,0,w,h);
    cx.fillStyle = '#0b1928'; cx.fillRect(0,0,w,h);
    cx.strokeStyle = '#294254'; cx.lineWidth = 1;
    for (let y = 1; y <= 4; y++) {cx.beginPath();cx.moveTo(33,y*40);cx.lineTo(w-15,y*40);cx.stroke();}
    cx.fillStyle = '#8ea9b8';cx.font = '15px -apple-system, sans-serif';cx.fillText('100',3,24);cx.fillText('0',17,h-16);
    cx.fillText('Motion index over playback time',38,19);
    if (!points.length) {cx.fillStyle='#8ea9b8';cx.fillText('Play a video to view motion levels',70,105);return;}
    const dur = Math.max(points[points.length-1].time,video().duration||0,1);
    cx.beginPath();
    for (let i=0;i<points.length;i++) {
      const p=points[i];const x=33+(w-49)*p.time/dur;const y=h-20-(h-48)*(p.motion/100);
      if(i===0)cx.moveTo(x,y); else cx.lineTo(x,y);
    }
    cx.lineWidth=2.5;cx.strokeStyle='#b8f39a';cx.stroke();
    cx.fillStyle='#9bb7c0';cx.fillText(seconds(dur),w-64,h-4);
  }
  function drawMarkers() {
    const target = $lab('marker-list');
    target.replaceChildren();
    if (!markers.length) {target.textContent='No balls marked yet.';return;}
    markers.forEach((m,i) => {
      const chip = document.createElement('span');
      chip.className = 'marker-chip' + (m.type === 'special' ? ' special' : '');
      const label = document.createElement('span');
      label.textContent = `${m.type === 'special' ? 'Special' : 'White'} ${pretty(m.number)} @ ${seconds(m.time)}`;
      const del = document.createElement('button');del.type='button';del.textContent='×';del.setAttribute('aria-label','Remove ' + label.textContent);
      del.addEventListener('click', () => {markers.splice(i,1);drawMarkers();});
      chip.append(label,del);target.append(chip);
    });
  }
  function markBall() {
    const type = $lab('observed-type').value;
    const raw = $lab('observed-number').value;
    const n = Number(raw);
    const max = type === 'special' ? 26 : 69;
    if (!raw.trim() || !Number.isInteger(n) || n < 1 || n > max) {
      $lab('video-feedback').textContent = `Choose a whole-number ${type === 'special' ? 'special' : 'white'} ball from 1 to ${max}.`;
      return;
    }
    markers.push({ type, number: n, time: video().currentTime || 0 });
    $lab('observed-number').value = '';
    $lab('video-feedback').textContent = 'Ball marked. Repeat for the remaining balls.';
    drawMarkers();
  }
  async function saveObservedSet() {
    const white = markers.filter(m => m.type === 'main');
    const reds = markers.filter(m => m.type === 'special');
    if (white.length !== 5 || reds.length !== 1) {
      $lab('video-feedback').textContent = `Mark exactly 5 white balls and 1 special ball first (currently ${white.length} white, ${reds.length} special).`;
      return;
    }
    try {
      const record = makeRecord(white.map(m=>m.number), reds[0].number, 'observed',
        `Observed in ${($lab('video-filename').textContent || 'video').slice(0,100)}`);
      if (await findByKey(record.key)) throw new Error('This exact set is already in your bank.');
      await addRecord(record);
      await refreshBank();
      $lab('video-feedback').textContent = 'Observed result saved in your number bank.';
      toast('Video result saved');
    } catch(error) { $lab('video-feedback').textContent = error.message; }
  }
  function exportVideoCSV() {
    if (!points.length && !markers.length) {
      $lab('video-feedback').textContent = 'Play a video or mark some balls before exporting.';
      return;
    }
    const lines=['type,time_seconds,value,ball_type,ball_number'];
    for (const p of points) lines.push(`motion,${p.time.toFixed(3)},${p.motion.toFixed(3)},,`);
    for (const m of markers) lines.push(`ball,${m.time.toFixed(3)},,${m.type},${m.number}`);
    for (const p of rackPoints) lines.push(`rack_motion,${p.time.toFixed(3)},${p.motion.toFixed(3)},,`);
    if(rackReleaseAt!==null) lines.push(`rack_release,${rackReleaseAt.toFixed(3)},,,`);
    downloadBlob(lines.join('\r\n'),`drawing-video-analysis-${new Date().toISOString().slice(0,10)}.csv`,'text/csv');
    toast('Video analysis exported');
  }
  function analyseBank() {
    const btn=$lab('analyze-history'); btn.disabled=true;
    const target=$lab('history-analysis');
    target.textContent='Counting stored results…';
    const counts=Array(70).fill(0),special=Array(27).fill(0);
    let total=0;
    const req=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).openCursor();
    req.onsuccess=()=>{
      const cur=req.result;
      if(cur) {
        const r=cur.value;
        if(Array.isArray(r.main) && r.main.length===5 && Number.isInteger(r.special)) {
          r.main.forEach(n=>{if(n>=1 && n<=69) counts[n]++;});
          if(r.special>=1 && r.special<=26) special[r.special]++;
          total++;
        }
        cur.continue();
      } else {btn.disabled=false; renderInsights(target,total,counts,special);}
    };
    req.onerror=()=>{btn.disabled=false;target.textContent='Could not analyze the bank: ' + req.error.message;};
  }
  function renderInsights(target,total,counts,special) {
    target.replaceChildren();
    if(!total) {target.textContent='No sets yet. Add real past drawing results or generate some combinations first.';return;}
    const lead=document.createElement('div');lead.className='insight-top';
    const metric=(label,value)=>{
      const d=document.createElement('div');d.className='insight-metric';
      const sm=document.createElement('small');sm.textContent=label;
      const strong=document.createElement('strong');strong.textContent=value;
      d.append(sm,strong);return d;
    };
    lead.append(metric('SETS ANALYZED',total.toLocaleString()), metric('EXPECTED / WHITE', (total*5/69).toFixed(1)), metric('EXPECTED / SPECIAL',(total/26).toFixed(1)));
    target.append(lead);
    const grid=document.createElement('div');grid.className='insight-grid';
    const list=(title,values,topColor)=>{
      const section=document.createElement('div');
      const heading=document.createElement('h3');heading.textContent=title;section.append(heading);
      const group=document.createElement('div');group.className='freq-list';
      const rankings=values.map((count,n)=>({n,count})).slice(1).sort((a,b)=>b.count-a.count||a.n-b.n).slice(0,8);
      const max=Math.max(1,...rankings.map(v=>v.count));
      for(const item of rankings){
        const row=document.createElement('div');row.className='freq-row';
        const label=document.createElement('span');label.className='freq-id';label.textContent=pretty(item.n);
        const bar=document.createElement('div');bar.className='freq-meter' + (topColor ? ' gold' : '');
        const fill=document.createElement('span');fill.style.width=`${item.count/max*100}%`;bar.append(fill);
        const num=document.createElement('span');num.className='freq-count';num.textContent=item.count;
        row.append(label,bar,num);group.append(row);
      }
      section.append(group);return section;
    };
    grid.append(list('Most frequent white balls',counts,false), list('Most frequent special balls',special,true));target.append(grid);
    const caveat=document.createElement('p');caveat.className='insight-disclaimer';
    caveat.textContent='Counts include every saved set, including your own generated picks. These are descriptive frequencies, not a validated forecast. With fair independent drawings, a number drawn often in the past is not more likely to appear next time.';
    target.append(caveat);
  }
  function rackCanvas(id) { return $lab(id); }
  function frameLocation(ev) {
    const b=rackCanvas('rack-preview').getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(ev.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(ev.clientY-b.top)/b.height))};
  }
  function drawRackPreview() {
    const canvas=rackCanvas('rack-preview'),cx=canvas.getContext('2d');
    cx.fillStyle='#0c1c2d';cx.fillRect(0,0,canvas.width,canvas.height);
    if(!rackFrame) {cx.fillStyle='#a6bcca';cx.font='26px sans-serif';cx.fillText('Capture paused video frame first',55,canvas.height/2);return;}
    cx.drawImage(rackFrame,0,0,canvas.width,canvas.height);
    if(rackRegion){cx.strokeStyle='#b6fb72';cx.lineWidth=6;cx.strokeRect(rackRegion.x*canvas.width,rackRegion.y*canvas.height,rackRegion.w*canvas.width,rackRegion.h*canvas.height);}
  }
  function renderRackZoom() {
    const target=rackCanvas('rack-zoom'),cx=target.getContext('2d');
    cx.fillStyle='#0c1c2d';cx.fillRect(0,0,target.width,target.height);
    if(!rackFrame||!rackRegion){cx.fillStyle='#a6bcca';cx.font='20px sans-serif';cx.fillText('Select a rack region in the image above',25,60);return;}
    const r=rackRegion, f=rackFrame;
    cx.imageSmoothingEnabled=true;cx.imageSmoothingQuality='high';
    const mode=$lab('rack-enhance').value;
    cx.filter=mode==='normal'?'none':mode==='sharpen'?'contrast(1.7) brightness(1.07)':'contrast(1.6) brightness(1.07)';
    cx.drawImage(f,r.x*f.width,r.y*f.height,r.w*f.width,r.h*f.height,0,0,target.width,target.height);
    cx.filter='none';
    if(mode==='sharpen') {
      const current=cx.getImageData(0,0,target.width,target.height);
      const input=current.data,output=new Uint8ClampedArray(input);
      for(let y=1;y<target.height-1;y++)for(let x=1;x<target.width-1;x++){
        const k=(y*target.width+x)*4;
        for(let c=0;c<3;c++)output[k+c]=Math.max(0,Math.min(255,5*input[k+c]-input[k-4+c]-input[k+4+c]-input[k-target.width*4+c]-input[k+target.width*4+c]));
      }
      current.data.set(output);cx.putImageData(current,0,0);
    }
  }
  function captureRack() {
    const v=video();
    if(!v||v.readyState<2||!v.videoWidth){$lab('rack-frame-status').textContent='Load a video and move to a frame showing the racks first.';return;}
    if(!v.paused){v.pause();}
    const f=document.createElement('canvas');
    const scale=Math.min(1,1200/v.videoWidth);f.width=Math.max(1,Math.round(v.videoWidth*scale));f.height=Math.max(1,Math.round(v.videoHeight*scale));
    try {f.getContext('2d').drawImage(v,0,0,f.width,f.height);} catch(error){$lab('rack-frame-status').textContent='Could not capture video image: '+error.message;return;}
    rackFrame=f;rackCapturedAt=v.currentTime;
    rackRegion=null;rackPoints=[];rackReleaseAt=null;rackPreviousTime=-1;
    $lab('rack-frame-status').textContent=`Captured frame at ${seconds(rackCapturedAt)}. Drag over the visible rack to choose a region.`;
    drawRackPreview();renderRackZoom();updateRackStatus();
  }
  function updateRackStatus(){
    const count=rackPoints.length,avg=count?rackPoints.reduce((a,p)=>a+p.motion,0)/count:null;
    $lab('rack-count').textContent=count.toLocaleString();
    $lab('rack-avg').textContent=count?avg.toFixed(1)+'/100':'—';
    $lab('rack-drop-time').textContent=rackReleaseAt==null?'—':seconds(rackReleaseAt);
    $lab('rack-status').textContent=!rackRegion?'No rack region selected. Capture a frame and draw around the loading rack.':
      count?`Tracked ${count} frame changes within the selected rack. This measures visual change, not readable ball identities.`:
      'Rack region selected. Rewind to before release and press Play to collect rack-only motion samples.';
  }
  function clearRack(){rackRegion=null;rackPoints=[];rackReleaseAt=null;rackPreviousTime=-1;drawRackPreview();renderRackZoom();updateRackStatus();}
  function releaseMark(){if(!video().src)return;$lab('rack-drop-time').textContent=seconds(video().currentTime);rackReleaseAt=Number(video().currentTime.toFixed(2));updateRackStatus();}
  function saveRackImage(){
    if(!rackFrame||!rackRegion){$lab('rack-frame-status').textContent='Capture and select a rack region first.';return;}
    const canvas=rackCanvas('rack-zoom');
    canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='weirdo-rack-closeup.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);},'image/png');
    $lab('rack-frame-status').textContent='Enhanced still exported. You can share the PNG here for a closer visual check.';
  }
  function rackSnapshot() {
    if(!rackRegion&&!rackPoints.length)return null;
    const count=rackPoints.length,mean=count?rackPoints.reduce((a,p)=>a+p.motion,0)/count:null;
    const peak=count?Math.max(...rackPoints.map(p=>p.motion)):null;
    const stride=Math.max(1,Math.ceil(count/250));
    return {region:rackRegion?{...rackRegion}:null,capturedAt:rackCapturedAt,group:$lab('rack-type').value,
      legibility:$lab('rack-legible').value,loadingOrder:$lab('rack-loading-order').value,
      releaseTime:rackReleaseAt,notes:$lab('rack-notes').value.trim().slice(0,500),sampleCount:count,
      averageMotion:mean==null?null:Number(mean.toFixed(2)),peakMotion:peak==null?null:Number(peak.toFixed(2)),
      motionPoints:rackPoints.filter((_,i)=>i%stride===0).map(p=>({time:Number(p.time.toFixed(2)),motion:Number(p.motion.toFixed(2))}))};
  }

  function getSnapshot() {
    const count = points.length;
    const average = count ? points.reduce((sum,p)=>sum+p.motion,0)/count : null;
    const peak = count ? Math.max(...points.map(p=>p.motion)) : null;
    const stride = Math.max(1,Math.ceil(count/300));
    return {
      filename: $lab('video-filename').textContent || '',
      sampleCount: count,
      averageMotion: average === null ? null : Number(average.toFixed(2)),
      peakMotion: peak === null ? null : Number(peak.toFixed(2)),
      duration: Number.isFinite(video().duration) ? Number(video().duration.toFixed(2)) : null,
      motionPoints: points.filter((_,i)=>i%stride===0).map(p=>({time:Number(p.time.toFixed(2)),motion:Number(p.motion.toFixed(2))})),
      markers: markers.map(m=>({...m})),
      rack: rackSnapshot()
    };
  }
  window.VideoLab = { getSnapshot };
  document.addEventListener('DOMContentLoaded', () => {
    drawRackPreview();renderRackZoom();updateRackStatus();
    const rackPreview=rackCanvas('rack-preview');
    rackPreview.addEventListener('pointerdown',ev=>{if(!rackFrame)return;dragStart=frameLocation(ev);try{rackPreview.setPointerCapture(ev.pointerId);}catch(_){};});
    rackPreview.addEventListener('pointerup',ev=>{
      if(!dragStart)return;const end=frameLocation(ev);
      const r={x:Math.min(dragStart.x,end.x),y:Math.min(dragStart.y,end.y),w:Math.abs(dragStart.x-end.x),h:Math.abs(dragStart.y-end.y)};
      dragStart=null;
      if(r.w<0.02||r.h<0.02)return;
      rackRegion=r;rackPoints=[];rackPreviousTime=-1;
      drawRackPreview();renderRackZoom();updateRackStatus();
    });
    $lab('rack-capture').addEventListener('click',captureRack);
    $lab('rack-clear').addEventListener('click',clearRack);
    $lab('rack-enhance').addEventListener('change',renderRackZoom);
    $lab('rack-save-image').addEventListener('click',saveRackImage);
    $lab('rack-mark-drop').addEventListener('click',releaseMark);
    $lab('video-file').addEventListener('change',ev=>{
      const file=ev.target.files?.[0];if(file)openClip(file);
      ev.target.value='';
    });
    video().addEventListener('play',startSampling);
    video().addEventListener('pause',stopSampling);
    video().addEventListener('ended',stopSampling);
    video().addEventListener('seeking',()=>{previous=null;previousTime=-1;rackPreviousTime=-1;});
    $lab('reset-video').addEventListener('click',()=>resetMeasurements(true));
    $lab('observed-type').addEventListener('change',ev=>{$lab('observed-number').max=ev.target.value==='special'?'26':'69';});
    $lab('mark-observed').addEventListener('click',markBall);
    $lab('save-observed').addEventListener('click',saveObservedSet);
    $lab('export-video-report').addEventListener('click',exportVideoCSV);
    $lab('analyze-history').addEventListener('click', () => {
      if (window.HistoryLab) window.HistoryLab.showInsights();
      else analyseBank();
    });
    $lab('analyze-my-bank').addEventListener('click',analyseBank);
    renderChart();
  });
  window.addEventListener('pagehide',()=>{stopSampling();if(clipURL)URL.revokeObjectURL(clipURL);});
})();
