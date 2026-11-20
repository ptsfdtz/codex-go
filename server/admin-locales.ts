import { translations, type Locale, type TranslationKey } from '../web/src/i18n/config.ts';

export function adminCatalog(locale: Locale): Record<string, string> {
  // Cached admin clients can still request the old source-text keys. Keep their
  // identities stable when translators change the wording in the feature modules.
  const legacyKeys = {
    'push.approvals': '后台审批和提问提醒',
    'push.taskResults': '同时提醒任务完成、失败或停止',
    'push.settingsUnavailable': '无法核对后台提醒设置，请重试。',
    'push.subscriptionFailed': '无法更新此设备的推送订阅，请重试。',
    'push.unsupported': '此浏览器未提供后台推送。iPhone 可将网页添加到主屏幕后再开启。',
    'push.unavailable': '当前云端或此浏览器尚未启用后台推送。',
    'push.hostUpdate': '当前电脑需更新 Host 才能发送后台提醒。',
    'account.retryWhenOnline': '暂时无法检查登录状态，网络恢复后会自动重试。',
    'drafts.keepOnDevice': '在此设备保留主对话文字草稿 7 天',
    'drafts.saveFailed': '无法在此设备保存草稿。当前页面中的文字已保留。',
    'hostSetup.title': '连接开发电脑',
    'hostSetup.online': '电脑已上线',
    'hostSetup.startHost': '电脑离线，请在电脑上启动 Host',
    'hostSetup.awaitSignIn': '等待电脑登录同一账户',
    'hostSetup.codexReady': 'Codex 已就绪',
    'hostSetup.codexNotReady': 'Codex 尚未就绪，请在电脑运行 agentdeck status --json 检查原因',
    'hostSetup.connectFirst': '连接 Host 后检查 Codex 状态',
    'hostSetup.projectsAvailable': '项目可用（{{count}} 个）',
    'hostSetup.authorizeProject': '在电脑上授权要使用的项目目录',
    'hostSetup.install': '在电脑上安装与配置',
    'hostSetup.platform': '电脑操作系统',
    'hostSetup.terminalInstructions':
      '在开发电脑打开终端，进入项目目录。安装后用手机登录的 AgentDeck 用户名替换 NAME。',
    'hostSetup.codexSignIn':
      '如果状态提示 Codex 需要认证，在电脑上运行 agentdeck codex-login，完成后在手机重新连接。',
    'historySearch.cursorStalled': '搜索游标未前进，请重试',
    'historySearch.continue': '继续搜索消息',
    'historySearch.search': '搜索消息正文',
    'historySearch.queryTooLong': '正文搜索最多支持 128 个字符。',
    'historySearch.cancel': '取消搜索',
    'historySearch.searching': '正在搜索电脑上的消息…',
    'historySearch.complete': '搜索已结束',
    'historySearch.noMatches': '没有匹配的消息',
    'historySearch.partial': '已搜索部分历史',
    'historySearch.skippedSessions': '部分会话暂时无法读取（{{count}}）',
    'inbox.reviewQuestion': '打开核对追问状态',
    'inbox.empty': '暂无待处理事项',
    'inbox.refresh': '刷新待办',
    'inbox.noHosts': '尚未绑定电脑。请先在电脑端登录同一账户。',
    'inbox.offline': '电脑离线，待办状态未知',
    'inbox.unavailable': '暂时无法读取待办',
  } as const satisfies Partial<Record<TranslationKey, string>>;
  const catalog: Record<string, string> = { ...translations[locale] };
  for (const key of Object.keys(legacyKeys) as (keyof typeof legacyKeys)[]) {
    catalog[legacyKeys[key]] = translations[locale][key];
  }
  return catalog;
}
