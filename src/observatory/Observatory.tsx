import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Box,
  Check,
  CircleDot,
  Command,
  Download,
  Globe2,
  Grid2X2,
  LayoutDashboard,
  List,
  Moon,
  Orbit,
  Radio,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import { useConfig } from "../hooks/useConfig";
import { useNodes } from "../hooks/useNodes";
import type { Node, Sort, View } from "../types";
import { bytes } from "../utils/format";
import { displayName } from "../utils/derive";
import { Traffic, World } from "./Charts";
import { NodeCard, NodeRows } from "./Nodes";
import { Detail } from "./Detail";
import { selectNodes, summarize, type Design, type Scope } from "./model";
function preference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function initialDesign(): Design {
  const requested = new URLSearchParams(location.search).get("design");
  if (requested === "vector" || requested === "orbit") return requested;
  const saved = preference("observatory.design", "");
  if (saved === "vector" || saved === "orbit") return saved;
  return document.documentElement.dataset.defaultDesign === "orbit"
    ? "orbit"
    : "vector";
}

function Brand({ design, logo }: { design: Design; logo?: string }) {
  return (
    <a href="#" className="brand" aria-label="返回总览">
      <span className="brand-mark">
        {logo ? (
          <img src={logo} alt="" />
        ) : design === "vector" ? (
          <Command size={23} />
        ) : (
          <Orbit size={26} />
        )}
      </span>
      <span>
        {design === "vector" ? "VECTOR" : "ORBIT"}
        <small>
          {design === "vector"
            ? "NETWORK OBSERVATORY"
            : "A WINDOW TO YOUR NETWORK"}
        </small>
      </span>
    </a>
  );
}
function Orbital({
  nodes,
  onSelect,
}: {
  nodes: Node[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="orbital-scene" aria-label="节点轨道示意图，不代表地理位置">
      <div className="orbit-ring ring-one" />
      <div className="orbit-ring ring-two" />
      <div className="orbit-ring ring-three" />
      <div className="planet">
        <div className="planet-meridian" />
        <div className="planet-meridian second" />
        <div className="planet-latitude" />
        <div className="planet-latitude second" />
        <div className="planet-core">
          <Orbit size={27} />
          <span>
            CONNECTED
            <br />
            BY DESIGN
          </span>
        </div>
      </div>
      {nodes.slice(0, 12).map((n, i) => {
        const angle =
          (i / Math.min(nodes.length, 12)) * Math.PI * 2 - Math.PI / 2;
        return (
          <button
            key={n.uuid}
            className={`satellite ${n.online ? "" : "is-offline"}`}
            style={{
              left: `${50 + 42 * Math.cos(angle)}%`,
              top: `${50 + 40 * Math.sin(angle)}%`,
            }}
            title={displayName(n)}
            onClick={() => onSelect(n.uuid)}
          >
            <i />
            <span>
              {n.meta.region || "NODE"}
              <small>{displayName(n)}</small>
            </span>
          </button>
        );
      })}
      <span className="orbital-caption">
        LIVE CONSTELLATION <span>·</span>{" "}
        {nodes.length > 12 ? "前 12 个节点" : "实时节点星图"}
      </span>
    </div>
  );
}
export function Observatory() {
  const { config, error } = useConfig(),
    { nodes: nodeMap, loading, errors, pool } = useNodes(config);
  const [design, setDesign] = useState<Design>(initialDesign),
    [light, setLight] = useState(
      () => preference("observatory.light", "false") === "true",
    );
  const [view, setView] = useState<View>("cards"),
    [scope, setScope] = useState<Scope>("all"),
    [search, setSearch] = useState(""),
    [region, setRegion] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState<Sort>("default");
  const [selected, setSelected] = useState<string | null>(
    () => decodeURIComponent(location.hash.slice(1)) || null,
  );
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.design = design;
    document.documentElement.dataset.light = String(light);
    try {
      localStorage.setItem("observatory.design", design);
      localStorage.setItem("observatory.light", String(light));
    } catch {}
  }, [design, light]);
  useEffect(() => {
    document.title = `${config?.user_preferences.site_name || "NodeGet"} · ${design.toUpperCase()}`;
  }, [config, design]);
  useEffect(() => {
    const fn = () =>
      setSelected(decodeURIComponent(location.hash.slice(1)) || null);
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  const openNode = useCallback((id: string) => {
    setSelected(id);
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${encodeURIComponent(id)}`,
    );
  }, []);
  const closeNode = () => {
    setSelected(null);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  };
  const nodes = useMemo(
      () => [...nodeMap.values()].filter((n) => !n.meta.hidden),
      [nodeMap],
    ),
    summary = summarize(nodes);
  const filtered = selectNodes(nodes, search, region, tag, scope, sort);
  const regions = [
      ...new Set(nodes.map((n) => n.meta.region).filter(Boolean)),
    ].sort(),
    tags = [...new Set(nodes.flatMap((n) => n.meta.tags))].sort();
  const current = selected ? nodes.find((n) => n.uuid === selected) : null;
  const setDesignChoice = (value: Design) => {
    setDesign(value);
    const url = new URL(location.href);
    url.searchParams.set("design", value);
    history.replaceState(null, "", url);
  };
  const reset = () => {
    setSearch("");
    setRegion("");
    setTag("");
    setScope("all");
  };
  const connected =
    nodes.length > 0 && summary.online === nodes.length && !errors.length;
  const stateLabel = loading
    ? "正在建立连接"
    : error || errors.length
      ? "后端连接异常"
      : !nodes.length
        ? "等待节点接入"
        : connected
          ? "所有节点在线"
          : "部分节点离线";
  return (
    <div className={`observatory ${design}`}>
      <a className="skip-link" href="#main">
        跳至主要内容
      </a>
      {design === "vector" && (
        <aside className="side-rail">
          <Brand design={design} logo={config?.user_preferences.site_logo} />
          <div className="rail-label">WORKSPACE</div>
          <nav aria-label="主导航">
            <button
              aria-label="总览"
              className={view !== "map" && scope === "all" ? "active" : ""}
              onClick={() => {
                setView("cards");
                setScope("all");
              }}
            >
              <LayoutDashboard size={18} />
              <span>总览</span>
              <small>01</small>
            </button>
            <button
              aria-label="在线节点"
              className={scope === "online" && view !== "map" ? "active" : ""}
              onClick={() => {
                setView("table");
                setScope("online");
              }}
            >
              <Server size={18} />
              <span>在线节点</span>
              <small>{summary.online}</small>
            </button>
            <button
              aria-label="全球分布"
              className={view === "map" ? "active" : ""}
              onClick={() => setView("map")}
            >
              <Globe2 size={18} />
              <span>全球分布</span>
              <small>03</small>
            </button>
            <button
              aria-label="需要关注"
              className={
                scope === "attention" && view !== "map" ? "active" : ""
              }
              onClick={() => {
                setView("cards");
                setScope("attention");
              }}
            >
              <Activity size={18} />
              <span>需要关注</span>
              <small>{summary.attention}</small>
            </button>
          </nav>
          <div className="rail-bottom">
            <div className="rail-system">
              <Radio size={17} />
              <div>
                系统遥测<span>每 2 秒自动更新</span>
              </div>
              <i className={`signal-dot ${connected ? "" : "muted-dot"}`} />
            </div>
            <span className="rail-version">VECTOR / EDITION 01</span>
          </div>
        </aside>
      )}
      <div className="workspace">
        <header className="topbar">
          {design === "orbit" ? (
            <Brand design={design} logo={config?.user_preferences.site_logo} />
          ) : (
            <div className="breadcrumb">
              <span>工作空间</span>
              <Chevron />
              <strong>
                {config?.user_preferences.site_name || "我的基础设施"}
              </strong>
            </div>
          )}
          <div className="topbar-actions">
            <div className="design-switch" role="group" aria-label="主题方案">
              <button
                aria-pressed={design === "vector"}
                className={design === "vector" ? "active" : ""}
                onClick={() => setDesignChoice("vector")}
              >
                <Command size={13} />
                VECTOR
              </button>
              <button
                aria-pressed={design === "orbit"}
                className={design === "orbit" ? "active" : ""}
                onClick={() => setDesignChoice("orbit")}
              >
                <Orbit size={14} />
                ORBIT
              </button>
            </div>
            <button
              className="icon-button appearance"
              onClick={() => setLight((v) => !v)}
              aria-label={light ? "切换深色模式" : "切换浅色模式"}
            >
              {light ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <span className="avatar">P</span>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {design === "vector"
                  ? "INFRASTRUCTURE / OVERVIEW"
                  : "YOUR PERSONAL CONSTELLATION"}
              </span>
              <h1>
                {design === "vector"
                  ? "全局概览"
                  : config?.user_preferences.site_name || "我的节点星系"}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {design === "vector"
                  ? "每一个节点，每一次心跳。"
                  : "跨越时区，连接每一个坐标。"}
              </p>
            </div>
            <div className="live-clock">
              <span>
                <i className="signal-dot" /> LIVE TELEMETRY
              </span>
              <strong>
                {clock.toLocaleTimeString("en-GB", { hour12: false })}
                <small>
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </small>
              </strong>
            </div>
          </div>
          {error && (
            <div className="error-panel" role="alert">
              <Activity size={20} />
              <div>
                <strong>站点配置无法加载</strong>
                <p>{String(error.message || error)}</p>
              </div>
              <button onClick={() => location.reload()}>重新加载</button>
            </div>
          )}
          {errors.length > 0 && (
            <div className="error-panel" role="alert">
              <Activity size={20} />
              <div>
                <strong>部分后端暂时无法连接</strong>
                {errors.map((e, i) => (
                  <p key={i}>
                    {e.source} ·{" "}
                    {e.error instanceof Error
                      ? e.error.message
                      : String(e.error)}
                  </p>
                ))}
              </div>
              <button onClick={() => location.reload()}>重新连接</button>
            </div>
          )}
          {design === "vector" ? (
            <section className="vector-overview">
              <div className="fleet-panel">
                <div className="panel-label">
                  <span>节点在线情况</span>
                  <Radio size={16} />
                </div>
                <div className="fleet-number">
                  {String(summary.online).padStart(2, "0")}
                  <span>/ {String(nodes.length).padStart(2, "0")}</span>
                </div>
                <div
                  className={`health-label ${connected ? "" : "unconfirmed"}`}
                >
                  <i className="signal-dot" />
                  {stateLabel}
                </div>
                <div className="fleet-ticks">
                  {nodes.map((n) => (
                    <button
                      key={n.uuid}
                      title={`${displayName(n)} · ${n.online ? "在线" : "离线"}`}
                      aria-label={`查看 ${displayName(n)}`}
                      className={n.online ? "on" : ""}
                      onClick={() => openNode(n.uuid)}
                    />
                  ))}
                </div>
                <div className="fleet-footer">
                  <span>{regions.length} 个区域</span>
                  <span>{summary.attention} 个待关注</span>
                </div>
              </div>
              <div className="traffic-panel">
                <div className="panel-label">
                  <span>网络吞吐</span>
                  <span className="chart-key">
                    <i />
                    入站 <i />
                    出站
                  </span>
                </div>
                <div className="traffic-figures">
                  <div>
                    <ArrowDownLeft size={16} />
                    <strong>{bytes(summary.in)}</strong>
                    <span>/s</span>
                  </div>
                  <div>
                    <ArrowUpRight size={16} />
                    <strong>{bytes(summary.out)}</strong>
                    <span>/s</span>
                  </div>
                </div>
                <Traffic nodes={nodes} />
                <div className="chart-bottom">
                  <span>本次会话 · 最近 60 个采样</span>
                  <span>
                    累计流量 <b>{bytes(summary.total)}</b>
                  </span>
                </div>
              </div>
              <div className="regions-panel">
                <div className="panel-label">
                  <span>区域分布</span>
                  <Globe2 size={16} />
                </div>
                <strong className="region-count">
                  {String(regions.length).padStart(2, "0")}
                  <span>REGIONS</span>
                </strong>
                <div className="region-list">
                  {regions.map((r) => {
                    const amount = nodes.filter(
                      (n) => n.meta.region === r,
                    ).length;
                    return (
                      <button
                        key={r}
                        onClick={() => setRegion(region === r ? "" : r)}
                      >
                        <span className="region-code">{r}</span>
                        <span>
                          <i
                            style={{
                              width: `${(amount / Math.max(nodes.length, 1)) * 100}%`,
                            }}
                          />
                        </span>
                        <b>{amount}</b>
                      </button>
                    );
                  })}
                  {!regions.length && (
                    <span className="subtle">等待区域信息</span>
                  )}
                </div>
                <button className="text-link" onClick={() => setView("map")}>
                  探索全球分布 <ArrowRight size={14} />
                </button>
              </div>
            </section>
          ) : (
            <section className="orbit-overview">
              <div className="orbit-copy">
                <span className="orbit-kicker">
                  <i className="signal-dot" />
                  {stateLabel}
                </span>
                <h2>
                  近在眼前，
                  <br />
                  <span>远在全球。</span>
                </h2>
                <p>
                  从每一次心跳，到每一条连接。
                  <br />
                  你的基础设施，在这里清晰可见。
                </p>
                <div className="orbit-counts">
                  <div>
                    <strong>{String(summary.online).padStart(2, "0")}</strong>
                    <span>在线节点 / {nodes.length}</span>
                  </div>
                  <div>
                    <strong>{String(regions.length).padStart(2, "0")}</strong>
                    <span>覆盖区域</span>
                  </div>
                  <div>
                    <strong>
                      {String(summary.attention).padStart(2, "0")}
                    </strong>
                    <span>需要关注</span>
                  </div>
                </div>
                <button
                  className="orbit-explore"
                  onClick={() => {
                    setView("map");
                    document
                      .getElementById("node-section")
                      ?.scrollIntoView({
                        behavior: matchMedia("(prefers-reduced-motion: reduce)")
                          .matches
                          ? "auto"
                          : "smooth",
                      });
                  }}
                >
                  探索节点分布 <ArrowUpRight size={17} />
                </button>
              </div>
              <Orbital nodes={nodes} onSelect={openNode} />
              <div className="orbit-traffic">
                <div className="panel-label">
                  <span>
                    <Activity size={14} />
                    网络脉动
                  </span>
                  <span>LIVE</span>
                </div>
                <div className="orbit-bandwidth">
                  <span>
                    ↓ {bytes(summary.in)}
                    <small>/s</small>
                  </span>
                  <span>
                    ↑ {bytes(summary.out)}
                    <small>/s</small>
                  </span>
                </div>
                <Traffic nodes={nodes} />
              </div>
            </section>
          )}
          <section id="node-section" className="node-section">
            <div className="section-heading">
              <div className="section-title">
                <h2>{view === "map" ? "全球视野" : "节点舰队"}</h2>
                <span className="count-badge">{filtered.length}</span>
                <span className="subtle fleet-caption">
                  {design === "vector"
                    ? "YOUR FLEET, AT A GLANCE"
                    : "EVERY NODE, A POINT OF LIGHT"}
                </span>
              </div>
              <div className="segmented view-switch" aria-label="显示方式">
                {(
                  [
                    { value: "cards", icon: Grid2X2, label: "卡片" },
                    { value: "table", icon: List, label: "列表" },
                    { value: "map", icon: Globe2, label: "地图" },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.value}
                    aria-label={v.label}
                    className={view === v.value ? "active" : ""}
                    aria-pressed={view === v.value}
                    onClick={() => setView(v.value)}
                  >
                    <v.icon size={15} />
                    <span>{v.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="filterbar">
              <label className="search">
                <Search size={16} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索节点、区域或标签…"
                  aria-label="搜索节点"
                />
                {search && (
                  <button onClick={() => setSearch("")} aria-label="清空搜索">
                    <X size={14} />
                  </button>
                )}
              </label>
              <div className="filter-selects">
                <select
                  aria-label="在线状态"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as Scope)}
                >
                  <option value="all">全部状态</option>
                  <option value="online">在线节点</option>
                  <option value="attention">需要关注</option>
                </select>
                <select
                  aria-label="区域筛选"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option value="">全部区域</option>
                  {regions.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                {tags.length > 0 && (
                  <select
                    aria-label="标签筛选"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  >
                    <option value="">全部标签</option>
                    {tags.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                )}
                <select
                  aria-label="排序方式"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                >
                  <option value="default">默认排序</option>
                  <option value="name">名称</option>
                  <option value="cpu">CPU 使用率</option>
                  <option value="mem">内存使用率</option>
                  <option value="disk">磁盘使用率</option>
                  <option value="netIn">入站带宽</option>
                  <option value="netOut">出站带宽</option>
                  <option value="uptime">运行时间</option>
                </select>
              </div>
            </div>
            {loading ? (
              <div className="loading-grid" aria-label="正在连接后端">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton-card">
                    <span />
                    <span />
                    <span />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <Box size={32} />
                <h3>
                  {nodes.length
                    ? "没有匹配的节点"
                    : errors.length
                      ? "暂时无法读取节点"
                      : "还没有节点"}
                </h3>
                <p>
                  {nodes.length
                    ? "尝试其他关键词，或清除筛选条件。"
                    : errors.length
                      ? "请检查后端连接或浏览器拦截规则。"
                      : "连接配置中的后端后，节点将在这里出现。"}
                </p>
                {nodes.length > 0 && (
                  <button onClick={reset}>清除全部筛选</button>
                )}
              </div>
            ) : view === "map" ? (
              <World nodes={filtered} onSelect={openNode} />
            ) : view === "table" ? (
              <NodeRows nodes={filtered} onSelect={openNode} />
            ) : (
              <div className="node-grid">
                {filtered.map((n, i) => (
                  <NodeCard
                    key={n.uuid}
                    node={n}
                    index={i}
                    design={design}
                    onSelect={openNode}
                  />
                ))}
              </div>
            )}
          </section>
          <footer className="footer">
            <span>
              <span className="footer-mark">
                {design === "vector" ? (
                  <Command size={14} />
                ) : (
                  <Orbit size={16} />
                )}
              </span>
              {config?.user_preferences.footer || "Powered by NodeGet"}
              <span className="footer-divider">/</span>
              {design.toUpperCase()} EDITION
            </span>
            {import.meta.env.PROD && (
              <a href="./download.html">
                <Download size={13} />
                下载主题
              </a>
            )}
          </footer>
        </main>
      </div>
      {current && (
        <Detail
          key={current.uuid}
          node={current}
          pool={pool}
          onClose={closeNode}
        />
      )}
    </div>
  );
}
function Chevron() {
  return <span className="breadcrumb-slash">/</span>;
}
