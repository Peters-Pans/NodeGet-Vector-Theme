import { useEffect, useState } from "react";
import { taskQuery } from "../api/methods";
import type { BackendPool } from "../api/pool";
import type { TaskQueryResult } from "../types";

const QUERY_TIMEOUT_MS = 25_000;

function clean(rows: TaskQueryResult[] | undefined): TaskQueryResult[] {
  return (rows ?? [])
    .filter((r) => r.cron_source && r.cron_source !== "未知")
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 拉取节点的延迟(ping / tcp_ping)历史。
 * windowMs 决定时间窗口;limit 显式传给后端——task_query 默认封顶 1000 行且只回最近的一段,
 * 不传 limit 会让长窗口静默退化成「最近 ~2 小时」。统计值在组件侧按全量 rows 计算,图表再降采样。
 */
export function useNodeLatency(
  pool: BackendPool | null,
  source: string | null,
  uuid: string | null,
  windowMs: number,
  limit: number,
  refreshMs: number,
) {
  const [pingData, setPingData] = useState<TaskQueryResult[]>([]);
  const [tcpData, setTcpData] = useState<TaskQueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ ping: false, tcp_ping: false });
  const [truncated, setTruncated] = useState({ ping: false, tcp_ping: false });

  // 节点或时间范围变化时清空旧结果，避免把旧窗口的数据标成新窗口。
  useEffect(() => {
    setPingData([]);
    setTcpData([]);
    setErrors({ ping: false, tcp_ping: false });
    setTruncated({ ping: false, tcp_ping: false });
  }, [source, uuid, windowMs, limit]);

  useEffect(() => {
    if (!pool || !source || !uuid) return;
    const entry = pool.entries.find((e) => e.name === source);
    if (!entry) return;

    let cancelled = false;

    const fetchOnce = async () => {
      const now = Date.now();
      const window: [number, number] = [now - windowMs, now];
      setLoading(true);

      const [ping, tcp] = await Promise.allSettled([
        taskQuery(
          entry.client,
          [
            { uuid },
            { timestamp_from_to: window },
            { type: "ping" },
            { limit },
          ],
          QUERY_TIMEOUT_MS,
        ),
        taskQuery(
          entry.client,
          [
            { uuid },
            { timestamp_from_to: window },
            { type: "tcp_ping" },
            { limit },
          ],
          QUERY_TIMEOUT_MS,
        ),
      ]);

      if (cancelled) return;
      setPingData(ping.status === "fulfilled" ? clean(ping.value) : []);
      setTcpData(tcp.status === "fulfilled" ? clean(tcp.value) : []);
      setErrors({
        ping: ping.status === "rejected",
        tcp_ping: tcp.status === "rejected",
      });
      setTruncated({
        ping: ping.status === "fulfilled" && (ping.value?.length ?? 0) >= limit,
        tcp_ping:
          tcp.status === "fulfilled" && (tcp.value?.length ?? 0) >= limit,
      });
      setLoading(false);
    };

    fetchOnce();
    const timer = setInterval(fetchOnce, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pool, source, uuid, windowMs, limit, refreshMs]);

  return { pingData, tcpData, loading, errors, truncated };
}
