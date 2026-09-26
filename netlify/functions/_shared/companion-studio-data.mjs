import { DeviceCloudError } from '../../../cloud/device-cloud-validation.mjs';
import { normalizeImages } from './companion-studio-media.mjs';
import { issueStudioToken, studioAuth } from './companion-studio-auth.mjs';
const root='/api/device-bridge/studio';
const text=(value,max)=>String(value||'').replace(/[<>\x00-\x1f]/g,' ').trim().slice(0,max);
export function cleanStudioProfile(body={}) {
  return {name:text(body.name,12)||'我的伙伴',personality:text(body.personality,160),
    voice:['cute','cool','beautiful'].includes(body.voice)?body.voice:'cute',
    memories:Array.isArray(body.memories)?body.memories.map(x=>text(x,120)).filter(Boolean).slice(-20):[]};
}
function publicJob(job) {
  const d=job.data;
  return {id:job.id,state:job.state,progress:job.progress,errorCode:job.error_code,createdAt:job.created_at,
    inputType:d.inputType,style:d.style,name:d.name,credits:Object.values(d.tasks||{}).reduce((n,t)=>n+(t.credits||0),0),
    assets:Object.fromEntries(Object.entries(d.assets||{}).map(([name,a])=>[name,{path:`${root}/jobs/${job.id}/assets/${name}`,sha256:a.sha256,bytes:a.bytes}])),
    sourceDeleted:!d.originalKeys?.length};
}
async function readBody(request) {
  if(Number(request.headers.get('content-length'))>4400000) throw new DeviceCloudError('图片太大，请缩小后重试。',413,'payload_too_large');
  const chunks=[];let size=0;
  if(request.body) for await(const c of request.body){size+=c.length;if(size>4400000)throw new DeviceCloudError('图片太大，请缩小后重试。',413,'payload_too_large');chunks.push(c);}
  try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new DeviceCloudError('invalid_json');}
}
export function createCompanionStudioHandler({devices,store,objects,key,available=false,limits={},normalize=normalizeImages,wake=async()=>{}}) {
  return async request => {
    const origin=request.headers.get('origin');
    const url=new URL(request.url);
    const permitted=!origin||origin==='null'||origin==='nexora-pet://app'||origin==='https://nexora.local'||origin===url.origin;
    const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Origin, Authorization'};
    if(origin&&permitted) Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'});
    const json=(body,status=200)=>Response.json(body,{status,headers});
    if(!permitted) return json({error:'forbidden'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    try {
      const auth=await studioAuth(request,devices,key);
      const path=url.pathname.slice(root.length);
      if(path==='/session'&&request.method==='POST') return json({url:`${url.origin}/companion-studio/#session=${issueStudioToken(auth,key)}`});
      if(path==='/config')return json({available,maxImages:3,dailyLimit:limits.owner||2,
        message:available?'每次创建使用 1 次角色生成额度；预览确认后才继续生成 3D。':'形象生成服务尚未开通。你仍可以设置伙伴性格和共同记忆。'});
      if(path==='/profile'&&request.method==='GET') {
        const saved=await store.profile(auth.ownerId);
        const job=saved.active_job_id?await store.get(auth.ownerId,saved.active_job_id):null;
        return json({profile:saved.profile,active:job?.state==='ready'?publicJob(job):null});
      }
      if(path==='/profile'&&request.method==='PUT')return json(await store.saveProfile(auth.ownerId,cleanStudioProfile(await readBody(request))));
      if(path==='/active'&&request.method==='POST')return json(await store.activate(auth.ownerId,(await readBody(request)).jobId));
      if(path==='/jobs'&&request.method==='GET')return json({jobs:(await store.list(auth.ownerId)).filter(j=>j.state!=='deleted').map(publicJob)});
      if(path==='/jobs'&&request.method==='POST') {
        if(!available)throw new DeviceCloudError('形象生成服务尚未开通，请稍后再试。',503,'generation_unavailable');
        const body=await readBody(request);
        if(!['photo','anime'].includes(body.inputType)||!['cute','anime'].includes(body.style)||body.consent!==true)throw new DeviceCloudError('请选择图片类型、风格，并确认图片使用授权。');
        const images=await normalize(body.images);
        const {job,created}=await store.create(auth,body.requestId,{inputType:body.inputType,style:body.style,details:text(body.details,180),name:text(body.name,12)||'我的伙伴',tasks:{},assets:{}},limits);
        if(created) {
          const data={...job.data,originalKeys:[]};
          try {
            for(let i=0;i<images.length;i++){const k=`${auth.ownerId}/${job.id}/source-${i}.png`;await objects.put(k,images[i],'image/png');data.originalKeys.push(k);}
            const queued=await store.transition(auth.ownerId,job.id,['uploading'],'queued_preview',data);
            await wake(auth,job.id).catch(()=>{});
            return json(publicJob(queued),201);
          } catch(e){await store.transition(auth.ownerId,job.id,['uploading'],'failed',data).catch(()=>{});throw e;}
        }
        return json(publicJob(job),200);
      }
      const match=path.match(/^\/jobs\/([0-9a-f-]{36})(?:\/(confirm|assets\/([a-z]+)|source|retry))?$/i);
      if(!match)throw new DeviceCloudError('not_found',404,'not_found');
      const job=await store.get(auth.ownerId,match[1]);
      if(job.state==='deleted')throw new DeviceCloudError('not_found',404,'not_found');
      if(!match[2]&&request.method==='GET')return json(publicJob(job));
      if(match[2]==='confirm'&&request.method==='POST') {
        if(!available)throw new DeviceCloudError('形象生成服务尚未开通。',503,'generation_unavailable');
        if(job.state!=='awaiting_preview')return json(publicJob(job)); // duplicate confirmation never starts another task
        const queued=await store.transition(auth.ownerId,job.id,['awaiting_preview'],'queued_model');
        await wake(auth,job.id).catch(()=>{});
        return json(publicJob(queued));
      }
      if(match[3]&&request.method==='GET') {
        const asset=job.data.assets?.[match[3]];
        if(!asset)throw new DeviceCloudError('not_found',404,'not_found');
        const stream=await objects.stream(asset.key);
        if(!stream)throw new DeviceCloudError('not_found',404,'not_found');
        return new Response(stream,{headers:{...headers,'Content-Type':match[3]==='preview'?'image/png':'model/gltf-binary'}});
      }
      if(match[2]==='retry'&&request.method==='POST') {
        // Only resume known GET/download work: a retry never repeats a paid POST.
        if(job.state.startsWith('queued_')||job.state.startsWith('poll_')) {await wake(auth,job.id);return json(publicJob(job));}
        if(job.state!=='failed'||!job.data.failedPollStage)throw new DeviceCloudError('该任务不能安全重试，请新建角色。',409,'retry_unavailable');
        const resumed=await store.transition(auth.ownerId,job.id,['failed'],`poll_${job.data.failedPollStage}`);
        await wake(auth,job.id).catch(()=>{});return json(publicJob(resumed));
      }
      if(request.method==='DELETE') {
        if(!['ready','failed','awaiting_preview'].includes(job.state))throw new DeviceCloudError('请等待当前生成阶段完成后再删除。',409,'job_busy');
        const keys=[...(job.data.originalKeys||[])];
        const data={...job.data,originalKeys:[]};
        if(match[2]!=='source') keys.push(...Object.values(job.data.assets||{}).map(a=>a.key));
        await store.transition(auth.ownerId,job.id,[job.state],match[2]==='source'?job.state:'deleted',data);
        for(const k of keys)await objects.delete(k);
        return json({deleted:true});
      }
      throw new DeviceCloudError('not_found',404,'not_found');
    } catch(error) {
      const known=error instanceof DeviceCloudError;
      return json({error:known?error.code:'unavailable',message:known?error.message:'工作室暂时不可用，请稍后重试。'},known?error.status:503);
    }
  };
}
