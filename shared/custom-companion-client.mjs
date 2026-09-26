const prefix='/api/device-bridge/studio';
export class CompanionStudioClient {
  constructor({base=location.origin,agentId='',secret='',token=''}) {this.base=base.replace(/\/$/,'');this.agentId=agentId;this.token=token||secret;}
  async request(path,options={}) {
    const url=new URL(prefix+path,this.base);if(this.agentId)url.searchParams.set('agentId',this.agentId);
    const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${this.token}`,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
    if(!response.ok){let data;try{data=await response.json();}catch{}const error=new Error(data?.message||'连接失败，请稍后重试。');error.status=response.status;throw error;}
    return response.json();
  }
  async asset(asset) {
    const url=new URL(asset.path,this.base);if(this.agentId)url.searchParams.set('agentId',this.agentId);
    const response=await fetch(url,{headers:{Authorization:`Bearer ${this.token}`}});
    if(!response.ok)throw new Error('角色资源下载失败，请重试。');
    const blob=await response.blob();
    if(blob.size>18*1024*1024)throw new Error('角色资源过大。');
    if(asset.sha256){const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');if(actual!==asset.sha256)throw new Error('角色资源校验失败。');}
    return blob;
  }
}
const dbPromise=()=>new Promise((resolve,reject)=>{
  const req=indexedDB.open('nexora-custom-companion-v1',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('assets');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
async function cacheRead(key){try{const db=await dbPromise();return await new Promise((resolve,reject)=>{const r=db.transaction('assets').objectStore('assets').get(key);r.onsuccess=()=>{db.close();resolve(r.result);};r.onerror=()=>{db.close();reject(r.error);};});}catch{return null;}}
async function cacheWrite(key,value){try{const db=await dbPromise();await new Promise((resolve,reject)=>{const t=db.transaction('assets','readwrite');t.objectStore('assets').put(value,key);t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>{db.close();reject(t.error);};});}catch{}}
export async function loadCompanionEntry(client,job,{offline=false}={}) {
  const urls=[];
  try {
    const assets={};
    for(const name of ['model','idle','speaking']){
      const asset=job.assets[name];if(!asset?.sha256)throw new Error('角色资源不完整。');
      const key=asset.sha256;let blob=await cacheRead(key);
      if(!blob){if(offline)throw new Error('角色尚未缓存。');blob=await client.asset(asset);await cacheWrite(key,blob);}
      assets[name]=URL.createObjectURL(blob);urls.push(assets[name]);
    }
    return {id:`custom:${job.id}`,stage:'custom',yaw:0,model:assets.model,
      actions:Object.fromEntries(['idle','listening','nod','affection','wave','speaking','walk','run'].map(action=>[action,action==='speaking'?assets.speaking:assets.idle])),
      dispose:()=>urls.forEach(url=>URL.revokeObjectURL(url))};
  }catch(error){urls.forEach(url=>URL.revokeObjectURL(url));throw error;}
}
