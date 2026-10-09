export function previewHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local activity preview</title>
  <style>html,body,iframe{width:100%;height:100%;margin:0;border:0}body{font-family:system-ui}</style></head><body>
  <p id="loading" role="status">Loading activity…</p><script src="d2l-emulator.js"></script><script>
  fetch('tenant-profile.json').then(r=>r.json()).then(profile=>{
    window.__emu = D2LEmulator.install({profile,learner:{id:'local-student',name:'Local learner',role:'Student'},attempt:1});
    const frame=document.createElement('iframe');frame.title='Cell division practice';frame.src='activity.html';
    document.getElementById('loading').remove();document.body.append(frame);
  }).catch(()=>document.getElementById('loading').textContent='Unable to load the local preview. Restart to try again.');
  </script></body></html>`;
}

export function activityHtml(version: number): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cell division practice</title>
  <style>body{font:16px/1.6 system-ui;color:#273239;background:#f7f8f5;margin:0;padding:28px}main{max-width:600px;margin:auto}h1{font:32px Georgia,serif}button{display:block;width:100%;margin:10px 0;padding:${version > 1 ? '18px' : '10px'};background:white;border:1px solid #74877a;border-radius:8px;text-align:left;color:#273239;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #7b2338}small{color:#4e5e58}</style></head>
  <body><main><small>PRACTICE · VERSION ${version}</small><h1>Cell division practice</h1><p>Question 1 of 10</p><h2>What is the main purpose of mitosis?</h2><button data-correct="true">Produce two genetically identical cells</button><button>Produce cells with half the chromosomes</button><button>Combine genetic material from two parents</button><p id="feedback" role="status"></p></main>
  <script>const api=parent.API;api.LMSInitialize('');document.querySelectorAll('button').forEach(button=>button.onclick=()=>{document.getElementById('feedback').textContent=button.dataset.correct?'Correct! Mitosis helps organisms grow and repair tissues.':'Try again. Think about how organisms grow and repair tissues.';api.LMSSetValue('cmi.core.score.raw',button.dataset.correct?'100':'0');api.LMSCommit('');});</script></body></html>`;
}
