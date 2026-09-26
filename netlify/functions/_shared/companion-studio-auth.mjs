import {createHmac,timingSafeEqual} from 'node:crypto';
import {DeviceCloudError} from '../../../cloud/device-cloud-validation.mjs';
export function issueStudioToken(auth,key,now=Date.now()) {
  if(!key||key.length<32) throw new DeviceCloudError('工作室暂时不可用。',503,'unavailable');
  const body=Buffer.from(JSON.stringify({agentId:auth.agentId,ownerId:auth.ownerId,vaultId:auth.vaultId,vaultUuid:auth.vaultUuid,exp:now+3600000})).toString('base64url');
  return `NXS1.${body}.${createHmac('sha256',key).update(body).digest('base64url')}`;
}
export async function studioAuth(request,devices,key) {
  const value=String(request.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(value.startsWith('NXS1.')) {
    const [,body,signature,...rest]=value.split('.');
    if(rest.length||!body||!signature||!key||key.length<32) throw new DeviceCloudError('请从桌面菜单重新打开工作室。',401,'unauthorized');
    const expected=createHmac('sha256',key).update(body).digest();
    const actual=Buffer.from(signature,'base64url');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected)) throw new DeviceCloudError('unauthorized',401,'unauthorized');
    let auth;try {auth=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw new DeviceCloudError('unauthorized',401,'unauthorized');}
    if(!Number.isFinite(auth.exp)||auth.exp<Date.now()) throw new DeviceCloudError('工作室会话已过期，请从桌面菜单重新打开。',401,'unauthorized');
    const status=await devices.commandAgentStatus(auth.ownerId,{agentId:auth.agentId,vaultId:auth.vaultId});
    if(status.status!=='active') throw new DeviceCloudError('unauthorized',401,'unauthorized');
    return auth;
  }
  if(!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new DeviceCloudError('unauthorized',401,'unauthorized');
  return devices.authenticateCommandAgent(new URL(request.url).searchParams.get('agentId'),value);
}
