# 长期延迟历史扩展

适用：NodeGet 0.5.15、SQLite、现有 `server-task-worker` 清理脚本。只使用 NodeGet 自带 JS Worker 和数据库，不新增守护进程或生产依赖。

保存策略：原始 Task 记录至少 7 天；5 分钟汇总 90 天；小时汇总 365 天。近期 24 小时仍由主题查询原始记录，7～90 天读取 5 分钟汇总，180/365 天读取小时汇总。响应按时间进一步合并为每条线路约 480 个绘图点，均值/丢包率使用样本计数加权，峰值保留原始最大值。

## 安装与回退

先在服务器上核实 NodeGet 配置、数据库路径和本机 RPC 地址。`deploy.py` 默认使用 `/var/lib/nodeget/nodeget.db` 与本机 2211 端口，只从当前服务内部复用既有凭据，不将凭据输出或下载。

1. 将此目录的 `deploy.py`、`worker.mjs` 上传到服务器的受限目录。
2. 执行 `sudo python3 deploy.py prepare --backup /var/backups/nodeget-latency/before-history.sqlite`。使用 SQLite 一致性快照在线备份，检查本次涉及的 KV、Worker、Cron 和 Task 表完整性；不扫描无关监控表。备份仅 root 可读，必须保护它，不要提交或下载到公开位置。
3. 执行 `sudo python3 deploy.py install --backup /var/backups/nodeget-latency/before-history.sqlite`。创建汇总 Worker、试跑、安装清理保护、将已有任务保留配置更新为 7 天，新增每 5 分钟执行的汇总任务。
4. 执行 `sudo python3 deploy.py verify --backup /var/backups/nodeget-latency/before-history.sqlite`，再用已有展示权限验证查询，并用无效凭据验证拒绝访问。
5. 回退时执行 `sudo python3 deploy.py rollback --backup /var/backups/nodeget-latency/before-history.sqlite`。通过 RPC 恢复原配置及清理脚本，保留已积累的汇总数据。回退会恢复旧的原始记录保留期限，可能让后续定时清理删除更多旧原始记录；操作前评估这一影响。不要用旧数据库文件覆盖正在写入的数据库。

安装脚本依赖已核对的清理代码结构；匹配不到时直接停止，不能盲目套用其他版本。

## 数据安全与权限

- 汇总按 UUID、协议、任务来源、目标地址、分辨率和时间桶隔离。相同任务名更换目标后仍保持独立。
- 使用完整区间重新计算后 upsert；重复运行不会累计重复计数。5 分钟和小时都持久化后才推进已归档时间。
- 清理前验证归档进度并重算即将删除的数据，覆盖晚到结果；删除边界收敛到完整小时。归档失败或进度落后时阻止任务清理，保留原始记录供排查。恢复后的较大清理积压每次最多处理一天，逐次排空。
- 定时汇总回读最近两小时更新未完成任务；更晚完成的结果在原始记录删除前最后一次汇总时更新。
- 失败探测保留为失败计数；未完成探测单独计数，不当作零延迟或丢包；缺失历史不会补造。汇总不计算逐点抖动，页面显示峰值。
- 查询接口 `/nodeget/worker-route/latency-history` 仅接受 POST，先用调用者原有 Token 验证指定节点和协议的 `task_query` 读取权限。不能匿名读取、传入 SQL、跨 UUID 绕过授权或获得服务内部凭据。
- 此扩展无需为展示 Token 新增权限。HTTP 错误只返回通用信息，不回显请求或内部异常。
- 清理脚本同时修复节点设置覆盖全局设置的优先级，并为该脚本设置 `disable_auto_update=true`，避免官方自动更新覆盖保护。其他 Worker 的自动更新不变。升级 NodeGet/Bootstrap 时应人工复核并移植这两处修复；不能无检查地重新启用该脚本自动更新。
- 原始数据库中超过 365 天的数据不归档；已被旧清理策略删除且没有备份的数据无法恢复。

## 验证

本地 Node 24+：`node --test backend/latency-history/*.test.mjs`。测试直接执行同一个 Worker SQL，并覆盖幂等、加权统计、目标隔离、失败/未完成探测、晚到更新、清理保护、保存期限和接口授权。

运行 `npm run typecheck`、`npm run build`，并在实际服务核对新旧数据、权限拒绝、清理保护及两个主题的 7/30/90/180/365 天视图。没有足够老的真实数据时，长期保存规则由测试验证，不能宣称已有一年生产历史。
