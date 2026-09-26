import {getDatabase} from '@netlify/database';
import {DeviceCloudStore} from '../../../cloud/device-cloud-store.mjs';
import {CompanionStudioStore} from '../../../cloud/companion-studio-store.mjs';
import {studioObjects} from './companion-studio-media.mjs';
export const studioEnv=name=>globalThis.Netlify?.env?.get?.(name)??process.env[name];
let cached;
export function studioRuntime() {
  if(!cached){const db=getDatabase();cached={devices:new DeviceCloudStore({apiPool:db.pool,maintenancePool:db.pool,subjectPepper:studioEnv('NEXORA_SUBJECT_PEPPER')}),store:new CompanionStudioStore(db.pool)};}
  return {...cached,objects:studioObjects(),key:studioEnv('NEXORA_STUDIO_SIGNING_KEY') || studioEnv('NEXORA_SUBJECT_PEPPER'),
    available:studioEnv('NEXORA_STUDIO_ENABLED')==='true'&&Boolean(studioEnv('MESHY_API_KEY')),
    limits:{owner:Math.max(1,Math.min(5,Number(studioEnv('NEXORA_STUDIO_DAILY_LIMIT'))||2)),site:Math.max(1,Math.min(100,Number(studioEnv('NEXORA_STUDIO_SITE_LIMIT'))||20))}};
}
