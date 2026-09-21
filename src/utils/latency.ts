import type { LatencyType, TaskQueryResult } from '../types'

// 暗哑大地色调色板：与暖调主题同族，又能区分多条延迟线（按来源名哈希取色）
const COLORS = [
  '#bd6338', // 陶土
  '#5f7a3f', // 苔绿
  '#bd8a2b', // 芥黄
  '#a2382a', // 砖红
  '#4f7a72', // 灰青
  '#6b7a99', // 墨蓝
  '#94566b', // 灰梅
  '#7d6a4a', // 陶褐
]

export function latencyColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function pickValue(row: TaskQueryResult, type: LatencyType): number | null {
  const v = row.task_event_result?.[type]
  return row.success && typeof v === 'number' ? v : null
}

function seriesNames(rows: TaskQueryResult[]) {
  const set = new Set<string>()
  for (const r of rows) set.add(r.cron_source || '未知')
  return [...set].sort((a, b) => a.localeCompare(b))
}

export interface ChartPoint {
  t: number
  [series: string]: number | null
}

export interface ChartSeries {
  name: string
  color: string
}

function forwardFill(data: ChartPoint[], names: string[]) {
  const last: Record<string, number | null> = {}
  for (const n of names) last[n] = null
  for (const pt of data) {
    for (const n of names) {
      const v = pt[n]
      if (!(n in pt)) pt[n] = last[n]
      else last[n] = v
    }
  }
}

// 长时间窗口可返回上万点，超过 maxPoints 就按时间等分桶、每桶取各序列最大值——
// 保留延迟尖峰（比均值更能暴露问题），同时把渲染点数压到 Recharts 能流畅画的量级。
function downsample(data: ChartPoint[], names: string[], maxPoints: number): ChartPoint[] {
  if (data.length <= maxPoints) return data
  const bucket = data.length / maxPoints
  const out: ChartPoint[] = []
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucket)
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket))
    const slice = data.slice(start, end)
    if (!slice.length) continue
    const pt: ChartPoint = { t: slice[slice.length - 1].t }
    for (const n of names) {
      let max: number | null = null
      for (const s of slice) {
        const v = s[n]
        if (typeof v === 'number' && (max === null || v > max)) max = v
      }
      pt[n] = max
    }
    out.push(pt)
  }
  return out
}

export function buildLatencyChart(
  rows: TaskQueryResult[],
  type: LatencyType,
  maxPoints = 500,
) {
  const names = seriesNames(rows)
  const series: ChartSeries[] = names.map(name => ({ name, color: latencyColor(name) }))
  const byTs = new Map<number, ChartPoint>()

  for (const r of rows) {
    const t = normalizeTs(r.timestamp)
    let pt = byTs.get(t)
    if (!pt) {
      pt = { t }
      byTs.set(t, pt)
    }
    pt[r.cron_source || '未知'] = pickValue(r, type)
  }

  const data = [...byTs.values()].sort((a, b) => a.t - b.t)
  forwardFill(data, names)
  return { data: downsample(data, names, maxPoints), series }
}

export interface LatencyStats {
  name: string
  color: string
  avg: number | null
  jitter: number | null
  lossRate: number
  max?: number | null
  samples?: number
  pending?: number
}

export function computeLatencyStats(rows: TaskQueryResult[], type: LatencyType): LatencyStats[] {
  const stats = seriesNames(rows).map<LatencyStats>(name => {
    const list = rows.filter(r => (r.cron_source || '未知') === name)
    if (list.some(r => r.aggregate)) {
      let samples=0, successes=0, failures=0, sum=0, max: number | null=null;
      for (const {aggregate:a} of list) {
        if (!a) continue;
        samples+=a.samples; successes+=a.successes; failures+=a.failures; sum+=a.sum;
        if (a.max != null) max=max == null ? a.max : Math.max(max,a.max);
      }
      return { name, color:latencyColor(name), avg:successes ? sum/successes : null, jitter:null,
        lossRate:successes+failures ? failures/(successes+failures)*100 : 0,
        max,samples,pending:samples-successes-failures };
    }
    const vals: number[] = []
    for (const r of list) {
      const v = pickValue(r, type)
      if (v != null) vals.push(v)
    }

    const color = latencyColor(name)
    const lossRate = list.length ? ((list.length - vals.length) / list.length) * 100 : 0
    if (!vals.length) return { name, color, avg: null, jitter: null, lossRate }

    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    const jitter =
      vals.length >= 2
        ? vals.slice(1).reduce((s, v, i) => s + Math.abs(v - vals[i]), 0) / (vals.length - 1)
        : null

    return { name, color, avg, jitter, lossRate }
  })

  return stats.sort((a, b) => {
    const av = a.avg ?? Infinity
    const bv = b.avg ?? Infinity
    if (av !== bv) return av - bv
    const aj = a.jitter ?? Infinity
    const bj = b.jitter ?? Infinity
    if (aj !== bj) return aj - bj
    return a.lossRate - b.lossRate
  })
}

// 根据实际数据覆盖范围选择刻度，避免长查询只返回一天时重复显示同一日期。
export function formatLatencyTick(timestamp: number, first: number, last: number) {
  const date = new Date(normalizeTs(timestamp));
  const start = new Date(normalizeTs(first));
  const end = new Date(normalizeTs(last));
  const span = end.getTime() - start.getTime();
  const crossesYear = start.getFullYear() !== end.getFullYear();
  if (span <= 2 * 86400000) {
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (start.toDateString() === end.toDateString()) return time;
    return `${date.toLocaleDateString([], { month: '2-digit', day: '2-digit', ...(crossesYear ? { year: '2-digit' as const } : {}) })} ${time}`;
  }
  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit', ...(crossesYear || span >= 180 * 86400000 ? { year: '2-digit' as const } : {}) });
}
