import { useEffect, useId, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Node } from "../types";
import { bytes } from "../utils/format";
import { displayName } from "../utils/derive";
export function Traffic({ nodes }: { nodes: Node[] }) {
  const [samples, setSamples] = useState<
    { t: number; incoming: number; outgoing: number }[]
  >([]);
  const id = useId().replace(/:/g, "");
  const fingerprint = nodes
    .map((n) => `${n.uuid}:${n.dynamic?.timestamp}:${n.online}`)
    .join("|");
  useEffect(() => {
    if (!nodes.some((n) => n.online && n.dynamic)) return;
    const t = Math.max(
      ...nodes.filter((n) => n.online).map((n) => n.dynamic?.timestamp ?? 0),
    );
    const sample = {
      t,
      incoming: nodes.reduce(
        (s, n) => s + (n.online ? (n.dynamic?.receive_speed ?? 0) : 0),
        0,
      ),
      outgoing: nodes.reduce(
        (s, n) => s + (n.online ? (n.dynamic?.transmit_speed ?? 0) : 0),
        0,
      ),
    };
    setSamples((prev) =>
      prev.at(-1)?.t === t ? prev : [...prev, sample].slice(-60),
    );
  }, [fingerprint]);
  return (
    <div
      className="traffic-chart"
      role="img"
      aria-label="本次会话实时入站和出站带宽曲线"
    >
      {samples.length < 2 ? (
        <div className="chart-wait">
          正在采集实时曲线<span>连接后每 2 秒更新</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={samples}
            margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--accent)"
                  stopOpacity={0.24}
                />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--line)"
              strokeDasharray="2 5"
            />
            <XAxis dataKey="t" hide />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                color: "var(--text)",
                fontSize: 12,
              }}
              labelFormatter={(v) => new Date(Number(v)).toLocaleTimeString()}
              formatter={(v: number, name: string) => [
                `${bytes(v)}/s`,
                name === "incoming" ? "入站" : "出站",
              ]}
            />
            <Area
              type="monotone"
              dataKey="incoming"
              stroke="var(--accent)"
              fill={`url(#${id})`}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="outgoing"
              stroke="var(--secondary)"
              fill="transparent"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
export function Spark({ values }: { values: (number | null)[] }) {
  const points = values
    .map((v, i) =>
      v == null
        ? null
        : `${(i / Math.max(values.length - 1, 1)) * 120},${28 - (Math.min(100, Math.max(0, v)) / 100) * 24}`,
    )
    .filter(Boolean);
  return (
    <svg
      className="spark"
      viewBox="0 0 120 32"
      aria-label="CPU 最近采样趋势"
      role="img"
    >
      <path d="M0 29H120" stroke="var(--line)" />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export function World({
  nodes,
  onSelect,
}: {
  nodes: Node[];
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    chart = useRef<import("echarts").ECharts | null>(null);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    let resize: ResizeObserver | undefined;
    Promise.all([
      import("echarts"),
      fetch(`${import.meta.env.BASE_URL}world.geo.json`, {
        signal: controller.signal,
      }).then((r) => {
        if (!r.ok) throw new Error("地图资源未能加载");
        return r.json();
      }),
    ])
      .then(([ec, geo]) => {
        if (stopped || !ref.current) return;
        ec.registerMap("observatory", geo);
        chart.current = ec.init(ref.current);
        chart.current.setOption({
          backgroundColor: "transparent",
          geo: {
            map: "observatory",
            roam: true,
            zoom: 1.15,
            label: { show: false },
            itemStyle: {
              areaColor: "#20303c",
              borderColor: "#354957",
              borderWidth: 0.5,
            },
            emphasis: {
              itemStyle: { areaColor: "#344c60" },
              label: { show: false },
            },
          },
          series: [
            {
              type: "scatter",
              coordinateSystem: "geo",
              symbolSize: 13,
              labelLayout: { hideOverlap: true },
              data: [],
            },
          ],
        });
        chart.current.on("click", (p: any) => {
          if (p.data?.id) onSelect(p.data.id);
        });
        resize = new ResizeObserver(() => chart.current?.resize());
        resize.observe(ref.current);
        setReady(true);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
      controller.abort();
      resize?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);
  const located = nodes.filter(
    (n) =>
      n.meta.lat != null &&
      n.meta.lng != null &&
      Number.isFinite(n.meta.lat) &&
      Number.isFinite(n.meta.lng) &&
      !(n.meta.lat === 0 && n.meta.lng === 0),
  );
  useEffect(() => {
    if (ready)
      chart.current?.setOption({
        series: [
          {
            data: located.map((n) => ({
              name: displayName(n),
              id: n.uuid,
              value: [n.meta.lng, n.meta.lat],
              itemStyle: { color: n.online ? "#b5f568" : "#ff7b86" },
              label: {
                show: true,
                formatter: "{b}",
                position: "top",
                color: "#e1eaf2",
                fontSize: 11,
              },
            })),
          },
        ],
      });
  }, [ready, nodes]);
  return (
    <section className="map-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">GLOBAL FOOTPRINT</span>
          <h2>节点分布</h2>
        </div>
        <span className="subtle">拖动 / 缩放 · 点击节点查看</span>
      </div>
      <div ref={ref} className="world-map" />
      {error && <p role="alert">{error}</p>}
      <p className="map-note">
        {located.length} 个节点已配置坐标 · {nodes.length - located.length}{" "}
        个无坐标节点未标注
      </p>
    </section>
  );
}
