import type { Node, Sort } from "../types";
import { deriveUsage, displayName } from "../utils/derive";
import { expiry } from "../utils/format";
export type Design = "vector" | "orbit";
export type Scope = "all" | "online" | "attention";
export function needsAttention(node: Node) {
  const u = deriveUsage(node);
  return (
    expiry(node.meta.expireTime)?.level === "crit" ||
    !node.online ||
    (u.cpu ?? 0) >= 90 ||
    (u.mem ?? 0) >= 90 ||
    (u.disk ?? 0) >= 90
  );
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
      s.attention += Number(needsAttention(n));
      s.in += n.online ? (d?.receive_speed ?? 0) : 0;
      s.out += n.online ? (d?.transmit_speed ?? 0) : 0;
      s.total += (d?.total_received ?? 0) + (d?.total_transmitted ?? 0);
      return s;
    },
    { online: 0, attention: 0, in: 0, out: 0, total: 0 },
  );
}
