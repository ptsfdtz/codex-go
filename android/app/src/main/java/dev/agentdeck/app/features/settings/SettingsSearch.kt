package dev.agentdeck.app

internal data class SettingsDestination(val id:String,val section:String,val title:String,val detail:String,val keywords:String="",val index:Int=1)
internal val settingsDestinations=listOf(
    SettingsDestination("appearance","general","外观与通知","主题、任务与审批通知","浅色 深色 跟随系统 提醒"),
    SettingsDestination("account","account","账户与用量","读取电脑登录、套餐和额度","登录 窗口 重置 点数 余额"),
    SettingsDestination("model","execution","默认模型与执行配置","电脑模型、推理强度、配置来源与层级","审批 沙箱 权限 网页搜索 上下文"),
    SettingsDestination("skills","skills","技能管理","查找、详情及启用状态","来源 范围 禁用 skills"),
    SettingsDestination("archived","conversations","归档会话","查看、打开与恢复已归档会话","历史 恢复"),
    SettingsDestination("shortcuts","shortcuts","键盘快捷键","查看当前已接通的快捷键","Ctrl Enter Escape Shift 搜索"),
    SettingsDestination("computers","computers","电脑与连接","切换、配对、重命名及连接信息","证书 指纹 设备 同步 重连 移除"),
    SettingsDestination("retention","data","Bridge 日志保留","设置事件保留天数和容量","数据 清理 容量 天数 缓存"),
    SettingsDestination("diagnostics","data","诊断导出","读取并导出结构化诊断","版本 连接 JSON 数据",2)
)
internal fun matchingSettings(query:String)=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}.let{terms->settingsDestinations.filter{entry->terms.all{("${entry.title} ${entry.detail} ${entry.keywords}").contains(it,true)}}}
