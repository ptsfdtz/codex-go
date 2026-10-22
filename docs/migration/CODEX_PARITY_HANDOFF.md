# 开发接手

当前工作：用户已将目标澄清为完整移动对话客户端（能发送与渲染图片、同步历史和任务状态），使用自有服务器纯转发；本轮完成规划与保留/裁剪建议，尚未删除产品代码。最新范围以 PLAN 为准，官方手机端参考见 [观察记录](../baselines/codex-mobile-2026-10-22.md)。

新增网页要求：浏览器直接访问，无需安装 App/VPN；Web/PWA 与安卓共用电脑会话。接入需补浏览器认证/Origin、公开信任证书、多设备与反向 TCP 隧道；当前只有规划，不能将现有 Tauri 管理页称为网页聊天客户端。

1. 先检查 git status，保留全部未提交修改。
2. 阅读 [计划](CODEX_PARITY_PLAN.md)、[当前状态](CODEX_PARITY_STATUS.md)，再读 [架构](../design/ARCHITECTURE.md)、[协议](../design/PROTOCOL.md)、[开发](../development/DEVELOPMENT.md)。
3. 用 [仓库结构](../development/REPOSITORY_STRUCTURE.md) 定位功能代码；当前实现、验证缺口与下一步只维护在 STATUS，避免重复和相互矛盾。
4. 按最新 PLAN 的顺序连续开发、集中验收；旧全桌面范围已归档。原版桌面共享仍未完成，中转与完整渲染未验收，不要升级“已共享/已完成”的声明。
5. 只有整个原计划阶段验收通过才提交，不自动推送。CI/发布改动与迁移工作同时存在，提交前逐项核对差异。

历史接手快照仅用于追溯：[2026-10-22](../history/migration/HANDOFF-2026-10-22.md)。其中“最新”“下一步”、机器路径及功能限制可能已过时，以当前 STATUS 和代码为准。
