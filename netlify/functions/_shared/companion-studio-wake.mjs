import {issueStudioToken} from './companion-studio-auth.mjs';
export async function wakeStudioJob(origin,auth,jobId,key) {
 const response=await fetch(new URL('/api/device-bridge/studio/run',origin),{method:'POST',headers:{Authorization:`Bearer ${issueStudioToken(auth,key)}`,'Content-Type':'application/json'},body:JSON.stringify({jobId}),signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('worker_unavailable');
}
