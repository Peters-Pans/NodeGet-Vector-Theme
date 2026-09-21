# VECTOR · NodeGet 主题

深墨色、荧光绿、侧边导航与精密仪表分区。

默认白天模式，支持手动切换深色并记住选择。支持手机布局、节点搜索、状态 / 区域 / 标签筛选、排序、卡片 / 列表 / 地图、节点详情、资源曲线与 ICMP / TCP 延迟历史。

延迟图按实际记录跨度显示时间刻度，点击图例可单独查看线路。首页按节点区分离线、资源过高和到期提醒；卡片保留原有到期信息，不重复添加到期标签。

## 开发

```sh
npm ci
cp .env.example .env.local
# 在 .env.local 中设置 NODEGET_CONFIG
npm run dev
```

默认使用 VECTOR，页面顶部可随时切换 VECTOR / ORBIT，刷新后保留选择。链接中的 `?design=vector` 或 `?design=orbit` 可指定主题；未指定时使用本地偏好或仓库默认主题。资源曲线展示本次会话的最近 60 个采样点。延迟历史支持 1 小时、6 小时、24 小时、7 天、30 天、90 天、180 天和 365 天窗口。长范围每种探测类型单次最多读取 50,000 条后端记录，达到上限时提示可能不完整，并显示返回记录覆盖的日期；实际可查范围取决于后端历史保留策略。

## 构建和部署

```sh
npm run typecheck
npm run build
```

Cloudflare Pages：构建命令 `npm run build`，输出目录 `dist`。使用 `NODEGET_CONFIG` 环境变量设置后端连接与站点名称：

```json
{"user_preferences":{"site_name":"我的节点","site_logo":"","footer":"Powered by NodeGet"},"site_tokens":[{"name":"主后端","backend_url":"wss://your-backend.example.com","token":"YOUR_READ_ONLY_TOKEN"}]}
```

静态状态页会公开连接配置，务必使用只读监控令牌。构建生成的 `dist/NodeGet-StatusShow.zip` 使用示例配置，不包含部署环境中的令牌；也可从 GitHub Releases 下载主题包。

## 相关主题

- [VECTOR](https://github.com/Peters-Pans/NodeGet-Vector-Theme)
- [ORBIT](https://github.com/Peters-Pans/NodeGet-Orbit-Theme)

## 来源与许可

数据协议、API 客户端、数据 hooks 和工具函数沿用 [NodeGet-StatusShow](https://github.com/NodeSeekDev/NodeGet-StatusShow) 与 [Almanac](https://github.com/Peters-Pans/NodeGet-Almanac-Theme) 的基础。页面视觉与展示组件重新实现。遵循 AGPL-3.0，见 [LICENSE](LICENSE)。

## 长期延迟历史

0.3.0 支持后端汇总查询：原始记录 7 天、5 分钟汇总 90 天、小时汇总 365 天。24 小时内保持原始探测查询；更长范围需要安装 [延迟历史扩展](backend/latency-history/README.md)。已有历史从安装时仍保留的数据开始积累，已删除的数据不会恢复。
