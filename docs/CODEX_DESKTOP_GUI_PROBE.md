# 原版桌面隔离传输探测

阶段 0 开发检查，不是 UI、账户、沙箱、双端任务或安卓验收。不得将通过结果解释为 sharedDesktopRuntime 已完成。

## 运行条件与范围

仅 Windows，使用安装版 ChatGPT.exe、精确 0.163.0-alpha.10.2 原生 codex.exe 和本仓库构建的 agentdeck-codex-proxy.exe。先执行：

```powershell
cargo build --locked --manifest-path desktop/core/Cargo.toml --bin agentdeck-codex-proxy
node scripts/check-desktop-gui-runtime.mjs <ChatGPT.exe绝对路径> <codex.exe绝对路径> <proxy.exe绝对路径> <report.json绝对路径>
```

探测会启动独立原版 GUI，可能显示测试窗口。它校验安装包 bootstrap 的独立 userData 路径设置在单实例锁之前；未知代码布局直接拒绝启动。每次创建全新 CODEX_HOME、Electron userData、Windows profile/AppData 和临时目录，不复制已有数据库、登录或浏览器配置。子进程只继承必要的 Windows 系统变量，设置合成测试环境，不继承账户/API/代理/桌面地址变量。CLI override 会改变 Windows 核心/沙箱启动分支，故此实验不能证明该分支等价。

原生服务使用认证回环 WebSocket，转接程序读取临时相邻 manifest 和独立随机令牌文件。中间观察器校验同一 Bearer，保持 JSON 文本帧，不修改消息语义，仅记录 initialize/config/read 的成功布尔值和 initialized 通知，不持久化参数、完整响应、会话或令牌。原生版本和转接 --version 先行核对；GUI 冷启动最多等待 60 秒。未发送任务或调用模型，未自动批准任何操作。

清理只结束本次 spawn 返回的 PID 树，不按进程名结束当前桌面；关闭探测 socket/服务，移除本次令牌和 manifest。其余全新临时目录保留用于排查，报告不包含该路径或原始日志。不操作生产桌面设置、历史和任务。此探测不适合代替有状态升级测试。

## 证据解释

报告 passed 需要真实原版 GUI 经转接发送 initialize、源服务返回成功、同一 socket 配置读取成功、桌面收到放行后的初始化响应并发出 initialized，以及 GUI 仍在运行。只看到 GUI 进程或端口监听不足以通过。

默认模式报告 visualAcceptance/androidVerified/modelTurnExecuted 保持 false。即使传输通过，仍须验证原版页面、同一任务双端操作、审批、断线恢复、Windows 沙箱/宿主依赖、登录与全部功能矩阵。探测失败先检查观察器、冷启动和具体协议检查点；不能只凭超时宣称不支持。首次开发时观察器曾错误转发二进制帧，修正前的失败不作为原生不兼容证据。

## 2026-10-21 结果

安装版 26.1013.3656.0 的最终报告为 `baselines/codex-0.163.0-alpha.10.2/desktop-gui-runtime-probe.json`，passed=true。bootstrap SHA-256、真实原生版本及初始化/配置/通知各检查点均已保存；退出时两个直接子进程终态均确认，另查 Windows 进程没有本轮临时路径对应的 GUI/原生/转接进程残留。

真实 GUI 返回的 userAgent 包含精确原生版本，但不是先前写死的 `Codex Desktop/` 前缀。转接已按非空 originator + 精确 `/版本 (` 分隔符核验，同时保留原生 schema、认证和版本可执行程序检查。错误版本、相似版本后缀、空 originator 和无分隔符回归均拒绝，且不释放 initialize 响应或转发排队任务。没有改写 GUI 的原 initialize 请求或伪造响应。

下一步是同源会话/活动任务在真实 GUI 与远程客户端间的操作和恢复验证；当前报告没有证明这些行为，sharedDesktopRuntime 继续为 false。

## 扩展：共享索引及外部变更

上述命令末尾加 `--shared-index`，使用独立报告路径（本次为 `baselines/codex-0.163.0-alpha.10.2/desktop-gui-shared-index-probe.json`）。此模式启动回环合成模型，以独立原生客户端创建只读沙箱线程并完成合成轮次，先断言权威 thread/list 确实含该对象，再通过安装版支持的 codex://threads/<id> 参数启动独立 GUI。GUI 初始化后等待打开目标，随后由原生客户端重命名；扩展 passed 额外要求 GUI 的 thread/list 响应包含同一原生 ID，且 GUI 连接收到该 ID/新名称对应的 thread/name/updated。不能以另一个原生客户端读取成功代替 GUI。

未自动批准请求；不使用账户模型，modelTurnExecuted 仅在合成服务实际收到请求时为 true。GUI read/resume 成功另记 desktopOpenedSeededThread；无该证据不称已打开，更不声称内容已渲染。探测不向报告写 threadId、名称、完整消息或参数。退出后仅从本次全新 profile 的日志提取固定代理错误码和“主应用 bootstrap 失败”布尔值，不保存日志原文；读取目录和总字节有界。

最终扩展报告 **passed=false**：合成轮次及源索引成功、前置 GUI 初始化成功，但没有 GUI 索引/打开/重命名通知的成功证据。新发现主连接启动仍追加配置覆盖：起初被普通键名限制拒绝，原生 19 组配置实验证明特殊字符应按字面分段后修复；随后出现 **PROXY_CONFIG_MISMATCH**，独立 GUI 日志确认主应用 bootstrap 失败。前一轮报告只证明前置策略连接，不证明主应用就绪；新报告 mainAppBootstrapVerified=false，保留该区别。

下一步必须核验 GUI 主连接的实际动态覆盖如何与权威运行时/宿主集成保持一致（具体不一致字段尚未采集核验），再继续同源会话和活动任务实验。不能丢弃参数、关闭集成、伪造读到的配置或另起平行线程来获得绿色报告。当前生产桌面和账户保持原样；这只是否定当前隔离配置组合，不是否定所有共享接入路径。

## 显式插件启动配置的共享索引验证

后续诊断收敛为 **PROXY_STARTUP_PLUGINS_MISSING**。安装代码 main-C4DYk222.js 的 `getConfigOverrides` 调用 `yc` 和 `C$e`，分别为 `plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled` 与 `plugins.code-review@openai-bundled.mcp_servers.code-review.enabled` 生成开关。前者依赖 GUI App Tools pipe/插件定义等可用性，后者依赖本地非 WSL 和 Node 解析；不能仅凭这两个键存在认定宿主集成已可用。对应代码文件指纹已在 desktop-ws-environment-audit.json 记录。

在 `--shared-index` 后再加 `--with-desktop-plugin-startup`，用新的独立报告路径运行。该选项仅供本安装基准的隔离实验：校验安装代码含两个已知启动键，向新建原生源服务显式追加这两个 enabled=true 的 -c 参数；GUI 仍独立计算自己的覆盖，转接仍严格核对，不改写或忽略 GUI 参数。不适用于直接部署生产服务，也未实现通用动态参数握手。不同宿主条件使 GUI 选择不同值时仍应失败。

最终 `desktop-gui-shared-index-plugin-startup-probe.json` **passed=true**：合成线程在源索引可见，真实 GUI 自身发起的 thread/list 响应含同一原生线程 ID，GUI 的原生连接上观察到该线程的外部重命名事件；没有代理失败码，测试子进程全部退出，另查没有对应临时路径的进程残留。原来的不带启动配置报告仍为失败，保留作对照，不能用新报告覆盖或删除该证据。

本轮没有观察到 GUI 打开该线程的 read/resume 成功；不声称线程内容渲染或通知后的 UI 名称刷新。`mainAppBootstrapVerified` 和 `desktopPluginStartup.hostIntegrationVerified` 保持 false；通过的是明确的索引/连接事件检查，不是完整主应用、插件工具调用或双向活动任务验收。测试模型只是回环合成服务，另一客户端也只是原生协议探测客户端，不冒充安卓或已配对 Bridge。下一步验证实际打开/内容、双向操作与活动任务，以及 GUI 宿主 pipe/环境对共享服务的真实集成方式。
