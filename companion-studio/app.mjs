import {Creature3DViewer} from '../shared/creature-3d-viewer.mjs';
import {CompanionStudioClient,loadCompanionEntry} from '../shared/custom-companion-client.mjs';
const $=s=>document.querySelector(s);
let client,config,jobs=[],activeId='',currentEntry,previewUrl='',busy=false,uploadUrls=[];
const viewer=new Creature3DViewer($('#viewer'),{frustumHeight:3.3,exposure:1.05});
viewer.load('cute');
const stages={uploading:'保存图片',queued_preview:'等待生成预览',submitting_preview:'提交预览',poll_preview:'生成形象预览',awaiting_preview:'等待你确认外观',queued_model:'等待生成 3D',submitting_model:'提交 3D 生成',poll_model:'生成 3D 模型',queued_rig:'等待绑定骨骼',submitting_rig:'提交骨骼绑定',poll_rig:'绑定骨骼',queued_idle:'准备待机动作',submitting_idle:'提交待机动作',poll_idle:'生成待机动作',queued_speaking:'准备说话动作',submitting_speaking:'提交说话动作',poll_speaking:'生成说话动作',ready:'已就绪',failed:'生成未完成'};
function notice(message){$('#notice').textContent=message||'';}
function displayTab(profile){$('#profile-panel').hidden=!profile;$('#create-panel').hidden=profile;$('#profile-tab').classList.toggle('selected',profile);$('#create-tab').classList.toggle('selected',!profile);}
$('#profile-tab').onclick=()=>displayTab(true);$('#create-tab').onclick=()=>displayTab(false);
async function initialize(){
  try{
    const incoming=new URLSearchParams(location.hash.slice(1)).get('session');
    if(incoming){sessionStorage.setItem('nexora-studio-session',incoming);history.replaceState(null,'',location.pathname);}
    const token=sessionStorage.getItem('nexora-studio-session');
    if(token)client=new CompanionStudioClient({token});
    else{
      let identity;try{identity=JSON.parse(localStorage.getItem('nexora-studio-identity'));}catch{}
      if(!identity){const r=await fetch('/api/device-bridge/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw new Error('暂时无法创建身份，请稍后重试。');identity=(await r.json()).credential;localStorage.setItem('nexora-studio-identity',JSON.stringify(identity));}
      client=new CompanionStudioClient(identity);
    }
    [config]=await Promise.all([client.request('/config')]);
    $('#service-note').textContent=config.message;$('#generate').disabled=!config.available;
    $('#connection').textContent=token?'已连接桌面伙伴':'网页独立伙伴';
    const saved=await client.request('/profile');
    for(const name of ['name','personality','voice'])$('#profile-form').elements[name].value=saved.profile[name]||(name==='name'?'我的伙伴':name==='voice'?'cute':'');
    $('#profile-form').elements.memories.value=(saved.profile.memories||[]).join('\n');
    activeId=saved.active?.id||'';
    if(saved.active)await showJob(saved.active);else $('#character-name').textContent=saved.profile.name||'我的伙伴';
    await refresh();
  }catch(e){notice(e.message);$('#connection').textContent='连接未完成';}
}
async function refresh(){if(!client)return;try{jobs=(await client.request('/jobs')).jobs;renderJobs();}catch(e){notice(e.message);}}
function button(label,handler){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await handler();await refresh();}catch(e){notice(e.message);}finally{b.disabled=false;}};return b;}
function renderJobs(){
  $('#job-list').replaceChildren();
  for(const job of jobs){
    const section=document.createElement('article');section.className='job';const head=document.createElement('div');head.className='job-head';
    const title=document.createElement('h3');title.textContent=job.name+(job.id===activeId?' · 使用中':'');const status=document.createElement('span');status.className='job-status';status.textContent=stages[job.state]||job.state;head.append(title,status);section.append(head);
    if(!['ready','failed','awaiting_preview'].includes(job.state)){const progress=document.createElement('progress');progress.max=100;if(job.progress>0&&job.progress<100)progress.value=job.progress;section.append(progress);}
    const controls=document.createElement('div');controls.className='job-buttons';
    if(job.state.startsWith('queued_')||job.state.startsWith('poll_'))controls.append(button('恢复处理',()=>client.request(`/jobs/${job.id}/retry`,{method:'POST',body:'{}'})));
    if(job.assets.preview)controls.append(button('查看外观',()=>showPreview(job)));
    if(job.state==='awaiting_preview')controls.append(button('确认外观，生成 3D',async()=>{await client.request(`/jobs/${job.id}/confirm`,{method:'POST',body:'{}'});notice('已开始制作 3D 伙伴，你可以关闭窗口，稍后回来查看。');}));
    if(job.state==='ready'){
      controls.append(button('预览动作',()=>showJob(job)));
      controls.append(button('开始陪伴',async()=>{await showJob(job);await client.request('/active',{method:'POST',body:JSON.stringify({jobId:job.id})});activeId=job.id;notice('已启用。桌面伙伴会自动同步；已有名字、性格和记忆会保留。');}));
    }
    if(job.state==='failed'){const p=document.createElement('p');p.textContent=job.errorCode==='submission_unknown'?'生成服务的提交结果尚未确认，为避免重复消耗额度，没有自动重试。请联系支持。':'本次生成未完成，原来的伙伴不受影响。可尝试恢复已提交任务，或换一张图片重新创建。';section.append(p);controls.append(button('尝试恢复',()=>client.request(`/jobs/${job.id}/retry`,{method:'POST',body:'{}'})));}
    if(['ready','failed','awaiting_preview'].includes(job.state)){
      if(!job.sourceDeleted)controls.append(button('删除原照片',()=>client.request(`/jobs/${job.id}/source`,{method:'DELETE'})));
      controls.append(button('删除角色',async()=>{if(!confirm('删除此角色和原图片？伙伴设置与共同记忆会保留。'))return;await client.request(`/jobs/${job.id}`,{method:'DELETE'});if(activeId===job.id){activeId='';await showBuiltin();}}));
    }
    section.append(controls);$('#job-list').append(section);
  }
}
async function showPreview(job){const blob=await client.asset(job.assets.preview);if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);$('#preview-image').src=previewUrl;$('#preview-image').hidden=false;$('#viewer').hidden=true;$('#preview-actions').hidden=true;$('#character-name').textContent=job.name;$('#character-caption').textContent='确认这张外观后，继续生成 3D。';$('#preview-label').textContent='形象预览';}
async function showJob(job){
  $('#viewer').hidden=false;$('#preview-image').hidden=true;
  const entry=await loadCompanionEntry(client,job);const loaded=await viewer.setCustomEntry(entry);
  if(!loaded){entry.dispose();throw new Error('模型加载失败，暂不启用。');}currentEntry?.dispose();currentEntry=entry;
  $('#preview-actions').hidden=false;$('#character-name').textContent=job.name;$('#character-caption').textContent='旋转查看，试试它的动作。';$('#preview-label').textContent='你的 3D 伙伴';
}
async function showBuiltin(){await viewer.setCustomEntry(null);currentEntry?.dispose();currentEntry=null;$('#preview-image').hidden=true;$('#viewer').hidden=false;$('#preview-actions').hidden=true;$('#preview-label').textContent='内置伙伴 · LUMO';}
for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>viewer.load('cute',b.dataset.action);
async function readFile(file){if(!['image/jpeg','image/png'].includes(file.type)||file.size>15*1024*1024)throw new Error('请选择不超过 15 MB 的 JPG 或 PNG 图片。');const bitmap=await createImageBitmap(file);const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return canvas.toDataURL('image/jpeg',.86);}
function showFiles(){uploadUrls.forEach(URL.revokeObjectURL);uploadUrls=[];$('#image-list').replaceChildren();for(const f of Array.from($('#images').files).slice(0,3)){const img=document.createElement('img');img.alt='上传的参考形象';img.src=URL.createObjectURL(f);uploadUrls.push(img.src);$('#image-list').append(img);}}
$('#images').onchange=showFiles;
$('#dropzone').ondragover=e=>{e.preventDefault();$('#dropzone').classList.add('dragging');};$('#dropzone').ondragleave=()=>$('#dropzone').classList.remove('dragging');$('#dropzone').ondrop=e=>{e.preventDefault();$('#dropzone').classList.remove('dragging');$('#images').files=e.dataTransfer.files;showFiles();};
let requestId=crypto.randomUUID();
$('#create-form').addEventListener('input',()=>{requestId=crypto.randomUUID();});
$('#create-form').onsubmit=async e=>{
  e.preventDefault();if(busy||!config?.available)return;busy=true;$('#generate').disabled=true;notice('正在上传图片…');
  try{const files=Array.from($('#images').files);if(!files.length||files.length>3)throw new Error('请选择 1–3 张图片。');const values=Object.fromEntries(new FormData(e.target));await client.request('/jobs',{method:'POST',body:JSON.stringify({...values,requestId,images:await Promise.all(files.map(readFile)),consent:values.consent==='on'})});requestId=crypto.randomUUID();notice('已加入生成队列，预览完成后请确认外观。');await refresh();}catch(error){notice(error.message);}finally{busy=false;$('#generate').disabled=!config?.available;}
};
$('#profile-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const value=Object.fromEntries(new FormData(e.target));value.memories=value.memories.split('\n').map(s=>s.trim()).filter(Boolean);if(value.memories.length>20||value.memories.some(m=>m.length>120))throw new Error('记忆最多 20 条，每条不超过 120 字。');await client.request('/profile',{method:'PUT',body:JSON.stringify(value)});$('#character-name').textContent=value.name;notice('已保存，下一次对话会使用这些设置和记忆。');}catch(error){notice(error.message);}finally{b.disabled=false;}};
$('#restore-builtin').onclick=async()=>{try{await client.request('/active',{method:'POST',body:JSON.stringify({jobId:null})});activeId='';await showBuiltin();await refresh();notice('已恢复内置形象，伙伴记忆保留。');}catch(e){notice(e.message);}};
initialize();setInterval(()=>{if(!document.hidden)refresh();},15000);
