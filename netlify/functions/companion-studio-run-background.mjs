import {studioRuntime,studioEnv} from './_shared/companion-studio-runtime.mjs';
import {studioAuth} from './_shared/companion-studio-auth.mjs';
import {MeshyProvider} from './_shared/companion-studio-provider.mjs';
import {advanceStudioJob} from './_shared/companion-studio-worker.mjs';
import {wakeStudioJob} from './_shared/companion-studio-wake.mjs';
export default async request=>{
 const runtime=studioRuntime();if(!runtime.available)return;
 const auth=await studioAuth(request,runtime.devices,runtime.key);
 const {jobId}=await request.json();await runtime.store.get(auth.ownerId,jobId);
 const deadline=Date.now()+12*60000;
 const target={id:jobId,ownerId:auth.ownerId};
 while(Date.now()<deadline){
  const job=await runtime.store.get(auth.ownerId,jobId);
  if(['awaiting_preview','ready','failed','deleted'].includes(job.state))return;
  await advanceStudioJob({...runtime,target,provider:new MeshyProvider(studioEnv('MESHY_API_KEY'))});
  await new Promise(resolve=>setTimeout(resolve,16000));
 }
 await wakeStudioJob(request.url,auth,jobId,runtime.key);
};
export const config={path:'/api/device-bridge/studio/run',method:'POST',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
