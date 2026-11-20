// Keep source strings sorted for the CLI's binary search.
pub(super) const MESSAGES: &[(&str, &str)] = &[
    ("--username is required", "必须提供 --username"),
    (
        r"AgentDeck Host {}

  --lang system | zh-CN | en (any command)

  agentdeck login [--origin https://agent.ptsfdtz.top] --username NAME
  agentdeck start | stop | restart | status [--json]
  agentdeck serve [--runtime-ws URL --runtime-token-file PATH --protocol VERSION] [--sandbox-verified]
  agentdeck configure [--runtime-ws URL --runtime-token-file PATH --protocol VERSION] [--codex-exe PATH|auto] [--sandbox-verified]
  agentdeck update [--check] [--origin HTTPS_ORIGIN]
  agentdeck update-channel stable | candidate X.Y.Z
  agentdeck autostart enable | disable | status
  agentdeck projects list | add PATH | remove PROJECT_ID | sync
  agentdeck devices list | revoke DEVICE_ID
  agentdeck approvals list | approve ID | reject ID | cancel ID
  agentdeck password | logout [--unbind]
  agentdeck codex-login [--device-auth]
  agentdeck codex [THREAD_ID]
  agentdeck desktop [ABSOLUTE_DESKTOP_EXE] [THREAD_ID]
  agentdeck runtime-check [--codex-exe PATH]
  agentdeck runtime-start | runtime-serve
  agentdeck logs [--follow] | doctor

Codex authentication is separate from the AgentDeck account.
",
        r"AgentDeck Host {}

  --lang system | zh-CN | en （适用于所有命令）

  agentdeck login [--origin https://agent.ptsfdtz.top] --username NAME
  agentdeck start | stop | restart | status [--json]
  agentdeck serve [--runtime-ws URL --runtime-token-file PATH --protocol VERSION] [--sandbox-verified]
  agentdeck configure [--runtime-ws URL --runtime-token-file PATH --protocol VERSION] [--codex-exe PATH|auto] [--sandbox-verified]
  agentdeck update [--check] [--origin HTTPS_ORIGIN]
  agentdeck update-channel stable | candidate X.Y.Z
  agentdeck autostart enable | disable | status
  agentdeck projects list | add PATH | remove PROJECT_ID | sync
  agentdeck devices list | revoke DEVICE_ID
  agentdeck approvals list | approve ID | reject ID | cancel ID
  agentdeck password | logout [--unbind]
  agentdeck codex-login [--device-auth]
  agentdeck codex [THREAD_ID]
  agentdeck desktop [ABSOLUTE_DESKTOP_EXE] [THREAD_ID]
  agentdeck runtime-check [--codex-exe PATH]
  agentdeck runtime-start | runtime-serve
  agentdeck logs [--follow] | doctor

Codex 认证与 AgentDeck 账户相互独立。
",
    ),
    ("AgentDeck Host {} (core {})", "AgentDeck Host {}（核心 {}）"),
    ("AgentDeck Host {} (development)", "AgentDeck Host {}（开发版）"),
    ("AgentDeck password: ", "AgentDeck 密码："),
    ("Already up to date.", "当前已是最新版本。"),
    ("Approval not found; inspect approvals list", "未找到审批，请检查 approvals list"),
    (
        "Cannot migrate this release format automatically. Use the official installer to upgrade. Local/custom builds are not replaced automatically.",
        "无法自动迁移此发布格式，请使用官方安装器升级。本地或自定义构建不会自动替换。",
    ),
    (
        "Codex not found. Install the supported CLI or use configure --codex-exe PATH.",
        "未找到 Codex，请安装受支持的 CLI 或使用 configure --codex-exe PATH。",
    ),
    (
        "Codex terminal exited unsuccessfully; no independent runtime was started",
        "Codex 终端异常退出；未启动独立运行时",
    ),
    ("Codex: {}", "Codex：{}"),
    ("Confirm new password: ", "确认新密码："),
    ("Current AgentDeck password: ", "当前 AgentDeck 密码："),
    (
        "Host control is unavailable; run agentdeck logs / doctor. An existing GUI may need to be stopped first.",
        "Host 控制接口不可用；请运行 agentdeck logs / doctor。可能需要先停止已有的图形界面。",
    ),
    ("Host settings saved in {}", "Host 设置已保存到 {}"),
    ("Host stopped. Autostart setting retained.", "Host 已停止，自启设置已保留。"),
    (
        r"Host: running
Data: {}
Account: {}
Cloud: {}
Codex: {}
Projects: {}",
        r"Host：运行中
数据目录：{}
账户：{}
云端：{}
Codex：{}
项目数：{}",
    ),
    (
        r"Host: {}
Data: {}",
        r"Host：{}
数据目录：{}",
    ),
    (
        "If startup reports PROXY_CONFIG_MISMATCH, redacted diagnostics are saved to {}",
        "如果启动时提示 PROXY_CONFIG_MISMATCH，脱敏诊断保存在 {}",
    ),
    (
        r"Installed: {}
Target: {version}
Source: {origin}",
        r"已安装：{}
目标版本：{version}
来源：{origin}",
    ),
    ("Missing command argument", "缺少命令参数"),
    ("Native runtime compatibility check failed", "原生运行时兼容性检查失败"),
    ("New AgentDeck password: ", "新 AgentDeck 密码："),
    ("No host log yet.", "暂无 Host 日志。"),
    (
        "Official Codex login did not complete; retry agentdeck codex-login",
        "官方 Codex 登录未完成；请重试 agentdeck codex-login",
    ),
    ("Password changed. Login again with the new password.", "密码已修改，请使用新密码重新登录。"),
    ("Passwords do not match", "两次输入的密码不同"),
    ("Passwords must be entered at the hidden terminal prompt", "请在终端的隐藏输入提示中输入密码"),
    (
        r"Platform: {} / {}
Data: {}
Service: {}",
        r"平台：{} / {}
数据目录：{}
服务：{}",
    ),
    (
        "Requested original Codex desktop startup against the official shared runtime; confirm the desktop opens successfully.",
        "已请求原版 Codex 桌面连接官方共享运行时；请确认桌面已成功打开。",
    ),
    (
        "Run agentdeck update to install; restart explicitly when tasks are idle.",
        "运行 agentdeck update 安装，任务空闲后手动重启。",
    ),
    ("Runtime: {}", "运行时：{}"),
    ("Service failed; inspect logs", "服务启动失败，请查看日志"),
    (
        "Shared native runtime ready. Host and client exits do not stop it.",
        "共享原生运行时已就绪，退出 Host 或客户端不会停止它。",
    ),
    (
        r"Signed in. Credentials and computer identity are saved.
Existing Codex workspaces appear automatically in Web. Add another directory with agentdeck projects add PATH. Enable logon startup with agentdeck autostart enable.",
        r"登录成功，凭据和电脑身份已保存。
已有 Codex 工作区会自动显示在网页中。使用 agentdeck projects add PATH 添加其他目录，使用 agentdeck autostart enable 开启登录自启。",
    ),
    (
        "Stop the host and shared runtime owner before changing persistent runtime configuration",
        "更改持久运行时配置前，请先停止 Host 和共享运行时。",
    ),
    ("The temporary password must be changed.", "请先修改临时密码。"),
    (
        "Unknown command: {command}; use agentdeck help",
        "未知命令：{command}；请使用 agentdeck help",
    ),
    ("Unsupported command", "不支持此命令"),
    (
        "Update channel: {channel}. Refresh the Web update check; running jobs keep their pinned version.",
        "更新通道：{channel}。请刷新网页的更新检查；运行中的任务保持原指定版本。",
    ),
    (
        "Update installed. Running tasks keep their current Host. Run agentdeck restart when idle.",
        "更新已安装。运行中的任务继续使用当前 Host。请在空闲后运行 agentdeck restart。",
    ),
    ("Update job ID required", "需要提供更新任务 ID"),
    ("Use agentdeck codex [THREAD_ID]", "请使用 agentdeck codex [THREAD_ID]"),
    (
        "Use agentdeck codex-login [--device-auth]",
        "请使用 agentdeck codex-login [--device-auth]",
    ),
    (
        "Use agentdeck desktop [ABSOLUTE_DESKTOP_EXE] [THREAD_ID]",
        "请使用 agentdeck desktop [ABSOLUTE_DESKTOP_EXE] [THREAD_ID]",
    ),
    (
        "Use approvals list/approve/reject/cancel",
        "请使用 approvals list/approve/reject/cancel",
    ),
    ("Use devices list/revoke", "请使用 devices list/revoke"),
    ("Use pair create/pending/approve/reject", "请使用 pair create/pending/approve/reject"),
    ("Use projects list/add/remove/sync", "请使用 projects list/add/remove/sync"),
    ("attached (configured)", "已连接（手动配置）"),
    ("disabled", "已禁用"),
    ("enabled", "已启用"),
    (
        "enabled (different executable; run autostart enable to update)",
        "已启用（程序路径不同；运行 autostart enable 更新）",
    ),
    ("managed Codex", "托管 Codex"),
    ("not ready", "未就绪"),
    ("not signed in", "未登录"),
    ("offline", "离线"),
    ("online", "在线"),
    ("ready", "就绪"),
    ("starting or unavailable; inspect logs", "正在启动或不可用；请查看日志"),
    ("stopped", "已停止"),
    ("unknown (legacy/development build)", "未知（旧版或开发版）"),
    ("{name} requires a value", "{name} 需要一个值"),
];
