# 开发工具

从仓库根目录执行。构建/启动优先使用 package.json 的 pnpm 命令；脚本分类不改变参数、权限或是否消耗账户额度。

| 目录      | 用途与常用入口                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| setup/    | Windows 开发环境：setup-windows-dev.ps1                                                                                   |
| desktop/  | 原生运行时准备、构建打包、启动、受支持 CLI 安装、显式数据迁移与安装核验                                                   |
| protocol/ | schema.mjs 校验锁定合约；audit-codex-protocol.mjs 导出差异；pin-desktop-protocol.mjs 仅在获准切换版本并完成兼容核验时使用 |
| codex/    | 桌面静态审计、UI 清单、隔离 GUI/共享运行时检查；不能替代原版桌面与安卓验收                                                |
| checks/   | 原生运行时检查、显式本机数据备份核验                                                                                      |
| android/  | android-physical-ui.mjs：显式设备测试辅助                                                                                 |
| lib/      | 共用协议/历史/stdio 工具与既有 Node 测试                                                                                  |

```powershell
pnpm desktop:dev
pnpm desktop:prepare
pnpm desktop:build
pnpm package:windows
pnpm start
pnpm schema:verify
node --test scripts/lib/*.test.mjs
```

真实上游、模型请求及设备验收须按 [开发指南](../docs/development/DEVELOPMENT.md) 显式运行，不能作为目录整理的自动副作用。
