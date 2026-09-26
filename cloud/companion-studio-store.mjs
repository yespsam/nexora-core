import { randomUUID } from 'node:crypto';
import { DeviceCloudError, requiredUuid } from './device-cloud-validation.mjs';

export class CompanionStudioStore {
  constructor(pool) { this.pool = pool; }
  async transaction(ownerId, operation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.owner_id', $1, true)", [requiredUuid(ownerId, 'owner')]);
      const result = await operation(client);
      await client.query('COMMIT'); return result;
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  async create(auth, idempotencyKey, data, limits = {}) {
    return this.transaction(auth.ownerId, async (client) => {
      // One global lock makes both owner and site daily budget checks atomic.
      await client.query("SELECT pg_advisory_xact_lock(260926001)");
      const existing = await client.query('SELECT * FROM nexora_cloud.companion_studio_jobs WHERE owner_id=$1 AND idempotency_key=$2', [auth.ownerId, requiredUuid(idempotencyKey, 'request id')]);
      if (existing.rowCount) return {job: existing.rows[0], created: false};
      const counts = await client.query('SELECT * FROM nexora_cloud.studio_daily_usage($1)', [auth.ownerId]);
      if (Number(counts.rows[0].own) >= (limits.owner || 2) || Number(counts.rows[0].total) >= (limits.site || 20))
        throw new DeviceCloudError('今天的角色生成额度已用完，请明天再试。', 429, 'quota_exceeded');
      const id = randomUUID();
      const result = await client.query(`INSERT INTO nexora_cloud.companion_studio_jobs
        (id,owner_id,agent_id,idempotency_key,data,state) VALUES($1,$2,$3,$4,$5,'uploading') RETURNING *`,
      [id, auth.ownerId, auth.agentId, idempotencyKey, data]);
      return {job: result.rows[0], created: true};
    });
  }
  async list(ownerId) { return this.transaction(ownerId, async c => (await c.query('SELECT * FROM nexora_cloud.companion_studio_jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30', [ownerId])).rows); }
  async get(ownerId, id) {
    return this.transaction(ownerId, async c => {
      const result = await c.query('SELECT * FROM nexora_cloud.companion_studio_jobs WHERE owner_id=$1 AND id=$2', [ownerId, requiredUuid(id, 'job')]);
      if (!result.rowCount) throw new DeviceCloudError('找不到这个角色。', 404, 'not_found');
      return result.rows[0];
    });
  }
  async transition(ownerId, id, from, to, data) {
    return this.transaction(ownerId, async c => {
      const r = await c.query(`UPDATE nexora_cloud.companion_studio_jobs SET state=$4, data=COALESCE($5::jsonb,data),
        error_code=NULL, progress=0, lease_until=NULL, next_run_at=now(),updated_at=now()
        WHERE owner_id=$1 AND id=$2 AND state=ANY($3) RETURNING *`, [ownerId,id,from,to,data ? JSON.stringify(data) : null]);
      if (!r.rowCount) throw new DeviceCloudError('角色状态已变化，请刷新后重试。',409,'state_conflict');
      return r.rows[0];
    });
  }
  async profile(ownerId) {
    return this.transaction(ownerId, async c => (await c.query('SELECT * FROM nexora_cloud.companion_studio_profiles WHERE owner_id=$1',[ownerId])).rows[0] || {profile:{},active_job_id:null});
  }
  async saveProfile(ownerId, profile) {
    return this.transaction(ownerId, async c => (await c.query(`INSERT INTO nexora_cloud.companion_studio_profiles(owner_id,profile)
      VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET profile=$2,updated_at=now() RETURNING *`,[ownerId,profile])).rows[0]);
  }
  async activate(ownerId, id) {
    return this.transaction(ownerId, async c => {
      let initialProfile = {};
      if (id) {
        const job = await c.query("SELECT id,data FROM nexora_cloud.companion_studio_jobs WHERE owner_id=$1 AND id=$2 AND state='ready' FOR UPDATE",[ownerId,requiredUuid(id,'job')]);
        if(!job.rowCount) throw new DeviceCloudError('角色尚未就绪。',409,'not_ready');
        initialProfile = {name:job.rows[0].data.name,voice:'cute',memories:[]};
      }
      return (await c.query(`INSERT INTO nexora_cloud.companion_studio_profiles(owner_id,active_job_id,profile) VALUES($1,$2,$3)
        ON CONFLICT(owner_id) DO UPDATE SET active_job_id=$2,updated_at=now(),
        profile=CASE WHEN companion_studio_profiles.profile->>'name' IS NULL THEN companion_studio_profiles.profile || $3::jsonb ELSE companion_studio_profiles.profile END
        RETURNING *`,[ownerId,id || null,initialProfile])).rows[0];
    });
  }
  async claim(target = {}) {
    const result = await this.pool.query(`WITH candidate AS (
      SELECT id FROM nexora_cloud.companion_studio_jobs
      WHERE (state LIKE 'queued_%' OR state LIKE 'poll_%' OR state LIKE 'submitting_%')
      AND ($1::uuid IS NULL OR (id=$1 AND owner_id=$2))
      AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now())
      ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE nexora_cloud.companion_studio_jobs j SET lease_until=now()+interval '3 minutes'
      FROM candidate WHERE j.id=candidate.id RETURNING j.*`, [target.id || null, target.ownerId || null]);
    return result.rows[0];
  }
  async updateWorker(job, state, data, progress=0, errorCode=null, hold=false) {
    const result = await this.pool.query(`UPDATE nexora_cloud.companion_studio_jobs SET state=$3,data=$4,progress=$5,
      error_code=$6,lease_until=CASE WHEN $7 THEN lease_until ELSE NULL END,
      next_run_at=now()+interval '15 seconds',updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *`,
      [job.id,job.owner_id,state,data,progress,errorCode,hold]);
    return result.rows[0];
  }
}
