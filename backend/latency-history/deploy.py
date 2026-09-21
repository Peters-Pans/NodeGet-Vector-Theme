#!/usr/bin/env python3
"""Run as root on the existing NodeGet SQLite host. Never exports credentials.
Usage: deploy.py prepare|install|verify|rollback --backup /protected/backup.sqlite --worker worker.mjs
"""
import argparse, base64, json, os, re, sqlite3, time, urllib.request
from pathlib import Path

DB = '/var/lib/nodeget/nodeget.db'
RPC = 'http://127.0.0.1:2211/nodeget/rpc'
NAME = 'latency-history'

def connect(path=DB):
    c = sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True, timeout=5)
    c.execute('PRAGMA query_only=ON')
    c.row_factory = sqlite3.Row
    return c

def call(method, params):
    # Reuse the server's existing internal credential only on its loopback interface.
    with connect() as c:
        token = json.loads(c.execute("SELECT env FROM js_worker WHERE name='base-worker'").fetchone()[0])['token']
    body = json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':dict(params, token=token)}).encode()
    request = urllib.request.Request(RPC, data=body, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
    if 'error' in result:
        # Intentionally omit arbitrary server error strings and request payloads.
        raise RuntimeError('RPC failed: ' + method + ' code=' + str(result['error'].get('code')))
    return result.get('result')

def worker_params(row, script=None, env=None):
    return dict(name=row['name'], description=row['description'], route_name=row['route_name'],
        runtime_clean_time=row['runtime_clean_time'], max_run_time=row['max_run_time'],
        max_stack_size=row['max_stack_size'], max_heap_size=row['max_heap_size'],
        js_script_base64=base64.b64encode((script if script is not None else row['js_script']).encode()).decode(),
        env=env if env is not None else json.loads(row['env'] or '{}'))

def patch_cleanup(script):
    selection = r'dbLimits\.filter\(\(v\) => v\.key === key\)\.sort\(\(b, a\) => a\.key\.length - b\.key\.length\)\[0\]'
    script, count = re.subn(selection, '(dbLimits.find((v) => v.namespace === agentUUID && v.key === key) ?? dbLimits.find((v) => v.namespace === "global" && v.key === key))', script)
    if count != 1: raise RuntimeError('Unexpected cleanup source; stop before changing it')
    marker = 'const result = await nodeget(action, params);'
    if script.count(marker) != 1: raise RuntimeError('Unexpected cleanup call; stop before changing it')
    guard = '''if (action === "task_delete") {
          const archived = await inlineCall("latency-history", {action:"can_clean",uuid:agentUUID,cutoff:params.conditions[1].timestamp_to}, 120);
          if (!archived || archived.ok !== true || !Number.isFinite(archived.cutoff)) throw new Error("Latency archive is not ready; raw records retained");
          params.conditions[1].timestamp_to = archived.cutoff;
        }
        '''
    return script.replace(marker, guard + marker)

def prepare(backup):
    if backup.exists(): raise RuntimeError('Backup already exists; choose a new path')
    backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(backup.parent,0o700)
    os.umask(0o077)
    with connect() as source, sqlite3.connect(backup) as dest:
        # Pin a WAL snapshot: frequent monitoring writes must not restart the backup repeatedly.
        source.execute('BEGIN')
        source.execute('SELECT count(*) FROM sqlite_master').fetchone()
        source.backup(dest, pages=1024, sleep=0.05)
        source.rollback()
    os.chmod(backup,0o600)
    print('Snapshot copy complete; verifying affected tables',flush=True)
    check_backup(backup)

def check_backup(backup):
    with connect(backup) as c:
        # The rollback touches these configuration tables; verify Task as the archival source too.
        # Avoid a full scan of unrelated high-volume monitoring tables on a 1 GiB host.
        for table in ('kv','js_worker','crontab','task'):
            if c.execute('PRAGMA quick_check('+table+')').fetchone()[0] != 'ok': raise RuntimeError('Backup verification failed')
        row=c.execute("SELECT * FROM js_worker WHERE name='server-task-worker'").fetchone()
        patch_cleanup(row['js_script'])
    marker=backup.with_suffix('.verified.json')
    marker.write_text(json.dumps({'bytes':backup.stat().st_size,'tables':['kv','js_worker','crontab','task']}))
    os.chmod(marker,0o600)
    print(json.dumps({'backup_verified': True, 'bytes': backup.stat().st_size}))

def install(backup, worker):
    marker=backup.with_suffix('.verified.json')
    if not backup.exists() or not marker.exists() or json.loads(marker.read_text())['bytes']!=backup.stat().st_size:
        raise RuntimeError('Verified backup required')
    with connect(backup) as c:
        cleanup=c.execute("SELECT * FROM js_worker WHERE name='server-task-worker'").fetchone()
    script=patch_cleanup(cleanup['js_script'])
    with connect() as c:
        base=json.loads(c.execute("SELECT env FROM js_worker WHERE name='base-worker'").fetchone()[0])
        existing=c.execute('SELECT js_script FROM js_worker WHERE name=?',(NAME,)).fetchone()
        if existing and 'theme_latency_rollup' not in existing[0]: raise RuntimeError('Worker name already used by another extension')
    params=dict(name=NAME,description='延迟历史汇总：原始 7 天、5 分钟 90 天、小时 365 天',
        js_script_base64=base64.b64encode(worker.read_bytes()).decode(),
        env={'token':base['token']},route_name='latency-history',runtime_clean_time=60000,
        max_run_time=120000,max_heap_size=33554432,max_stack_size=1048576)
    call('js-worker_update' if existing else 'js-worker_create',params)
    result=call('js-worker_run',dict(js_script_name=NAME,run_type='cron',params={}))
    print(json.dumps({'archive_run_id':result['id']}),flush=True)
    # Read only the safe status fields; the result may contain runtime-specific output.
    for _ in range(120):
        with connect() as c:
            row=c.execute('SELECT finish_time,error_message FROM js_result WHERE id=?',(result['id'],)).fetchone()
            tables=c.execute("SELECT count(*) FROM sqlite_master WHERE name IN ('theme_latency_rollup','theme_latency_archive')").fetchone()[0]
        if row and row['finish_time'] is not None:
            if row['error_message'] or tables!=2: raise RuntimeError('Initial archive failed; existing retention unchanged')
            break
        time.sleep(1)
    else: raise RuntimeError('Initial archive not finished; existing retention unchanged')
    # Guard first, then extend retention. Failure at any point retains more raw data, not less.
    clean_env=json.loads(cleanup['env'] or '{}')
    clean_env['disable_auto_update']='true'
    call('js-worker_update',worker_params(cleanup,script,clean_env))
    with connect() as c:
        namespaces=[r[0] for r in c.execute("SELECT namespace FROM kv WHERE key='database_limit_task'")]
    for namespace in namespaces:
        call('kv_set_value',dict(namespace=namespace,key='database_limit_task',value=7*86400000))
    with connect() as c:
        exists=c.execute('SELECT 1 FROM crontab WHERE name=?',('latency-history-archive',)).fetchone()
    if not exists:
        call('crontab_create',dict(name='latency-history-archive',cron_expression='10 */5 * * * *',
            cron_type={'server':{'js_worker':[NAME,{}]}}))
    verify()

def verify():
    with connect() as c:
        retention=[json.loads(r[0]) for r in c.execute("SELECT value FROM kv WHERE key='database_limit_task'")]
        rows=c.execute('SELECT resolution,count(*) AS buckets,sum(samples) AS samples FROM theme_latency_rollup GROUP BY resolution').fetchall()
        guard=c.execute("SELECT js_script,env FROM js_worker WHERE name='server-task-worker'").fetchone()
        cron=c.execute("SELECT enable,cron_expression FROM crontab WHERE name='latency-history-archive'").fetchone()
    print(json.dumps({'retention_entries':len(retention),'all_raw_seven_days':all(v==7*86400000 for v in retention),
        'rollups':[dict(r) for r in rows],'cleanup_guard':'Latency archive is not ready' in guard[0],
        'cleanup_patch_protected':json.loads(guard[1]).get('disable_auto_update')=='true',
        'cron':dict(cron) if cron else None}))

def rollback(backup):
    # Restore settings/worker through RPC to invalidate caches; never overwrite the live database.
    with connect(backup) as c:
        cleanup=c.execute("SELECT * FROM js_worker WHERE name='server-task-worker'").fetchone()
        limits=c.execute("SELECT namespace,value FROM kv WHERE key='database_limit_task'").fetchall()
    # Restore original retention only when the operator explicitly chooses this rollback.
    for namespace,value in limits:
        call('kv_set_value',dict(namespace=namespace,key='database_limit_task',value=json.loads(value)))
    call('js-worker_update',worker_params(cleanup))
    print('Original retention and cleanup restored; archive tables/worker kept for data preservation.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','check-backup','install','verify','rollback'])
    p.add_argument('--backup',type=Path,required=True);p.add_argument('--worker',type=Path,default=Path(__file__).with_name('worker.mjs'))
    a=p.parse_args()
    try:
        if a.action=='prepare':prepare(a.backup)
        elif a.action=='check-backup':check_backup(a.backup)
        elif a.action=='install':install(a.backup,a.worker)
        elif a.action=='rollback':rollback(a.backup)
        else:verify()
    except Exception as e:
        # Never print payload-bearing HTTP responses or credentials in tracebacks.
        print('Deployment stopped:',type(e).__name__,str(e) if isinstance(e,RuntimeError) else 'Inspect safe server status fields')
        raise SystemExit(1)
