package dev.agentdeck.app

internal data class SettingsDestination(val id:String,val section:String,val title:String,val detail:String,val keywords:String="",val index:Int=1)
internal val settingsDestinations=listOf(
    SettingsDestination("updates","general","应用更新","检查、下载并安装新版 AgentDeck","升级 版本 APK",1),
    SettingsDestination("appearance","general","外观与通知","主题、任务与审批通知","浅色 深色 跟随系统 提醒",2),
    SettingsDestination("archived","conversations","归档会话","查看、打开与恢复已归档会话","历史 恢复"),
    SettingsDestination("shortcuts","shortcuts","键盘快捷键","查看当前已接通的快捷键","Ctrl Enter Escape Shift 搜索"),
    SettingsDestination("computers","computers","电脑与连接","账户登录、配对、重命名及连接方式","云端 公网 局域网 服务器 密码 证书 指纹 设备 同步 重连 移除"),
    SettingsDestination("retention","data","Bridge 日志保留","设置事件保留天数和容量","数据 清理 容量 天数 缓存"),
    SettingsDestination("diagnostics","data","诊断导出","读取并导出结构化诊断","版本 连接 JSON 数据",2)
)
internal fun matchingSettings(query:String)=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}.let{terms->settingsDestinations.filter{entry->terms.all{("${entry.title} ${entry.detail} ${entry.keywords}").contains(it,true)}}}
