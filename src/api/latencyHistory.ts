import type { TaskQueryResult } from '../types'

export interface HistoryResponse {
  version: 1
  resolution_ms: number
  display_step_ms: number
  rows: { source: string; target: string; bucket: number; samples: number; successes: number;
    failures: number; latency_sum: number; latency_max: number | null; first_ts: number; last_ts: number }[]
}

export function historyRows(result: HistoryResponse, uuid: string, kind: 'ping' | 'tcp_ping'): TaskQueryResult[] {
  if (result.version !== 1 || !Array.isArray(result.rows)) throw new Error('不支持的历史数据格式')
  const targets = new Map<string, Set<string>>()
  for (const r of result.rows) {
    if (!targets.has(r.source)) targets.set(r.source, new Set())
    targets.get(r.source)!.add(r.target)
  }
  return result.rows.map((r, i) => ({
    task_id: i, uuid, timestamp: Number(r.bucket), success: r.successes > 0,
    cron_source: targets.get(r.source)!.size > 1 ? `${r.source} · ${r.target}` : r.source,
    task_event_type: { [kind]: r.target },
    task_event_result: { [kind]: r.successes > 0 ? r.latency_sum / r.successes : null },
    aggregate: { samples: Number(r.samples), successes: Number(r.successes), failures: Number(r.failures),
      sum: Number(r.latency_sum), max: r.latency_max == null ? null : Number(r.latency_max),
      first: Number(r.first_ts), last: Number(r.last_ts), resolution: result.resolution_ms },
  })).sort((a,b)=>a.timestamp-b.timestamp)
}
