import test from 'node:test';
import assert from 'node:assert/strict';
import {historyRows} from '../../src/api/latencyHistory.ts';
import {computeLatencyStats,buildLatencyChart} from '../../src/utils/latency.ts';

test('frontend uses sample weighted totals, retains max and excludes pending from loss',()=>{
  const rows=historyRows({version:1,resolution_ms:300000,display_step_ms:300000,rows:[
    {source:'line',target:'a',bucket:1700000000000,samples:11,successes:9,failures:1,latency_sum:90,latency_max:20,first_ts:1700000000001,last_ts:1700000000100},
    {source:'line',target:'a',bucket:1700000300000,samples:1,successes:1,failures:0,latency_sum:100,latency_max:100,first_ts:1700000300001,last_ts:1700000300001},
  ]},'node','ping');
  const s=computeLatencyStats(rows,'ping')[0];
  assert.equal(s.avg,19);assert.equal(s.max,100);assert.equal(s.samples,12);assert.equal(s.pending,1);assert.equal(s.lossRate,100/11);assert.equal(s.jitter,null);
});
test('same named tasks with different destinations remain separate',()=>{
  const base={source:'line',bucket:1700000000000,samples:1,successes:1,failures:0,latency_sum:10,latency_max:10,first_ts:1700000000001,last_ts:1700000000001};
  const rows=historyRows({version:1,resolution_ms:300000,display_step_ms:300000,rows:[{...base,target:'a'},{...base,target:'b'}]},'node','ping');
  assert.equal(computeLatencyStats(rows,'ping').length,2);
});
test('explicit failed observations are not forward filled as successful latency',()=>{
  const row=(timestamp,success,value)=>({task_id:timestamp,uuid:'node',timestamp,success,cron_source:'line',task_event_result:{ping:value}});
  const chart=buildLatencyChart([row(1700000000000,true,10),row(1700000300000,false,null)],'ping');
  assert.equal(chart.data[1].line,null);
});
