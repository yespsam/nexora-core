import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createCompanionStudioHandler,cleanStudioProfile} from '../netlify/functions/_shared/companion-studio-data.mjs';
import {issueStudioToken,studioAuth} from '../netlify/functions/_shared/companion-studio-auth.mjs';
import {advanceStudioJob} from '../netlify/functions/_shared/companion-studio-worker.mjs';
import {normalizeImages,inspectGlb,fetchMeshyAsset} from '../netlify/functions/_shared/companion-studio-media.mjs';
import {MeshyProvider} from '../netlify/functions/_shared/companion-studio-provider.mjs';
const key='test-only-key-with-at-least-thirty-two-characters';
const auth={agentId:'agent',ownerId:'owner',vaultId:'vault'};
const devices={async authenticateCommandAgent(id,secret){if(secret!=='A'.repeat(43))throw new Error('bad secret');return auth;},async commandAgentStatus(){return {status:'active'};}};
const request=(path,options={})=>new Request('https://example.test/api/device-bridge/studio'+path,{...options,headers:{Authorization:'Bearer '+'A'.repeat(43),...options.headers}});

test('studio handoff tokens expire, reject tampering, and honor credential revocation',async()=>{
 const token=issueStudioToken(auth,key);
 const req=()=>request('/profile',{headers:{Authorization:`Bearer ${token}`}});
 assert.equal((await studioAuth(req(),devices,key)).ownerId,'owner');
 await assert.rejects(studioAuth(request('/profile',{headers:{Authorization:`Bearer ${token.slice(0,-2)}xx`}}),devices,key));
 await assert.rejects(studioAuth(request('/profile',{headers:{Authorization:`Bearer ${issueStudioToken(auth,key,Date.now()-7200000)}`}}),devices,key));
 await assert.rejects(studioAuth(req(),{...devices,async commandAgentStatus(){return {status:'revoked'};}},key));
});
test('studio is explicit when generation is unconfigured and never creates paid tasks',async()=>{
 let created=false;
 const handler=createCompanionStudioHandler({devices,store:{async create(){created=true;}},objects:{},key,available:false});
 assert.equal((await (await handler(request('/config'))).json()).available,false);
 assert.equal((await handler(request('/jobs',{method:'POST',body:'{}'}))).status,503);
 assert.equal(created,false);
 assert.equal((await handler(request('/profile',{headers:{Origin:'https://evil.test'}}))).status,403);
});
test('asset access always resolves through the authenticated owner',async()=>{
 let called=false;
 const handler=createCompanionStudioHandler({devices,store:{async get(owner,id){assert.equal(owner,'owner');called=true;throw new Error('not owned');}},objects:{async stream(){throw new Error('must not expose asset');}},key});
 assert.equal((await handler(request('/jobs/ef53f13f-b1a5-47ff-a759-171557c32e13/assets/model'))).status,503);assert.ok(called);
});
test('image uploads are decoded, bounded and stripped to normalized PNGs',async()=>{
 const raw=await readFile(new URL('../soulmate/assets/soulmate-icon-512.png',import.meta.url));
 const [clean]=await normalizeImages([`data:image/png;base64,${raw.toString('base64')}`]);
 assert.equal(clean.subarray(1,4).toString(),'PNG');
 await assert.rejects(normalizeImages(['data:image/png;base64,AAAA']));
 await assert.rejects(normalizeImages(Array(4).fill('x')));
 await assert.rejects(normalizeImages(['https://example.com/a.png']));
});
test('GLB validation requires a real skeleton and animation, and blocks remote assets',async()=>{
 const model=await readFile(new URL('../NEXORA_3D_CREATURES/CUTE_LUMO/model/rigged.glb',import.meta.url));
 const action=await readFile(new URL('../NEXORA_3D_CREATURES/CUTE_LUMO/animations/idle.glb',import.meta.url));
 assert.equal(inspectGlb(model).sha256.length,64);assert.ok(inspectGlb(action,true).bytes);
 assert.throws(()=>inspectGlb(Buffer.from('not a glb')));
 let fetched=false;await assert.rejects(fetchMeshyAsset('http://127.0.0.1/admin',()=>{fetched=true;}));assert.equal(fetched,false);
});
test('paid task intent is persisted before submission and ambiguous submissions are never repeated',async()=>{
 const calls=[];let creates=0;
 const job={id:'job',owner_id:'owner',state:'queued_rig',data:{tasks:{model:{id:'model'}},assets:{}}};
 const store={async claim(){return job;},async updateWorker(job,state,data){calls.push(state);}};
 const provider={async create(){creates++;assert.equal(calls[0],'submitting_rig');throw new Error('network timeout');}};
 await advanceStudioJob({store,objects:{},provider});assert.deepEqual(calls,['submitting_rig','failed']);
 job.state='submitting_rig';calls.length=0;await advanceStudioJob({store,objects:{},provider});assert.equal(creates,1);assert.deepEqual(calls,['failed']);
});
test('preview completion waits for user confirmation before model generation',async()=>{
 const raw=await readFile(new URL('../soulmate/assets/soulmate-icon-512.png',import.meta.url));
 const job={id:'job',owner_id:'owner',state:'poll_preview',data:{tasks:{preview:{id:'task'}},assets:{}}};
 let finalState;
 await advanceStudioJob({store:{async claim(){return job;},async updateWorker(j,state){finalState=state;}},objects:{async put(){}},provider:{async poll(){return {status:'SUCCEEDED',image_urls:['https://assets.meshy.ai/a.png']};}},download:async()=>raw});
 assert.equal(finalState,'awaiting_preview');
});
test('Meshy adapter selects distinct photo/anime prompts and creates rig-ready low-poly models',async()=>{
 const calls=[];const provider=new MeshyProvider('test',async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({result:'task-id'});});
 for(const inputType of ['photo','anime'])await provider.create('preview',{data:{inputType,style:'cute'}},['data:image/png;base64,AA==']);
 assert.match(calls[0].prompt,/person/);assert.match(calls[1].prompt,/reference character/);
 await provider.create('model',{data:{}},['data:image/png;base64,AA==']);assert.equal(calls[2].pose_mode,'t-pose');assert.equal(calls[2].target_polycount,20000);
});
test('companion settings retain only bounded editable memories and supported voices',()=>{
 const p=cleanStudioProfile({name:' 伙伴 ',voice:'unknown',memories:Array(30).fill('x'.repeat(200)),personality:'gentle'});
 assert.equal(p.name,'伙伴');assert.equal(p.voice,'cute');assert.equal(p.memories.length,20);assert.equal(p.memories[0].length,120);
});
