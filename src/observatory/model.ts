import type { Node, Sort } from "../types";
import { deriveUsage, displayName } from "../utils/derive";
import { expiry } from "../utils/format";
export type Design = "vector" | "orbit";
export type Scope = "all" | "online" | "attention";
export type AttentionCategory = "offline" | "resource" | "expiry";
export const attentionLabels: Record<AttentionCategory, string> = {
  offline: "节点离线",
  resource: "资源过高",
  expiry: "到期提醒",
};
export function attentionReasons(node: Node) {
  const reasons: { category: AttentionCategory; label: string }[] = [];
  const u = deriveUsage(node);
  const exp = expiry(node.meta.expireTime);
  if (!node.online) reasons.push({ category: "offline", label: "节点离线" });
  for (const [name, value] of [
    ["CPU", u.cpu],
    ["内存", u.mem],
    ["磁盘", u.disk],
  ] as const) {
    if ((value ?? 0) >= 90)
      reasons.push({
        category: "resource",
        label: `${name}使用率 ${value!.toFixed(1)}%`,
      });
  }
  if (exp?.level === "crit")
    reasons.push({
      category: "expiry",
      label: exp.days < 0 ? "已过期" : `登记到期日剩余 ${exp.days} 天`,
    });
  return reasons;
}
export function needsAttention(node: Node) {
  return attentionReasons(node).length > 0;
}
export function selectNodes(
  nodes: Node[],
  search: string,
  region: string,
  tag: string,
  scope: Scope,
  sort: Sort,
) {
  const query = search.trim().toLocaleLowerCase();
  return nodes
    .filter((n) => !n.meta.hidden)
    .filter(
      (n) =>
        !query ||
        [displayName(n), n.meta.region, n.source, ...n.meta.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
    )
    .filter((n) => !region || n.meta.region === region)
    .filter((n) => !tag || n.meta.tags.includes(tag))
    .filter(
      (n) =>
        scope === "all" || (scope === "online" ? n.online : needsAttention(n)),
    )
    .sort((a, b) => {
      if (sort === "default")
        return (
          a.meta.order - b.meta.order ||
          displayName(a).localeCompare(displayName(b))
        );
      if (sort === "name") return displayName(a).localeCompare(displayName(b));
      if (sort === "region") return a.meta.region.localeCompare(b.meta.region);
      return (deriveUsage(b)[sort] ?? -1) - (deriveUsage(a)[sort] ?? -1);
    });
}
export function summarize(nodes: Node[]) {
  return nodes.reduce(
    (s, n) => {
      const d = n.dynamic;
      s.online += Number(n.online);
      const reasons = attentionReasons(n);
      s.attention += Number(reasons.length > 0);
      for (const category of new Set(reasons.map((r) => r.category)))
        s.attentionCounts[category]++;
      s.in += n.online ? (d?.receive_speed ?? 0) : 0;
      s.out += n.online ? (d?.transmit_speed ?? 0) : 0;
      s.total += (d?.total_received ?? 0) + (d?.total_transmitted ?? 0);
      return s;
    },
    {
      online: 0,
      attention: 0,
      attentionCounts: { offline: 0, resource: 0, expiry: 0 },
      in: 0,
      out: 0,
      total: 0,
    },
  );
}
