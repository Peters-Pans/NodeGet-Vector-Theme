// NodeGet 0.5.15 JS Worker. SQLite only; no external dependencies.
export const DAY = 86400000;
export const FIVE_MIN = 300000;
export const HOUR = 3600000;
const TABLE = 'theme_latency_rollup';
const STATE = 'theme_latency_archive';

function uuidHex(uuid) {
  if (typeof uuid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) throw new Error('Invalid node');
  return uuid.replaceAll('-', '').toLowerCase();
}
async function sql(env, statement, params = []) {
  const result = await execSql(env.token, statement, params);
  if (!result?.success || result.truncated) throw new Error('History database operation failed');
  return result.data;
}
export async function setup(env) {
  await sql(env, `CREATE TABLE IF NOT EXISTS ${TABLE} (
    uuid BLOB NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL,
    resolution INTEGER NOT NULL, bucket INTEGER NOT NULL,
    samples INTEGER NOT NULL, successes INTEGER NOT NULL, failures INTEGER NOT NULL,
    latency_sum REAL NOT NULL, latency_max REAL, first_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL,
    PRIMARY KEY(uuid,kind,resolution,bucket,source,target)) WITHOUT ROWID`);
  await sql(env, `CREATE TABLE IF NOT EXISTS ${STATE} (uuid BLOB PRIMARY KEY, through INTEGER NOT NULL) WITHOUT ROWID`);
}

// Replace complete source intervals, never add to old sums: retries are idempotent.
export async function archiveInterval(env, hex, start, end) {
  if (!/^[a-f0-9]{32}$/.test(hex)) throw new Error('Invalid node');
  for (const resolution of [FIVE_MIN, HOUR]) {
    // Hourly rows are only replaced with complete hours. A later run finishes the current hour.
    const finish = Math.floor(end / resolution) * resolution;
    const begin = Math.floor(start / resolution) * resolution;
    if (finish <= begin) continue;
    for (const kind of ['ping', 'tcp_ping']) {
      await sql(env, `INSERT INTO ${TABLE}
        (uuid,kind,source,target,resolution,bucket,samples,successes,failures,latency_sum,latency_max,first_ts,last_ts)
        SELECT uuid,$1,cron_source,json_extract(task_event_type,'$.${kind}'),$2,
          CAST(timestamp / $2 AS INTEGER)*$2,COUNT(*),SUM(valid),SUM(failed),
          SUM(CASE WHEN valid THEN latency ELSE 0 END),MAX(CASE WHEN valid THEN latency END),MIN(timestamp),MAX(timestamp)
        FROM (SELECT *,json_extract(task_event_result,'$.${kind}') AS latency,
          (success=1 AND json_type(task_event_result,'$.${kind}') IN ('real','integer') AND json_extract(task_event_result,'$.${kind}')>=0) IS TRUE AS valid,
          CASE WHEN success IS NULL THEN 0 WHEN success=1 AND json_type(task_event_result,'$.${kind}') IN ('real','integer') AND json_extract(task_event_result,'$.${kind}')>=0 THEN 0 ELSE 1 END AS failed
          FROM task WHERE uuid=X'${hex}' AND timestamp >= $3 AND timestamp < $4
          AND cron_source IS NOT NULL AND cron_source <> '' AND cron_source <> '未知'
          AND json_type(task_event_type,'$.${kind}')='text')
        GROUP BY uuid,cron_source,json_extract(task_event_type,'$.${kind}'),CAST(timestamp / $2 AS INTEGER)
        ON CONFLICT(uuid,kind,resolution,bucket,source,target) DO UPDATE SET
          samples=excluded.samples,successes=excluded.successes,failures=excluded.failures,
          latency_sum=excluded.latency_sum,latency_max=excluded.latency_max,first_ts=excluded.first_ts,last_ts=excluded.last_ts`,
        [kind, resolution, begin, finish]);
    }
  }
  // Only advance after BOTH resolutions have been persisted. Cleanup uses this watermark.
  const completeHour = Math.floor(end / HOUR) * HOUR;
  await sql(env, `INSERT INTO ${STATE}(uuid,through) VALUES(X'${hex}',$1)
    ON CONFLICT(uuid) DO UPDATE SET through=MAX(through,excluded.through)`, [completeHour]);
}

export async function archive(env, now = Date.now()) {
  await setup(env);
  const nodes = await sql(env, `SELECT lower(hex(t.uuid)) AS hex,MIN(t.timestamp) AS first_ts,MAX(t.timestamp) AS last_ts,a.through
    FROM task t LEFT JOIN ${STATE} a ON t.uuid=a.uuid GROUP BY t.uuid`);
  const end = Math.floor((now - 60000) / FIVE_MIN) * FIVE_MIN;
  const began = Date.now();
  let processed = 0;
  for (const node of nodes) {
    // Re-read the last two hours to include delayed task completions. Older backlog resumes from watermark.
    let from = Math.max(Math.floor(Number(node.first_ts) / HOUR) * HOUR, now - 365 * DAY,
      node.through == null ? 0 : Number(node.through) - 2 * HOUR);
    from = Math.floor(from / HOUR) * HOUR;
    while (from < end) {
      const until = from > Number(node.last_ts) ? end : Math.min(from + 6 * HOUR, end);
      await archiveInterval(env, node.hex, from, until);
      from = until;
      processed++;
      if (Date.now() - began > 20000) return { ok: true, catching_up: true, processed };
    }
  }
  await sql(env, `DELETE FROM ${TABLE} WHERE resolution=$1 AND bucket < $2`, [FIVE_MIN, Math.floor((now - 90 * DAY) / FIVE_MIN) * FIVE_MIN]);
  await sql(env, `DELETE FROM ${TABLE} WHERE resolution=$1 AND bucket < $2`, [HOUR, Math.floor((now - 365 * DAY) / HOUR) * HOUR]);
  return { ok: true, catching_up: false, processed };
}

export async function canClean(env, uuid, cutoff) {
  const hex = uuidHex(uuid);
  if (!Number.isFinite(cutoff) || cutoff > Date.now() - 7 * DAY + 60000) return { ok: false };
  // Delete whole hours only, so a later rollup never overwrites a bucket from a partially deleted source.
  let through = Math.floor(cutoff / HOUR) * HOUR;
  const rows = await sql(env, `SELECT through FROM ${STATE} WHERE uuid=X'${hex}'`);
  const remaining = await sql(env, `SELECT 1 AS present FROM task WHERE uuid=X'${hex}' AND timestamp <= $1
    AND (json_type(task_event_type,'$.ping')='text' OR json_type(task_event_type,'$.tcp_ping')='text') LIMIT 1`, [cutoff]);
  if (!remaining.length) return { ok: true, cutoff: through - 1 };
  if (!rows.length || Number(rows[0].through) < through) return { ok: false };
  // Final pass captures late completions immediately before deleting the source rows.
  const oldest = await sql(env, `SELECT MIN(timestamp) AS first_ts FROM task WHERE uuid=X'${hex}' AND timestamp < $1`, [through]);
  const first = oldest[0]?.first_ts;
  if (first != null) {
    let from = Math.max(Math.floor(Number(first)/HOUR)*HOUR, Math.floor((Date.now()-365*DAY)/HOUR)*HOUR);
    // Drain a large backlog incrementally rather than blocking cleanup forever after an outage.
    through = Math.min(through, from + 24*HOUR);
    while (from < through) {
      const end = Math.min(from+6*HOUR,through);
      await archiveInterval(env,hex,from,end);
      from=end;
    }
  }
  return { ok: true, cutoff: through - 1 };
}

export async function queryHistory(env, input, now = Date.now()) {
  const hex = uuidHex(input.uuid);
  const { kind, from, to, token } = input;
  if (!['ping','tcp_ping'].includes(kind) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to)
    || to <= from || to - from > 365 * DAY + 60000 || to > now + 60000 || from < now - 366 * DAY
    || typeof token !== 'string' || token.length > 8192) throw new Error('Invalid history request');
  // Authorize with precisely the existing node+protocol read permission; never expose SQL or grant new permissions.
  const auth = await nodeget('task_query', { token, task_data_query: { condition: [
    {uuid: input.uuid}, {type: kind}, {limit: 1}, {timestamp_from_to: [to, to]}
  ] }});
  if (auth.error || !Array.isArray(auth.result)) throw new Error('History access denied');
  const resolution = to - from > 90 * DAY ? HOUR : FIVE_MIN;
  const coverage = await sql(env, `SELECT MIN(bucket) AS first,MAX(bucket) AS last FROM ${TABLE}
    WHERE uuid=X'${hex}' AND kind=$1 AND resolution=$2 AND bucket >= $3 AND bucket+$2 <= $4`,
    [kind,resolution,Math.ceil(from/resolution)*resolution,to]);
  // A newly installed server may only have a day of data: do not compress that day into two yearly points.
  const span = coverage[0]?.first == null ? resolution : Number(coverage[0].last)-Number(coverage[0].first)+resolution;
  const step = Math.max(resolution, Math.ceil(span / (480 * resolution)) * resolution);
  // Whole buckets only: do not silently include samples before the requested start.
  const rows = await sql(env, `SELECT source,target,CAST(bucket / $1 AS INTEGER)*$1 AS bucket,
      SUM(samples) AS samples,SUM(successes) AS successes,SUM(failures) AS failures,
      SUM(latency_sum) AS latency_sum,MAX(latency_max) AS latency_max,MIN(first_ts) AS first_ts,MAX(last_ts) AS last_ts
    FROM ${TABLE} WHERE uuid=X'${hex}' AND kind=$2 AND resolution=$3 AND bucket >= $4 AND bucket+$3 <= $5
    GROUP BY source,target,CAST(bucket / $1 AS INTEGER) ORDER BY bucket,source,target LIMIT 10001`,
    [step,kind,resolution,Math.ceil(from/resolution)*resolution,to]);
  if (rows.length > 10000) throw new Error('Too many history series');
  return { version: 1, resolution_ms: resolution, display_step_ms: step, rows };
}

export default {
  async onCron(params, env) { return archive(env); },
  async onCall(params, env) { return archive(env); },
  async onInlineCall(params, env) {
    if (params?.action !== 'can_clean') throw new Error('Unknown history action');
    return canClean(env, params.uuid, params.cutoff);
  },
  async onRoute(request, env) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (request.method !== 'POST') return new Response('{"error":"POST required"}', {status: 405, headers});
    try {
      const body = await request.text();
      if (body.length > 12000) throw new Error('Request too large');
      return new Response(JSON.stringify(await queryHistory(env, JSON.parse(body))), {headers});
    } catch (_) {
      // Never return a runtime/RPC exception that might contain credentials or SQL.
      return new Response('{"error":"History unavailable or access denied"}', {status: 400, headers});
    }
  }
};
