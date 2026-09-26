import {studioRuntime,studioEnv} from './_shared/companion-studio-runtime.mjs';
import {MeshyProvider} from './_shared/companion-studio-provider.mjs';
import {advanceStudioJob} from './_shared/companion-studio-worker.mjs';
export default async()=>{
  const runtime=studioRuntime();
  if(!runtime.available)return Response.json({processed:0});
  const processed=await advanceStudioJob({...runtime,provider:new MeshyProvider(studioEnv('MESHY_API_KEY'))});
  return Response.json({processed:Number(processed)});
};
export const config={schedule:'* * * * *'};
