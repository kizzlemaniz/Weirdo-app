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
      updateStats(); renderChart();
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
      markers: markers.map(m=>({...m}))
    };
  }
  window.VideoLab = { getSnapshot };
  document.addEventListener('DOMContentLoaded', () => {
    $lab('video-file').addEventListener('change',ev=>{
      const file=ev.target.files?.[0];if(file)openClip(file);
      ev.target.value='';
    });
    video().addEventListener('play',startSampling);
    video().addEventListener('pause',stopSampling);
    video().addEventListener('ended',stopSampling);
    video().addEventListener('seeking',()=>{previous=null;previousTime=-1;});
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
