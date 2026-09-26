export class MeshyProvider {
  constructor(key,fetcher=fetch) { this.key=key; this.fetcher=fetcher; }
  async request(path,body) {
    const response=await this.fetcher('https://api.meshy.ai/openapi/v1/'+path,{
      method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(18000)
    });
    if(!response.ok) { const e=new Error(`provider_${response.status}`); e.status=response.status; throw e; }
    return response.json();
  }
  async create(stage,job,images) {
    const d=job.data;
    let path,body;
    if(stage==='preview') {
      path='image-to-image'; body={ai_model:'nano-banana',reference_image_urls:images,
        prompt:`Create a single full-body stylized 3D companion character reference on a plain background. ${d.inputType==='photo'?'Interpret the person as a friendly stylized 3D avatar, preserve recognizable hairstyle, colors and main facial features.':'Preserve the reference character identity, hairstyle, clothing and colors.'} ${d.style==='cute'?'Soft cute proportions.':'Clean anime-inspired proportions.'} Humanoid biped, exactly two arms and two legs, all hands and feet visible, neutral front-facing T-pose, arms separated from torso. No text, weapons, scene or extra characters. Clothing preferences: ${d.details || 'use the reference outfit, complete missing areas with simple casual clothes'}.`,aspect_ratio:'3:4'};
    } else if(stage==='model') {
      path='image-to-3d'; body={image_url:images[0],ai_model:'meshy-6',target_polycount:20000,topology:'triangle',should_remesh:true,should_texture:true,enable_pbr:false,pose_mode:'t-pose',hd_texture:false};
    } else if(stage==='rig') {
      path='rigging'; body={input_task_id:d.tasks.model.id,height_meters:1.6};
    } else {
      path='animations'; body={rig_task_id:d.tasks.rig.id,action_id:stage==='idle'?0:56};
    }
    const task=await this.request(path,body);
    if(typeof task.result!=='string'||task.result.length>200) throw new Error('invalid_provider_response');
    return {id:task.result,path};
  }
  async poll(task) { return this.request(`${task.path}/${encodeURIComponent(task.id)}`); }
}
