import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, {setup, archive, archiveInterval, canClean, queryHistory, DAY, HOUR, FIVE_MIN} from './worker.mjs';

const uuid='12345678-1234-1234-1234-123456789abc', hex=uuid.replaceAll('-','');
const now=Math.floor(Date.now()/HOUR)*HOUR, start=now-2*DAY;
const env={token:'test-internal'};
function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE task (id INTEGER PRIMARY KEY, uuid BLOB, cron_source TEXT, timestamp INTEGER, success INTEGER, task_event_type TEXT, task_event_result TEXT)`);
  globalThis.execSql=async (_,query,params=[])=>{
    const s=db.prepare(query);
    const values=Object.fromEntries(params.map((v,i)=>['$'+(i+1),v]));
    const data=s.all(values);
    return {success:true,data,truncated:false};
  };
  globalThis.nodeget=async ()=>({result:[]});
  const add=(offset,value,success=1,target='a',source='line',kind='ping')=> db.prepare(`INSERT INTO task(uuid,cron_source,timestamp,success,task_event_type,task_event_result) VALUES(X'${hex}',?,?,?,?,?)`).run(source,start+offset,success,JSON.stringify({[kind]:target}),value===null?null:JSON.stringify({[kind]:value}));
  return {db,add};
}
test('archive is idempotent, weighted, preserves peaks/failures/pending and separates targets/protocols', async()=>{
  const {db,add}=fixture();
  add(1000,10);add(2000,30);add(3000,null,0);add(4000,null,null);
  add(FIVE_MIN+1000,100);add(1000,999,1,'b');add(1000,45,1,'a','line','tcp_ping');
  await setup(env);await archiveInterval(env,hex,start,start+HOUR);await archiveInterval(env,hex,start,start+HOUR);
  const rows=db.prepare("SELECT * FROM theme_latency_rollup WHERE resolution=? AND kind='ping' AND target='a'").all(HOUR);
  assert.equal(rows.length,1);assert.equal(rows[0].samples,5);assert.equal(rows[0].successes,3);assert.equal(rows[0].failures,1);assert.equal(rows[0].latency_sum,140);assert.equal(rows[0].latency_max,100);
  const q=await queryHistory(env,{uuid,kind:'ping',from:start,to:now,token:'reader'},now);
  assert.equal(new Set(q.rows.map(r=>r.target)).size,2);
  assert.equal(q.rows.filter(r=>r.target==='a').reduce((n,r)=>n+r.samples,0),5);
  db.close();
});
test('all failed or pending samples retain gaps, invalid results do not become zero latency',async()=>{
  const {db,add}=fixture();add(1,null,0);add(2,null,null);add(3,'bad',1);add(4,-1,1);
  await setup(env);await archiveInterval(env,hex,start,start+HOUR);
  const r=db.prepare('SELECT * FROM theme_latency_rollup WHERE resolution=?').get(HOUR);
  assert.equal(r.successes,0);assert.equal(r.failures,3);assert.equal(r.samples,4);assert.equal(r.latency_max,null);assert.equal(r.latency_sum,0);
  db.close();
});
test('incomplete hourly bucket is not published; retry absorbs late completion',async()=>{
  const {db,add}=fixture();add(1,null,null);
  await setup(env);await archiveInterval(env,hex,start,start+FIVE_MIN);
  assert.equal(db.prepare('SELECT count(*) n FROM theme_latency_rollup WHERE resolution=?').get(HOUR).n,0);
  db.exec(`UPDATE task SET success=1,task_event_result='{"ping":12}'`);
  await archiveInterval(env,hex,start,start+HOUR);
  assert.equal(db.prepare('SELECT successes FROM theme_latency_rollup WHERE resolution=?').get(FIVE_MIN).successes,1);
  db.close();
});
test('archive failure cannot advance cleanup watermark',async()=>{
  const {db,add}=fixture();add(1,10);await setup(env);
  const exec=globalThis.execSql;
  globalThis.execSql=async(t,q,p)=>{if(q.startsWith('INSERT INTO theme_latency_rollup')&&p[1]===HOUR)throw Error('disk full');return exec(t,q,p);};
  await assert.rejects(()=>archiveInterval(env,hex,start,start+HOUR));
  assert.equal(db.prepare('SELECT count(*) n FROM theme_latency_archive').get().n,0);
  globalThis.execSql=exec;
  const old=Date.now;Date.now=()=>start+10*DAY;
  try{assert.equal((await canClean(env,uuid,start+HOUR)).ok,false);}finally{Date.now=old;}
  db.close();
});
test('authorization and bounds are enforced before history data is returned',async()=>{
  const {db}=fixture();await setup(env);
  let condition;
  globalThis.nodeget=async(method,p)=>{condition=p.task_data_query.condition;return {error:{message:'denied'}};};
  await assert.rejects(()=>queryHistory(env,{uuid,kind:'ping',from:start,to:now,token:'reader'},now),/denied/);
  assert.deepEqual(condition.slice(0,2),[{uuid},{type:'ping'}]);
  await assert.rejects(()=>queryHistory(env,{uuid:"x' OR 1=1",kind:'ping',from:start,to:now,token:'reader'},now));
  await assert.rejects(()=>queryHistory(env,{uuid,kind:'ping',from:now-400*DAY,to:now,token:'reader'},now));
  const response=await worker.onRoute(new Request('https://example.test',{method:'POST',body:JSON.stringify({uuid,kind:'ping',from:start,to:now,token:'reader'})}),env);
  assert.equal(response.status,400);assert.ok(!(await response.text()).includes('reader'));
  db.close();
});
test('90/365 day retention keeps hourly history after 5 minute expiry',async()=>{
  const {db}=fixture();await setup(env);
  for(const [res,days] of [[FIVE_MIN,91],[FIVE_MIN,89],[HOUR,91],[HOUR,366]]){
    db.prepare(`INSERT INTO theme_latency_rollup VALUES(X'${hex}','ping','line','a',?,?,1,1,0,10,10,?,?)`).run(res,now-days*DAY,now-days*DAY,now-days*DAY);
  }
  await archive(env,now);
  assert.equal(db.prepare('SELECT count(*) n FROM theme_latency_rollup WHERE resolution=?').get(FIVE_MIN).n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM theme_latency_rollup WHERE resolution=?').get(HOUR).n,1);
  const q=await queryHistory(env,{uuid,kind:'ping',from:now-365*DAY,to:now,token:'reader'},now);
  assert.equal(q.resolution_ms,HOUR);assert.equal(q.rows.length,1);
  assert.equal(q.display_step_ms,HOUR);
  db.close();
});
test('cleanup finalizes late results and aligns deletion before a complete hour',async()=>{
  const {db,add}=fixture();add(1,null,null);add(HOUR+1,40);
  await setup(env);await archiveInterval(env,hex,start,start+2*HOUR);
  db.exec(`UPDATE task SET success=1,task_event_result='{"ping":25}' WHERE timestamp=${start+1}`);
  const old=Date.now;Date.now=()=>start+8*DAY;
  let result;
  try{result=await canClean(env,uuid,start+HOUR+12345);}finally{Date.now=old;}
  assert.equal(result.ok,true);assert.equal(result.cutoff,start+HOUR-1);
  db.prepare('DELETE FROM task WHERE timestamp<=?').run(result.cutoff);
  await archiveInterval(env,hex,start+HOUR,start+2*HOUR);
  const original=db.prepare('SELECT * FROM theme_latency_rollup WHERE resolution=? AND bucket=?').get(HOUR,start);
  assert.equal(original.successes,1);assert.equal(original.latency_sum,25);
  assert.equal(db.prepare('SELECT count(*) n FROM task').get().n,1);
  db.close();
});
test('a large archived backlog drains in bounded batches after recovery',async()=>{
  const {db,add}=fixture();add(1,10);add(2*DAY,20);
  await setup(env);await archiveInterval(env,hex,start,start+4*DAY);
  const old=Date.now;Date.now=()=>start+10*DAY;
  try {
    const result=await canClean(env,uuid,start+3*DAY);
    assert.equal(result.ok,true);assert.equal(result.cutoff,start+DAY-1);
  } finally {Date.now=old;}
  db.close();
});
