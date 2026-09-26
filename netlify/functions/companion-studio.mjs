import {createCompanionStudioHandler} from './_shared/companion-studio-data.mjs';
import {studioRuntime} from './_shared/companion-studio-runtime.mjs';
import {wakeStudioJob} from './_shared/companion-studio-wake.mjs';
export default async request=>{
 const runtime=studioRuntime();
 return createCompanionStudioHandler({...runtime,wake:(auth,id)=>wakeStudioJob(request.url,auth,id,runtime.key)})(request);
};
export const config={path:'/api/device-bridge/studio/*',excludedPath:['/api/device-bridge/studio/run'],method:['GET','POST','PUT','DELETE','OPTIONS'],rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
