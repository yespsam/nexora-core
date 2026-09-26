import { fetchMeshyAsset, inspectGlb } from './companion-studio-media.mjs';
const nextStage={model:'rig',rig:'idle',idle:'speaking'};
export async function advanceStudioJob({store,objects,provider,download=fetchMeshyAsset,target}) {
  const job=await store.claim(target); if(!job) return false;
  const data=structuredClone(job.data); data.tasks ||= {}; data.assets ||= {};
  const [phase,stage]=job.state.split('_');
  try {
    if(phase==='submitting') {
      await store.updateWorker(job,'failed',data,0,'submission_unknown'); return true;
    }
    if(phase==='queued') {
      let images=[];
      if(stage==='preview'||stage==='model') {
        const keys=stage==='preview'?data.originalKeys:[data.assets.preview.key];
        images=await Promise.all(keys.map(async key=>{
          const b=await objects.get(key); if(!b) throw new Error('image_missing');
          return `data:image/png;base64,${b.toString('base64')}`;
        }));
      }
      // Persist intent BEFORE the paid POST; an ambiguous crash must never auto-submit twice.
      await store.updateWorker(job,`submitting_${stage}`,data,0,null,true);
      const task=await provider.create(stage,job,images);
      data.tasks[stage]={...task,submittedAt:Date.now()};
      await store.updateWorker(job,`poll_${stage}`,data);
      return true;
    }
    const task=await provider.poll(data.tasks[stage]);
    data.tasks[stage].credits=Number(task.consumed_credits)||0;
    if(['FAILED','CANCELED'].includes(task.status)) throw new Error('generation_failed');
    if(task.status!=='SUCCEEDED') {
      if(Date.now()-(data.tasks[stage].submittedAt || new Date(job.created_at).getTime())>24*3600000) throw new Error('generation_timeout');
      await store.updateWorker(job,job.state,data,Math.min(99,Math.max(0,Number(task.progress)||0))); return true;
    }
    let url,assetName;
    if(stage==='preview') {url=task.image_urls?.[0] || task.image_url; assetName='preview';}
    else if(stage==='rig') {url=task.result?.rigged_character_glb_url;assetName='model';}
    else if(stage==='idle'||stage==='speaking') {url=task.result?.animation_glb_url;assetName=stage;}
    if(stage==='model' && Number(task.face_count)>300000) throw new Error('model_too_complex');
    if(assetName) {
      if(!url) throw new Error('missing_generated_asset');
      let bytes=await download(url);
      let metadata;
      if(stage==='preview') {
        // Normalize provider images before they are reused or served.
        const {default:sharp}=await import('sharp');
        bytes=await sharp(bytes,{limitInputPixels:20000000}).resize(1536,1536,{fit:'inside'}).png().toBuffer();
        metadata={bytes:bytes.length};
      } else metadata=inspectGlb(bytes,stage!=='rig');
      const key=`${job.owner_id}/${job.id}/${assetName}.${stage==='preview'?'png':'glb'}`;
      await objects.put(key,bytes,stage==='preview'?'image/png':'model/gltf-binary');
      data.assets[assetName]={key,...metadata};
    }
    const state=stage==='preview'?'awaiting_preview':stage==='speaking'?'ready':`queued_${nextStage[stage]}`;
    await store.updateWorker(job,state,data,100);
  } catch(error) {
    if(phase==='poll' && !['generation_failed','generation_timeout'].includes(error.message)) data.failedPollStage=stage;
    const transient=phase==='poll' && (['provider_429','provider_500','provider_502','provider_503','provider_504'].includes(error.message)||error.name==='TimeoutError');
    await store.updateWorker(job,transient?job.state:'failed',data,0,
      transient?null:(phase==='queued' && !error.status ? 'submission_unknown':String(error.message).slice(0,60)));
  }
  return true;
}
