import sharp from 'sharp';
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { DeviceCloudError } from '../../../cloud/device-cloud-validation.mjs';

export const MAX_ASSET_BYTES = 18 * 1024 * 1024;
export function studioObjects() {
  const store = getStore({name:'nexora-companion-studio-v1',consistency:'strong'});
  return {
    async put(key,bytes,type) { await store.set(key,bytes,{metadata:{contentType:type}}); },
    async get(key) { const b=await store.get(key,{type:'arrayBuffer'}); return b ? Buffer.from(b) : null; },
    async stream(key) { return store.get(key,{type:'stream'}); },
    async delete(key) { await store.delete(key); }
  };
}
export async function normalizeImages(images) {
  if(!Array.isArray(images)||images.length<1||images.length>3) throw new DeviceCloudError('请上传 1–3 张图片。');
  return Promise.all(images.map(async value => {
    if(typeof value!=='string'||value.length>2800000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new DeviceCloudError('仅支持 JPG 或 PNG 图片，每张不超过 2 MB。');
    const bytes=Buffer.from(value.split(',')[1],'base64');
    try {
      return await sharp(bytes,{limitInputPixels:20000000,animated:false}).rotate().resize(1536,1536,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
    } catch { throw new DeviceCloudError('无法读取图片，请换一张 JPG 或 PNG 图片。'); }
  }));
}
export function inspectGlb(bytes, animated=false) {
  const b=Buffer.from(bytes);
  if(b.length<24||b.length>MAX_ASSET_BYTES||b.readUInt32LE(0)!==0x46546c67||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length||b.readUInt32LE(16)!==0x4e4f534a) throw new Error('invalid_glb');
  const size=b.readUInt32LE(12);
  if(size>4*1024*1024||20+size>b.length) throw new Error('invalid_glb');
  const json=JSON.parse(b.subarray(20,20+size).toString());
  if(!json.meshes?.length||!json.skins?.length) throw new Error('missing_rig');
  if([...(json.buffers||[]),...(json.images||[])].some(x=>x.uri && !x.uri.startsWith('data:'))) throw new Error('external_resources');
  if(animated&&!json.animations?.[0]?.channels?.length) throw new Error('missing_animation');
  let vertices=0;
  for(const mesh of json.meshes) for(const p of mesh.primitives||[]) vertices+=json.accessors?.[p.attributes?.POSITION]?.count||0;
  if(vertices>900000) throw new Error('model_too_complex');
  return {sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length};
}
export async function fetchMeshyAsset(url, fetcher=fetch) {
  const target=new URL(url);
  if(target.protocol!=='https:'||!['assets.meshy.ai','cdn.meshy.ai'].includes(target.hostname)) throw new Error('invalid_asset_host');
  const response=await fetcher(target,{signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok||Number(response.headers.get('content-length'))>MAX_ASSET_BYTES) throw new Error('asset_download_failed');
  const chunks=[]; let total=0;
  for await(const chunk of response.body) {
    total+=chunk.length; if(total>MAX_ASSET_BYTES) throw new Error('asset_too_large'); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
