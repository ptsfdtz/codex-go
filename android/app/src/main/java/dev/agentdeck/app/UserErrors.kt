package dev.agentdeck.app

private data class ErrorCopy(val title: String, val reason: String, val action: String) {
    fun display() = listOfNotNull(title, "原因：$reason", action.takeIf(String::isNotBlank)?.let { "建议：$it" }).joinToString("\n")
}

internal fun userFacingError(code: String? = null, raw: String? = null): String {
    val message = raw.orEmpty()
    val normalizedCode = (code ?: Regex("\\b([A-Z][A-Z0-9_]{2,})\\s*:").find(message)?.groupValues?.getOrNull(1))
        .orEmpty().uppercase()
    val lower = message.lowercase()
    val copy = when {
        "mxc launcher" in lower || "createprocessinsandbox" in lower -> ErrorCopy(
            "Windows 隔离环境未能启动",
            "Codex 创建任务时，Windows 无法启动 MXC 沙箱子进程。系统返回“找不到路径”（错误码 3）；现有信息无法确定具体缺失的文件或目录。",
            "重新检测并重试。若再次出现，请修复或更新 AgentDeck 的隔离组件，并检查安全软件是否隔离了相关组件。不要关闭隔离保护。",
        )
        normalizedCode == "UPSTREAM_VERSION_UNSUPPORTED" -> ErrorCopy(
            "Codex CLI 版本不兼容",
            "当前 Codex CLI 的 App Server 协议版本尚未通过 AgentDeck 验证，因此无法安全连接。",
            "安装经验证的 AgentDeck 兼容版，或更新 AgentDeck 以支持当前 CLI。",
        )
        normalizedCode == "CODEX_CLI_NOT_FOUND" -> ErrorCopy(
            "找不到 Codex CLI",
            "Windows 上没有找到可用的 Codex CLI。",
            "在 Windows 安装 AgentDeck 兼容版，然后重新检测。",
        )
        normalizedCode == "UPSTREAM_PROTOCOL_ERROR" -> ErrorCopy(
            "Codex 协议响应不兼容",
            "Codex 返回的数据结构与 AgentDeck 支持的协议不匹配。",
            "更新 AgentDeck 或安装经验证的兼容版后重新检测。",
        )
        normalizedCode in setOf("SANDBOX_UNAVAILABLE", "SANDBOX_UNVERIFIED") -> ErrorCopy(
            "Windows 隔离环境检查未通过",
            "AgentDeck 无法确认工作区访问边界，因此不会启动任务。",
            "检查并修复 Windows 隔离组件后重新检测。不要关闭隔离保护。",
        )
        normalizedCode == "UNSAFE_UPSTREAM_CONFIG" -> ErrorCopy(
            "Codex 安全配置不兼容",
            "当前 Codex 安全配置与 AgentDeck 的隔离要求冲突。",
            "检查 Codex 文件访问、网络和扩展配置，移除冲突项后重新检测。",
        )
        normalizedCode == "SERVICE_DISCONNECTED" -> ErrorCopy(
            "Windows 本机服务已断开",
            "设备与 AgentDeck 的连接中断，正在进行的任务结果需要重新核对。",
            "重新连接电脑；重试任务前先确认 Codex 中的实际状态。",
        )
        normalizedCode == "PAIRING_REJECTED" -> ErrorCopy(
            "电脑拒绝了配对请求",
            "Windows 上的配对请求未获批准。",
            "核对两台设备显示的配对码，并在 Windows 管理窗确认。",
        )
        normalizedCode == "APPROVAL_STALE" -> ErrorCopy(
            "审批请求已失效",
            "该操作已完成、取消或超时，不能再使用旧请求。",
            "刷新会话并等待新的审批请求。",
        )
        normalizedCode == "WORKSPACE_FORBIDDEN" -> ErrorCopy(
            "项目访问未获授权",
            "当前项目不在 Windows 已授权的工作区内。",
            "在 Windows 管理窗授权该项目后重试。",
        )
        Regex("工作区路径.{0,20}(失效|不存在|找不到)|(?:工作区|项目).{0,20}(未授权|已失效|不存在)|(?:工作区|项目|路径).{0,20}重新授权")
            .containsMatchIn(message) -> ErrorCopy(
            "项目访问未授权",
            "AgentDeck 无法访问当前工作区，路径可能已移动、删除或撤销授权。",
            "在 Windows 管理窗重新同步工作区；若路径已变化，请重新选择并授权正确的项目目录。",
        )
        normalizedCode == "THREAD_IN_USE" || "already has an active writer" in lower -> ErrorCopy(
            "会话正在其他客户端使用",
            "电脑端 Codex 持有此会话的写入锁，当前无法安全恢复。",
            "等待电脑端任务完成后重试，或使用新对话。",
        )
        normalizedCode == "CONFLICT" -> ErrorCopy(
            "状态已发生变化",
            "电脑上的会话或审批状态已更新。",
            "刷新后确认最新状态，再重新操作。",
        )
        normalizedCode == "API_REQUEST" && ("http 401" in lower || "http 403" in lower) -> ErrorCopy(
            "API 鉴权失败",
            "服务商未接受当前 API 密钥或账户权限。",
            "检查 API 地址、密钥和账户权限后重试。",
        )
        normalizedCode == "API_REQUEST" && "http 429" in lower -> ErrorCopy(
            "API 请求过于频繁",
            "服务商当前限制了请求频率或额度。",
            "稍后重试，并检查服务商的额度与速率限制。",
        )
        normalizedCode == "API_REQUEST" && Regex("http 5[0-9]{2}").containsMatchIn(lower) -> ErrorCopy(
            "API 服务暂不可用",
            "服务商暂时无法完成请求。",
            "检查服务商状态后稍后重试；若回复中断，先确认会话状态。",
        )
        normalizedCode == "API_TLS" || (normalizedCode.startsWith("API") && ("tls" in lower || "ssl" in lower || "certificate" in lower)) -> ErrorCopy(
            "API 安全连接校验失败",
            "服务端证书校验未通过。",
            "检查 API 地址和设备时间，不要忽略证书警告。",
        )
        normalizedCode == "API_NETWORK" || (normalizedCode.startsWith("API") && ("network" in lower || "timeout" in lower || "timed out" in lower || "ioexception" in lower)) -> ErrorCopy(
            "API 网络连接中断",
            "请求超时或连接中断，回复可能未完成。",
            "检查网络后重试；先确认本次回复状态，避免重复提交。",
        )
        normalizedCode.startsWith("API") -> ErrorCopy(
            "API 请求未完成",
            "API 地址、模型配置或服务响应未通过检查。",
            "检查 API 地址、密钥和模型设置后重试。",
        )
        normalizedCode in setOf("TLS", "CERTIFICATE") || "certificate" in lower || "sslhandshake" in lower -> ErrorCopy(
            "安全连接校验失败",
            "连接的证书校验未通过。",
            "在 Windows 核对设备证书并重新配对；不要忽略证书警告。",
        )
        normalizedCode in setOf("TIMEOUT", "NETWORK") || "timeout" in lower || "timed out" in lower || "sockettimeoutexception" in lower -> ErrorCopy(
            "连接暂时不可用",
            "网络中断或等待超时，操作结果可能未知。",
            "检查网络并重新连接；重试任务前先核对会话状态。",
        )
        message == "无效的 Bridge HTTPS 地址" -> ErrorCopy("配对信息无效", "Bridge 地址格式不正确。", "在 Windows 重新生成配对二维码。")
        message == "配对信息格式错误" -> ErrorCopy("配对信息无效", "配对数据未通过格式校验。", "重新扫描 Windows 上新生成的二维码。")
        message.contains("二维码已过期") -> ErrorCopy("配对二维码已过期", "配对请求有时效限制。", "在 Windows 重新生成二维码后扫描。")
        message.contains("API 基础地址必须是 HTTPS") -> ErrorCopy("API 地址无效", "API 地址必须使用 HTTPS，且不能包含凭据或查询参数。", "填写服务商提供的 HTTPS 基础地址。")
        message.contains("/chat/completions") -> ErrorCopy("API 地址格式不正确", "这里需要填写基础地址，不能填写完整的聊天接口路径。", "填写服务商提供的 API 基础地址，通常以 /v1 结尾。")
        message.contains("离线时不能执行操作") || message.contains("Bridge 未连接") || message.contains("Bridge 连接不可用") -> ErrorCopy("电脑当前不可操作", "Android 设备尚未与 Windows Bridge 建立有效连接。", "确认 AgentDeck 正在 Windows 运行，并重新连接设备。")
        message.contains("审批已过期") -> ErrorCopy("审批请求已失效", "该操作已完成、取消或超时。", "刷新会话并等待新的审批请求。")
        message.contains("配对已过期") || message.contains("二维码已过期") -> ErrorCopy("配对二维码已过期", "配对请求有时效限制。", "在 Windows 重新生成二维码后扫描。")
        message.contains("没有活动回合") -> ErrorCopy("没有可中断的任务", "当前会话中没有正在运行的回合。", "刷新会话状态后再试。")
        message.contains("模型列表暂不可用") -> ErrorCopy("模型列表暂不可用", "电脑端没有返回可用模型。", "重新连接 Windows Bridge，或稍后重新加载模型。")
        message == "请配置有效的 API 密钥" || message == "请填写 API 密钥" -> ErrorCopy("缺少 API 密钥", "尚未配置可用的 API 密钥。", "在 API 设置中填写密钥后重试。")
        message == "请填写或选择 API 模型" || message == "请先配置 API 地址、密钥和模型" -> ErrorCopy("API 配置不完整", "发送请求前还需要有效的 API 地址、密钥和模型。", "完成 API 设置后重试。")
        message == "API 地址必须是 HTTPS" -> ErrorCopy("API 地址无效", "API 连接必须使用 HTTPS。", "检查服务商提供的 API 地址。")
        message == "通知权限未授予，前台任务与审批仍可使用" -> ErrorCopy("通知权限未授予", "系统通知未启用，应用前台功能仍可使用。", "可在 Android 系统设置中允许通知。")
        message == "诊断已导出" -> ErrorCopy("诊断已导出", "诊断文件已保存。", "")
        message == "无法导出诊断，请重新选择保存位置" -> ErrorCopy("诊断导出失败", "Android 未能写入所选位置。", "重新选择一个可写入的保存位置。")
        else -> ErrorCopy(
            "操作未完成",
            "AgentDeck 遇到未分类的错误，原始诊断信息已隐藏。",
            "检查连接和运行环境后重试；若涉及任务提交，请先核对会话状态。",
        )
    }
    return copy.display()
}
