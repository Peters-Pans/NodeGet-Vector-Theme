import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
} from "lucide-react";
import type { Node } from "../types";
import { cpuLabel, deriveUsage, displayName, osLabel } from "../utils/derive";
import { bytes, expiry, money, pct, uptime } from "../utils/format";
import { Spark } from "./Charts";
import { attentionReasons, type Design } from "./model";
export function AttentionBadges({
  node,
  showExpiry = true,
}: {
  node: Node;
  showExpiry?: boolean;
}) {
  const reasons = attentionReasons(node).filter(
    (reason) => showExpiry || reason.category !== "expiry",
  );
  if (!reasons.length) return null;
  return (
    <ul className="attention-badges" aria-label="关注原因">
      {reasons.map((reason) => (
        <li key={reason.label} className={reason.category}>
          {reason.label}
        </li>
      ))}
    </ul>
  );
}
export function Meter({
  label,
  value,
  detail,
}: {
  label: string;
  value?: number;
  detail?: string;
}) {
  return (
    <div
      className={`meter ${value >= 90 ? "critical" : value >= 70 ? "warm" : ""}`}
    >
      <div className="meter-label">
        <span>{label}</span>
        <strong>{pct(value)}</strong>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          value == null ? undefined : Math.min(100, Math.max(0, value))
        }
      >
        <i style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
      </div>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function NodeCard({
  node,
  index,
  design,
  onSelect,
}: {
  node: Node;
  index: number;
  design: Design;
  onSelect: (id: string) => void;
}) {
  const u = deriveUsage(node),
    exp = expiry(node.meta.expireTime);
  return (
    <article className={`node-card ${node.online ? "" : "is-offline"}`}>
      <div className="card-top">
        <span className="node-index">
          {design === "orbit" ? "SAT" : "N"}.
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className={`status ${node.online ? "" : "offline"}`}>
          <i />
          {node.online ? "在线" : "离线"}
        </span>
        <span className="region-code">{node.meta.region || "—"}</span>
      </div>
      <button className="card-title" onClick={() => onSelect(node.uuid)}>
        <span className="server-icon">
          <Server size={20} />
        </span>
        <span>
          <strong>{displayName(node)}</strong>
          <small>{osLabel(node) || "系统信息待上报"}</small>
        </span>
        <ChevronRight size={17} />
      </button>
      {design === "orbit" && (
        <div className="orbit-card-signal">
          <span>PROCESSOR LOAD</span>
          <Spark values={node.history.map((h) => h.cpu)} />
        </div>
      )}
      <AttentionBadges node={node} showExpiry={false} />
      <div className="card-meters">
        <Meter label="CPU" value={u.cpu} />
        <Meter label="内存" value={u.mem} />
        <Meter label="磁盘" value={u.disk} />
      </div>
      <div className="card-network">
        <span>
          <ArrowDownLeft size={14} />
          <b>{node.online ? bytes(u.netIn) : "—"}</b>
          <small>/s</small>
        </span>
        <span>
          <ArrowUpRight size={14} />
          <b>{node.online ? bytes(u.netOut) : "—"}</b>
          <small>/s</small>
        </span>
        {design === "vector" && (
          <Spark values={node.history.map((h) => h.cpu)} />
        )}
      </div>
      <div className="card-bottom">
        <span>
          {node.static.cpu?.physical_cores ||
            node.static.cpu?.per_core?.length ||
            "—"}{" "}
          核 <em>·</em> {bytes(u.memTotal)}
        </span>
        <span>运行 {uptime(u.uptime)}</span>
      </div>
      {(node.meta.tags.length > 0 || exp || node.meta.price > 0) && (
        <div className="card-meta">
          <span>
            {node.meta.tags.slice(0, 2).map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
            {money(node.meta.price, node.meta.priceUnit, node.meta.priceCycle)}
          </span>
          {exp && (
            <span className={exp.level === "crit" ? "danger-text" : ""}>
              {exp.days < 0
                ? "已到期"
                : exp.days > 3650
                  ? `到期 ${exp.date}`
                  : `${exp.days} 天后到期`}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
export function NodeRows({
  nodes,
  onSelect,
}: {
  nodes: Node[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="node-table">
        <thead>
          <tr>
            <th>节点 / 系统</th>
            <th>状态</th>
            <th>CPU</th>
            <th>内存</th>
            <th>磁盘</th>
            <th>↓ 入站 / ↑ 出站</th>
            <th>运行时间</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const u = deriveUsage(n);
            return (
              <tr key={n.uuid}>
                <td>
                  <button onClick={() => onSelect(n.uuid)}>
                    <span className="region-code">{n.meta.region || "—"}</span>
                    <span>
                      <strong>{displayName(n)}</strong>
                      <small>{cpuLabel(n) || osLabel(n)}</small>
                    </span>
                  </button>
                </td>
                <td>
                  <span className={`status ${n.online ? "" : "offline"}`}>
                    <i />
                    {n.online ? "在线" : "离线"}
                  </span>
                  <AttentionBadges node={n} />
                </td>
                <td>
                  <Meter label="CPU" value={u.cpu} />
                </td>
                <td>
                  <Meter label="内存" value={u.mem} />
                </td>
                <td>
                  <Meter label="磁盘" value={u.disk} />
                </td>
                <td className="mono">
                  {n.online ? bytes(u.netIn) : "—"}/s
                  <br />
                  <span className="subtle">
                    {n.online ? bytes(u.netOut) : "—"}/s
                  </span>
                </td>
                <td>{uptime(u.uptime)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
