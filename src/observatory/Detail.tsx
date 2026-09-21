import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ArrowUpRight,
  ArrowDownLeft,
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Node, LatencyType } from "../types";
import type { BackendPool } from "../api/pool";
import { useNodeLatency } from "../hooks/useNodeLatency";
import {
  buildLatencyChart,
  computeLatencyStats,
  formatLatencyTick,
} from "../utils/latency";
import {
  cpuLabel,
  deriveUsage,
  displayName,
  osLabel,
  virtLabel,
} from "../utils/derive";
import { bytes, money, pct, relativeAge, uptime } from "../utils/format";
import { AttentionBadges, Meter } from "./Nodes";
const windows = [
  { label: "1 小时", ms: 3600000, limit: 2000, refresh: 10000 },
  { label: "6 小时", ms: 21600000, limit: 6000, refresh: 30000 },
  { label: "24 小时", ms: 86400000, limit: 20000, refresh: 60000 },
  { label: "7 天", ms: 604800000, limit: 50000, refresh: 120000 },
  { label: "30 天", ms: 30 * 86400000, limit: 50000, refresh: 300000 },
  { label: "90 天", ms: 90 * 86400000, limit: 50000, refresh: 600000 },
  { label: "180 天", ms: 180 * 86400000, limit: 50000, refresh: 900000 },
  { label: "365 天", ms: 365 * 86400000, limit: 50000, refresh: 1800000 },
];
const palette = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];
export function Detail({
  node,
  pool,
  onClose,
}: {
  node: Node;
  pool: BackendPool | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    u = deriveUsage(node);
  const [metric, setMetric] = useState<"cpu" | "mem" | "disk">("cpu"),
    [windowIndex, setWindowIndex] = useState(0),
    [latencyType, setLatencyType] = useState<LatencyType>("ping");
  const [focusedSeries, setFocusedSeries] = useState<string | null>(null);
  useEffect(() => {
    setFocusedSeries(null);
  }, [node.uuid, node.source, latencyType]);
  const period = windows[windowIndex];
  const latency = useNodeLatency(
    pool,
    node.source,
    node.uuid,
    period.ms,
    period.limit,
    period.refresh,
  );
  const rows = latencyType === "ping" ? latency.pingData : latency.tcpData;
  const queryError = latency.errors[latencyType];
  const truncated = latency.truncated[latencyType];
  const recordDate = (timestamp: number) =>
    new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toLocaleString();
  const chart = useMemo(
    () => buildLatencyChart(rows, latencyType),
    [rows, latencyType],
  );
  const activeSeries = chart.series.some((s) => s.name === focusedSeries)
    ? focusedSeries
    : null;
  const stats = useMemo(
    () => computeLatencyStats(rows, latencyType),
    [rows, latencyType],
  );
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el?.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  const tooltip = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    color: "var(--text)",
    fontSize: 12,
  };
  return (
    <dialog
      ref={dialog}
      className="detail-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="node-detail-title"
    >
      <div className="detail-content">
        <header className="detail-header">
          <div>
            <span className="eyebrow">
              NODE TELEMETRY / {node.meta.region || "GLOBAL"}
            </span>
            <h2 id="node-detail-title">{displayName(node)}</h2>
            <span className={`status ${node.online ? "" : "offline"}`}>
              <i />
              {node.online ? "连接正常" : "节点离线"}{" "}
              <span className="subtle">· 最近上报 {relativeAge(u.ts)}</span>
            </span>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭节点详情"
          >
            <X size={20} />
          </button>
        </header>
        <AttentionBadges node={node} />
        <div className="detail-meters">
          <Meter label="CPU" value={u.cpu} detail={cpuLabel(node) || "—"} />
          <Meter
            label="内存"
            value={u.mem}
            detail={`${bytes(u.memUsed)} / ${bytes(u.memTotal)}`}
          />
          <Meter
            label="磁盘"
            value={u.disk}
            detail={`${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}`}
          />
        </div>
        <section className="detail-section">
          <div className="section-heading">
            <h3>资源趋势</h3>
            <div className="segmented">
              {(["cpu", "mem", "disk"] as const).map((m) => (
                <button
                  key={m}
                  className={metric === m ? "active" : ""}
                  onClick={() => setMetric(m)}
                >
                  {m === "cpu" ? "CPU" : m === "mem" ? "内存" : "磁盘"}
                </button>
              ))}
            </div>
          </div>
          <div className="detail-chart">
            {node.history.length < 2 ? (
              <div className="chart-wait">等待更多采样数据</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={node.history}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }
                    stroke="var(--muted)"
                    fontSize={12}
                    minTickGap={45}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    stroke="var(--muted)"
                    fontSize={12}
                    width={35}
                  />
                  <Tooltip
                    contentStyle={tooltip}
                    labelFormatter={(v) =>
                      new Date(Number(v)).toLocaleTimeString()
                    }
                    formatter={(v: number) => pct(v)}
                  />
                  <Line
                    type="monotone"
                    dataKey={metric}
                    stroke="var(--accent)"
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="subtle">仅展示本次打开页面后收集的最近 60 个采样点。</p>
        </section>
        <div className="detail-network">
          <div>
            <ArrowDownLeft size={18} />
            <span>
              当前入站
              <strong>
                {node.online ? bytes(u.netIn) : "—"}
                <small>/s</small>
              </strong>
            </span>
          </div>
          <div>
            <ArrowUpRight size={18} />
            <span>
              当前出站
              <strong>
                {node.online ? bytes(u.netOut) : "—"}
                <small>/s</small>
              </strong>
            </span>
          </div>
          <div>
            <span>
              累计接收<strong>{bytes(node.dynamic?.total_received)}</strong>
            </span>
          </div>
          <div>
            <span>
              累计发送<strong>{bytes(node.dynamic?.total_transmitted)}</strong>
            </span>
          </div>
        </div>
        <section className="detail-section">
          <div className="section-heading">
            <h3>连接延迟</h3>
            <div className="segmented">
              {(["ping", "tcp_ping"] as const).map((t) => (
                <button
                  key={t}
                  className={t === latencyType ? "active" : ""}
                  onClick={() => setLatencyType(t)}
                >
                  {t === "ping" ? "ICMP" : "TCP"}
                </button>
              ))}
            </div>
          </div>
          <div className="latency-toolbar">
            <div className="segmented" role="group" aria-label="延迟时间范围">
              {windows.map((w, i) => (
                <button
                  key={w.label}
                  aria-pressed={i === windowIndex}
                  className={i === windowIndex ? "active" : ""}
                  onClick={() => setWindowIndex(i)}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <span className="subtle">
              {latency.loading
                ? "正在查询…"
                : queryError
                  ? "查询失败"
                  : `${rows.length} 条记录`}
            </span>
          </div>
          {period.ms >= 30 * 86400000 && (
            <p className="subtle">
              历史范围取决于后端保留的记录，图表和统计仅使用本次返回的数据。
            </p>
          )}
          {truncated && !latency.loading && (
            <p className="danger-text" role="status">
              已达到 {period.limit.toLocaleString()}{" "}
              条查询上限，当前结果可能未覆盖整个时间范围。可缩短时间范围查看。
            </p>
          )}
          {rows.length > 0 && !latency.loading && (
            <p className="subtle">
              记录覆盖：{recordDate(rows[0].timestamp)} —{" "}
              {recordDate(rows[rows.length - 1].timestamp)}
            </p>
          )}
          {chart.series.length > 0 && (
            <div
              className="latency-legend"
              role="group"
              aria-label="延迟线路选择"
            >
              <button
                aria-pressed={!activeSeries}
                onClick={() => setFocusedSeries(null)}
              >
                全部线路
              </button>
              {chart.series.map((series, i) => (
                <button
                  key={series.name}
                  aria-pressed={activeSeries === series.name}
                  onClick={() =>
                    setFocusedSeries(
                      activeSeries === series.name ? null : series.name,
                    )
                  }
                >
                  <i style={{ background: palette[i % palette.length] }} />
                  {series.name}
                </button>
              ))}
              <span className="subtle">点击线路单独查看，再次点击恢复全部</span>
            </div>
          )}
          <div className="detail-chart">
            {!chart.data.length ? (
              <div className="chart-wait">
                {latency.loading
                  ? "正在读取延迟记录"
                  : queryError
                    ? "延迟记录查询失败"
                    : "此时间范围暂无延迟记录"}
                <span>
                  {queryError
                    ? "请稍后重试，或选择较短的时间范围"
                    : "需要后端配置 Ping / TCP Ping 定时任务并保留历史记录"}
                </span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.data}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    stroke="var(--muted)"
                    fontSize={12}
                    minTickGap={35}
                    tickCount={5}
                    tickFormatter={(v) =>
                      formatLatencyTick(
                        v,
                        rows[0].timestamp,
                        rows[rows.length - 1].timestamp,
                      )
                    }
                  />
                  <YAxis
                    stroke="var(--muted)"
                    fontSize={12}
                    width={45}
                    tickFormatter={(v) => `${v}ms`}
                  />
                  <Tooltip
                    contentStyle={tooltip}
                    labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                  />
                  {chart.series.map((s, i) => (
                    <Line
                      key={s.name}
                      dataKey={s.name}
                      stroke={palette[i % palette.length]}
                      hide={activeSeries !== null && s.name !== activeSeries}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          {stats.length > 0 && (
            <div className="latency-stats">
              {stats
                .filter((s) => !activeSeries || s.name === activeSeries)
                .map((s) => (
                  <div key={s.name}>
                    <strong>{s.name}</strong>
                    <span>均值 {s.avg?.toFixed(1) ?? "—"} ms</span>
                    <span>抖动 {s.jitter?.toFixed(1) ?? "—"} ms</span>
                    <span className={s.lossRate > 0 ? "danger-text" : ""}>
                      丢包 {s.lossRate.toFixed(1)}%
                    </span>
                  </div>
                ))}
            </div>
          )}
        </section>
        <section className="detail-section">
          <h3>系统档案</h3>
          <dl className="spec-grid">
            {[
              ["操作系统", osLabel(node)],
              ["处理器", cpuLabel(node)],
              [
                "架构",
                node.static.system?.arch || node.static.system?.cpu_arch,
              ],
              ["虚拟化", virtLabel(node)],
              ["运行时间", uptime(u.uptime)],
              [
                "负载 (1 / 5 / 15 分钟)",
                [
                  node.dynamic?.load_one,
                  node.dynamic?.load_five,
                  node.dynamic?.load_fifteen,
                ]
                  .map((v) => v?.toFixed(2) ?? "—")
                  .join(" / "),
              ],
              [
                "费用",
                money(
                  node.meta.price,
                  node.meta.priceUnit,
                  node.meta.priceCycle,
                ) || "未设置",
              ],
              ["到期时间", node.meta.expireTime || "未设置"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </dialog>
  );
}
