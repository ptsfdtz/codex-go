# 发布与运维

[开发入口](../AGENTS.md) · [当前版本与回退入口](status.md) · [运行时专项验收](runtime.md)

以下命令均从仓库根目录执行。单次上线授权或验收豁免仅适用于用户明确授权的当次范围，不作为后续发布依据。

## 下载发布与 VPS

### 正式发布流程与强制验收

**每次正式发布前，必须在 Windows、Linux 和 macOS 上使用本次候选产物完成真实端到端测试，全部通过后才能发布。** 适用于 Host、Web/PWA、云端的正式更新及热修复；仅修改其中一个组件也须验证各平台完整链路。构建、Clippy、接口健康、下载校验、CLI 启动、模拟数据及历史版本测试均不能代替本次验收。任一平台失败、未测或环境不可用时，只能保留候选版，不得发布正式版、更新生产 Web/云端或推进稳定下载指针。

1. **准备候选版**：固定源码提交、版本及更新说明，完成必要静态检查和构建；绑定 Windows/Linux/macOS 包、Web、云端的版本与 SHA-256，未变组件记录其实际版本。候选产物独立存放，不更新生产入口或稳定指针。
2. **各平台真实验收**：分别在真实 Windows、Linux、macOS 环境安装候选 Host，通过候选 Web/PWA、真实云端连接及真实 Codex/模型完成下表。发布包覆盖的架构分别记录结果，Linux x64 通过不等于 ARM64 通过，macOS arm64 也须单独实测；缺少某架构实测时不得将其列为本次已验收正式更新。
3. **记录结论**：在[功能状态与验证](status.md)简短记录候选版本/提交、产物哈希、系统与架构、Codex 版本、实际测试结果及未验证项，不记录凭据。既有“已发布”与历史验证描述不构成本次发布准入。
4. **发布已验收产物**：取得当次发布授权后，备份并部署同一批产物，不重新构建替换；产物变化必须重新验收。核对线上版本、文件校验和健康状态后再开放稳定更新；失败停止后续步骤，按组件恢复旧程序、静态资源或下载指针，数据库迁移单独判断，不自动回滚数据库。

| 各平台必测链路   | 通过标准                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| 安装与升级       | 实际安装候选包，并从当前稳定版升级；身份、账户、项目授权和历史保留，实际运行版本正确                   |
| Web/PWA 远程连接 | 通过实际云端转发连接对应 Host，确认所选电脑与身份一致、Codex 就绪；候选环境不替换日常生产服务          |
| 会话与真实任务   | 读取已有会话历史，新建会话并发送真实模型任务，接收流式结果及完成状态，重开后通过原生接口读回同一会话   |
| 项目与权限       | 实际读取项目指令、在授权项目读写文件，验证一次性审批和拒绝、沙箱外未授权读写被阻止，不关闭沙箱兜底     |
| 重启与恢复       | 空闲重启后自动重连、身份与历史保持；实际断线重连后核对任务结果，不丢审批、不重复发送未知结果任务       |
| 本次改动         | 在各平台真实链路中验证变更功能及相关旧客户端兼容；涉及更新时验证下载安装、空闲切换、就绪判定与失败恢复 |

发布自动化（已实现，未在线运行）：推送代码只运行检查，不再自动发布或部署 Pages。在 GitHub Actions 的 **Prepare candidate** 选择 `release` 分支，填写公开版本号 `X.Y.Z` 和更新说明；构建 Windows/Linux/macOS Host、正式 Web、Pages 与云端，生成绑定提交及全部文件 SHA-256 的 `candidate.json`，保存为 `candidate-X.Y.Z` 预发布。随后只上传不可变候选下载文件，不切换生产 Web、云端或稳定指针，供实测机验证真正的下载安装。正式流程 **Promote tested release** 仅下载这批产物，强制验证 Windows x64、Linux x64/ARM64、macOS arm64 的实测记录，备份并部署 VPS、核对健康和公开文件、部署 Pages，最后开放稳定更新并生成 `vX.Y.Z` 正式 Release。构建、证据验证、VPS、Pages 任一步失败都不进入后续步骤；VPS/Pages 跨服务并非原子事务，部署部分成功时需核对 Actions 及备份后重试，不能宣称全部发布完成。下载发布脚本本身也强制验收门槛，缺少证据不得手动推进稳定指针；正式晋升拒绝用较低版本覆盖现有稳定版。

候选版下载并解包后，用 Python ≥3.11 生成实测记录模板；模板所有检查默认为未通过，不生成模拟通过记录：

```sh
gh release download candidate-X.Y.Z --pattern candidate.tar.gz --pattern candidate.tar.gz.sha256
# 先按 .sha256 核对归档，再解包到独立候选目录
python scripts/release/extract.py candidate.tar.gz artifacts/candidate
python scripts/release/gate.py template artifacts/candidate --evidence artifacts/evidence
```

原生更新测试在隔离实测机本地执行 `agentdeck update-channel candidate X.Y.Z`，网页刷新更新检查后即可下载安装已暂存的候选版本；测试完用 `agentdeck update-channel stable` 恢复稳定通道。选择保存在该机状态目录，网页不能切换通道或下载源，已开始的更新始终固定到已确认版本。首次引入原生更新能力时，可使用两个实际构建的候选版本验证升级前后链路，同时核对稳定版安装升级；不得改写 `release.txt` 假装升级，也不得提前切换生产稳定指针。

分别在对应 Windows/Linux/macOS 实测机安装候选包并从当前稳定版升级，使用候选 Web、真实云端、Codex 和模型完成上表；填写该平台 JSON 中的 `tester`、真实 `sessionId`、每项 `passed` 与 `observed`，在 `logs` 中列出已脱敏证据文件相对路径（值先留空）。在该机用候选版 CLI 执行 `record`，自动读取真实 Host 状态，核对实际系统/架构、运行版本、云端/Codex 就绪及沙箱验证，记录电脑身份、Codex 版本、时间并计算证据哈希；它不代替真实模型、审批、重连及变更功能测试，也不自动把检查改为通过。

```sh
# 每台实测机只录入自身平台；其余平台分别用 linux-x64、linux-arm64、macos-arm64
python scripts/release/gate.py record artifacts/candidate --evidence artifacts/evidence --platform windows-x64 --agentdeck "C:/Users/NAME/AppData/Local/Programs/AgentDeck/versions/X.Y.Z/agentdeck.exe"
# 汇总各平台 JSON 和各自的脱敏证据文件后执行
python scripts/release/gate.py verify artifacts/candidate --evidence artifacts/evidence
tar -czf e2e-evidence.tar.gz -C artifacts/evidence .
gh release upload candidate-X.Y.Z e2e-evidence.tar.gz
```

证据文件不得包含令牌、密码、未脱敏日志或完整聊天；不可用历史测试或改模板冒充实测。全部通过且取得当次发布授权后，才在 Actions 运行 **Promote tested release** 并填写同一版本。候选归档或清单变化会使原证据失效；缺少 ARM64 实测时本流程也会阻止正式晋升。CLI `--version` 同时显示安装发布版本和内核版本，提交哈希保留用于产物诊断。

首次启用自动部署需配置 GitHub `candidate` 与 `production` environments 的分支规则，并为 `production` 设置发布审核；设置变量 `AGENTDECK_CLOUD_ORIGIN`、`AGENTDECK_DEPLOY_HOST`（SSH 目标），以及 secrets `AGENTDECK_DEPLOY_KEY`、`AGENTDECK_DEPLOY_KNOWN_HOSTS`（固定服务器指纹，不临时信任扫描结果）。VPS 需 Python ≥3.11、curl、tar、sha256sum、flock，现有 Nginx/systemd 与可成功执行的 `agentdeck-backup.service`；部署用户须具备既有发布目录及服务管理权限。在受保护的 `/etc/agentdeck/release.env` 设置 `AGENTDECK_WEB_LINK` 为现有 Nginx 文档根目录的绝对符号链接，云端链接默认 `/opt/agentdeck/current`，下载目录默认 `/opt/agentdeck/downloads`，公网域名默认 `https://agent.ptsfdtz.top`；脚本拒绝猜测或覆盖普通目录。只有已确认数据库向后兼容时才设置 `AGENTDECK_ROLLBACK_SAFE_VERSION=X.Y.Z`（仅授权该版本的程序回退）；默认失败只恢复静态资源、保留数据库和诊断，不擅自回退云端程序。配置与真实候选验收完成前不能上线本次自动化。

正式 Web：[agent.ptsfdtz.top](https://agent.ptsfdtz.top/)，管理端 [/admin](https://agent.ptsfdtz.top/admin)。生产使用现有 Nginx、Rust/systemd 和 PostgreSQL 17，Cloudflare 仅做 DNS。云端账户 schema v3 支持电脑证书/地址登记、会话绑定的短期凭据、撤销和刷新轮换；VPS 继续只转发加密业务字节。

`pnpm host:package` 在当前平台构建发布包，输出到 `artifacts/host-downloads/`：

```text
install.sh / install.ps1 / install-codex.ps1
releases/stable.txt
releases/版本号/agentdeck-windows-x64.zip[.sha256]
releases/版本号/agentdeck-linux-x64.tar.gz[.sha256]
releases/版本号/agentdeck-linux-arm64.tar.gz[.sha256]
releases/版本号/agentdeck-macos-arm64.tar.gz[.sha256]
```

使用 `AGENTDECK_RELEASE_VERSION` 指定不可变发布目录。CI 构建 Windows x64、Linux x64/ARM64 和 macOS arm64；单独运行打包命令仅生成 Host 包，不满足正式发布准入。完整候选版须包含 Web、云端、安装脚本、版本清单及实测证据；正式流程输出的 `agentdeck-downloads.tar.gz` 包含这些文件，供已通过门槛的部署使用。Linux ARM64 基于 Ubuntu 24.04，x64 基于 Ubuntu 22.04，macOS arm64 使用 GitHub macOS 15 runner；macOS 包未签名/公证。旧独立 Linux workflow 和桌面安装器发布路径已移除。

Web 构建自动生成 `version.json`，与资源一同部署并保持该清单不缓存。

在服务器执行 `sh scripts/host/publish-downloads.sh 上传目录 /opt/agentdeck/downloads`，先核对包校验值、发布不可变版本文件，最后原子更新 `stable.txt`；旧版本保留。将 `server/deploy/downloads.nginx.conf` 的规则 include 到现有 HTTPS server block，同一 server block 中另 include `server/deploy/web-updates.nginx.conf` 并沿用 Web 根目录，确保版本清单 no-store、PWA worker/安装清单重新验证；执行 `nginx -t` 后 reload。下载规则不替换现有 `/api/`、`/admin`、Web 或隧道转发；单个平台尚未发布时返回 404，不退回 HTML 页面冒充程序。

生产云端程序仍由 `/opt/agentdeck/current/agentdeck-cloud` 提供，服务配置 `/etc/agentdeck/cloud.env`。运维：`ssh yecaoyun 'systemctl status agentdeck-cloud --no-pager'`；日志 `journalctl -u agentdeck-cloud -n 50 --no-pager`。`agentdeck-backup.timer` 每日 UTC 03:20 起随机延迟最多十分钟执行；可手动启动 `agentdeck-backup.service`。备份位于 `/var/backups/agentdeck/`，需要另做异机备份；云端备份不包含各 Host 的 Codex、项目和本机证书。Docker/Caddy 备用部署见 `server/deploy/`，当前生产未使用该路径。
