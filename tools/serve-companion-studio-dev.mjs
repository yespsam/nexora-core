// Local integration harness. Fixtures never call Meshy and are never deployed.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {DeviceCloudStore} from '../cloud/device-cloud-store.mjs';
import {CompanionStudioStore} from '../cloud/companion-studio-store.mjs';
import {createCompanionStudioHandler} from '../netlify/functions/_shared/companion-studio-data.mjs';
import {advanceStudioJob} from '../netlify/functions/_shared/companion-studio-worker.mjs';
const fixture=process.argv.includes('--fixture-generation');
const root=resolve(new URL('..',import.meta.url).pathname);
const blobRoot=resolve(root,'output/studio-local');
const devices=new DeviceCloudStore();
const store=new CompanionStudioStore(devices.apiPool);
const worker=new CompanionStudioStore(devices.maintenancePool);
const key='local-studio-development-key-not-for-production';
function file(key){if(!/^[a-zA-Z0-9_./-]+$/.test(key)||key.includes('..'))throw new Error('invalid key');return resolve(blobRoot,key);}
const objects={
 async put(key,bytes){const p=file(key);await mkdir(resolve(p,'..'),{recursive:true});await writeFile(p,bytes);},
 async get(key){try{return await readFile(file(key));}catch{return null;}},
 async stream(key){const b=await this.get(key);return b?new Blob([b]).stream():null;},
 async delete(key){await unlink(file(key)).catch(()=>{});}
};
const handler=createCompanionStudioHandler({devices,store,objects,key,available:fixture,limits:{owner:5,site:100}});
const stageById=new Map();
const provider={
 async create(stage){const id=randomUUID();stageById.set(id,stage);return {id,path:stage};},
 async poll(task){const stage=task.path;return {status:'SUCCEEDED',progress:100,consumed_credits:0,face_count:20000,
  image_urls:['fixture://preview'],result:{rigged_character_glb_url:'fixture://model',animation_glb_url:`fixture://${stage}`}};}
};
const download=async url=>{
 const kind=url.slice('fixture://'.length);
 const p=kind==='preview'?'soulmate/assets/soulmate-icon-512.png':kind==='model'?'NEXORA_3D_CREATURES/CUTE_LUMO/model/rigged.glb':`NEXORA_3D_CREATURES/CUTE_LUMO/animations/${kind}.glb`;
 return readFile(resolve(root,p));
};
let running=false;
if(fixture)setInterval(async()=>{if(running)return;running=true;try{await devices.maintenancePool.query("UPDATE nexora_cloud.companion_studio_jobs SET next_run_at=now() WHERE state LIKE 'queued_%' OR state LIKE 'poll_%'");await advanceStudioJob({store:worker,objects,provider,download});}catch(e){console.error(e.message);}finally{running=false;}},1000);
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:4177');
  if(url.pathname==='/api/device-bridge/start'&&req.method==='POST'){res.setHeader('Content-Type','application/json');res.statusCode=201;res.end(JSON.stringify({credential:await devices.createStandaloneAgent()}));return;}
  if(url.pathname.startsWith('/api/device-bridge/studio/')){
   const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
   const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));
   if(fixture&&url.pathname.endsWith('/config')){const value=await response.json();value.message='本地集成测试：使用固定角色样本，不是真实生成，不消耗积分。';res.end(JSON.stringify(value));return;}
   if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();return;
  }
  const path=resolve(root,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
  if(!path.startsWith(root+'/')||url.pathname.includes('/.')){res.statusCode=403;res.end();return;}
  const body=await readFile(path);res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(body);
 }catch{res.statusCode=404;res.end('Not found');}
}).listen(4177,'127.0.0.1',()=>console.log(`Studio local: http://127.0.0.1:4177/companion-studio/ (fixture generation: ${fixture})`));
