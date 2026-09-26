import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:4177';
const image=(await readFile(new URL('../soulmate/assets/soulmate-icon-512.png',import.meta.url))).toString('base64');
async function identity(){const r=await fetch(base+'/api/device-bridge/start',{method:'POST'});assert.equal(r.status,201);return (await r.json()).credential;}
const a=await identity(),b=await identity();
async function api(auth,path,method='GET',body){const r=await fetch(`${base}/api/device-bridge/studio${path}?agentId=${auth.agentId}`,{method,headers:{Authorization:`Bearer ${auth.secret}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.arrayBuffer()};}
const jobs=[];
for(const inputType of ['photo','anime']){
 const body={requestId:randomUUID(),inputType,style:'cute',name:'测试陪伴',consent:true,images:[`data:image/png;base64,${image}`]};
 const created=await api(a,'/jobs','POST',body);assert.equal(created.status,201,JSON.stringify(created.body));jobs.push(created.body.id);
 const duplicate=await api(a,'/jobs','POST',body);assert.equal(duplicate.body.id,created.body.id);
 assert.equal((await api(b,`/jobs/${created.body.id}`)).status,404);
 assert.equal((await api(b,`/jobs/${created.body.id}/assets/preview`)).status,404);
}
async function wait(id,state){const deadline=Date.now()+90000;while(Date.now()<deadline){const r=await api(a,`/jobs/${id}`);if(r.body.state===state)return r.body;assert.notEqual(r.body.state,'failed',JSON.stringify(r.body));await new Promise(r=>setTimeout(r,1100));}throw new Error(`Timed out: ${state}`);}
for(const id of jobs){await wait(id,'awaiting_preview');const p=await api(a,`/jobs/${id}/assets/preview`);assert.equal(p.status,200);const c=await api(a,`/jobs/${id}/confirm`,'POST',{});assert.equal(c.status,200);assert.equal((await api(a,`/jobs/${id}/confirm`,'POST',{})).status,200);}
for(const id of jobs){await wait(id,'ready');assert.equal((await api(a,`/jobs/${id}/assets/model`)).status,200);}
assert.equal((await api(b,'/active','POST',{jobId:jobs[0]})).status,409);
const profile={name:'小伴',personality:'温柔并认真倾听',voice:'beautiful',memories:['我喜欢散步','重要日期是 10 月 1 日']};
assert.equal((await api(a,'/profile','PUT',profile)).status,200);
await api(a,'/active','POST',{jobId:jobs[0]});await api(a,'/active','POST',{jobId:jobs[1]});
const saved=await api(a,'/profile');assert.deepEqual(saved.body.profile.memories,profile.memories);assert.equal(saved.body.active.id,jobs[1]);
assert.deepEqual((await api(b,'/profile')).body.profile,{});
for(const id of jobs){assert.equal((await api(a,`/jobs/${id}/source`,'DELETE')).status,200);assert.equal((await api(a,`/jobs/${id}`)).body.sourceDeleted,true);assert.equal((await api(a,`/jobs/${id}`,'DELETE')).status,200);}
assert.equal((await api(a,'/profile')).body.active,null);assert.deepEqual((await api(a,'/profile')).body.profile.memories,profile.memories);
console.log('PASS: photo + anime upload, idempotency, preview confirmation, background pipeline, private assets, activation, retained memories, deletion. Fixture models only; no Meshy credits used.');
