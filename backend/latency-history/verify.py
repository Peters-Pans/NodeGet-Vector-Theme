#!/usr/bin/env python3
"""Read-only production checks. Run on the NodeGet host after install."""
import json,time,urllib.request,urllib.error
from deploy import connect,call,verify

verify()
with connect() as c:
    raw=c.execute("SELECT lower(hex(uuid)) AS uuid FROM task WHERE cron_source LIKE 'ping-%' ORDER BY timestamp DESC LIMIT 1").fetchone()[0]
    token=json.loads(c.execute("SELECT env FROM js_worker WHERE name='base-worker'").fetchone()[0])['token']
uuid=f'{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}'
now=int(time.time()*1000)
url='http://127.0.0.1:2211/nodeget/worker-route/latency-history'
def query(days,kind,credential):
    body=json.dumps(dict(uuid=uuid,kind=kind,token=credential,**{'from':now-days*86400000,'to':now})).encode()
    request=urllib.request.Request(url,data=body,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)
try:
    query(7,'ping','invalid-history-test')
    raise RuntimeError('Invalid token unexpectedly accepted')
except urllib.error.HTTPError as e:
    assert e.code==400
    print('invalid_token_denied: true')
for days in (7,30,90,180,365):
    for kind in ('ping','tcp_ping'):
        result=query(days,kind,token)
        assert result['version']==1 and result['resolution_ms']==(3600000 if days>90 else 300000)
        print(json.dumps({'days':days,'kind':kind,'points':len(result['rows']),'samples':sum(r['samples'] for r in result['rows'])}))

# Compare one fully closed hour directly with the source records and persisted rollup.
with connect() as c:
    hour=c.execute(f"SELECT MAX(bucket) FROM theme_latency_rollup WHERE uuid=X'{raw}' AND resolution=3600000 AND kind='ping'").fetchone()[0]
    if hour is None:raise RuntimeError('No completed hourly rollup')
    rows=c.execute(f"""SELECT cron_source AS source,json_extract(task_event_type,'$.ping') AS target,COUNT(*) AS samples,
      SUM(CASE WHEN success=1 AND json_type(task_event_result,'$.ping') IN ('real','integer') AND json_extract(task_event_result,'$.ping')>=0 THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN success IS NULL THEN 0 WHEN success=1 AND json_type(task_event_result,'$.ping') IN ('real','integer') AND json_extract(task_event_result,'$.ping')>=0 THEN 0 ELSE 1 END) AS failures,
      SUM(CASE WHEN success=1 AND json_type(task_event_result,'$.ping') IN ('real','integer') AND json_extract(task_event_result,'$.ping')>=0 THEN json_extract(task_event_result,'$.ping') ELSE 0 END) AS latency_sum,
      MAX(CASE WHEN success=1 AND json_type(task_event_result,'$.ping') IN ('real','integer') AND json_extract(task_event_result,'$.ping')>=0 THEN json_extract(task_event_result,'$.ping') END) AS latency_max
      FROM task WHERE uuid=X'{raw}' AND timestamp>=? AND timestamp<? AND cron_source IS NOT NULL
      AND cron_source<>'' AND cron_source<>'未知' AND json_type(task_event_type,'$.ping')='text'
      GROUP BY cron_source,json_extract(task_event_type,'$.ping')""",(hour,hour+3600000)).fetchall()
    stored=c.execute(f"SELECT * FROM theme_latency_rollup WHERE uuid=X'{raw}' AND kind='ping' AND resolution=3600000 AND bucket=?",(hour,)).fetchall()
    expected={(r['source'],r['target']):dict(r) for r in rows}
    assert len(stored)==len(expected)
    for r in stored:
        other=expected[(r['source'],r['target'])]
        for key in ('samples','successes','failures','latency_sum','latency_max'):
            a,b=r[key],other[key]
            assert (a is None and b is None) or (a is not None and b is not None and abs(a-b)<1e-7),(key,'rollup differs')
    print(json.dumps({'raw_hour_matches_rollup':True,'series':len(stored)}))

# Exercise the same native inline-call handler used by cleanup, without running any deletion.
run=call('js-worker_run',dict(js_script_name='latency-history',run_type='inline_call',params=dict(action='can_clean',uuid=uuid,cutoff=now-7*86400000)))
for _ in range(30):
    with connect() as c: row=c.execute('SELECT finish_time,error_message,result FROM js_result WHERE id=?',(run['id'],)).fetchone()
    if row and row['finish_time'] is not None:
        assert not row['error_message'],'Guard runtime failed'
        value=json.loads(row['result'])
        assert value['ok'] is True and isinstance(value['cutoff'],(int,float))
        print('native_cleanup_guard_passed_without_deleting: true')
        break
    time.sleep(1)
else:raise RuntimeError('Guard verification timed out')
