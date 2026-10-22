<!-- 历史设计与证据快照，非当前版本验收。 -->

# 对话体验改版 · 2026-10-20

目标是“配对后直接聊天”，按 Codex 桌面端的主要操作方式重做 Android 界面。

## 操作

1. 首次在 Windows Bridge 生成二维码，平板扫码、核对配对码、Windows 本机确认。已有配对和缓存通过覆盖安装保留。
2. 打开后恢复上次会话。点“新对话”，在底部选择已授权项目，输入目标并发送；不再经过仪表盘或新任务弹窗。
3. 左侧按项目切换会话；窄屏点左上角打开抽屉。连续模型输出合并成消息，工具步骤点开查看，代码块支持复制。
4. 待审批请求显示在当前对话，核对命令、目录和权限再决定。离线/过期不能操作，审批上下文不做文字遮盖。
5. 执行期间发送按钮变为停止按钮；确认中断后仍等待上游终态。右上角文件图标进入真实 Git 审查，“返回对话”继续聊天。

## 状态与数据

- 仅从 Bridge 的真实事件投影对话。消息按 session/turn/item 分组，完成项替换流式预览，重复 eventId 不重复显示。用户提交与上游 userMessage 回声不重复。
- 命令退出和 turn 完成分开处理，不把发送成功当作任务完成。
- 输入框在离线时仍可编辑。草稿按主机、会话或新对话项目隔离，提交确认后才清空；Activity 重建和横竖屏切换保留，强制停止/清数据后的草稿恢复没有保证。
- 主体为中性浅色/深色。发送收起键盘；用户查看旧消息时保留阅读位置，提供回到最新消息按钮。
- 支持标题、粗体、行内代码和围栏代码块；这是基础 Markdown 展示，不是完整 GFM 渲染器。UI 中的命令和代码只作文本显示。

## 范围

这是 AgentDeck 的对话界面重做，不是官方 Codex 桌面客户端的完整复制。流式和最终消息预览上限为 128,000 字符，超出时明确提示截断；Bridge 保留上限触发时也显示提示。当前只管理由 AgentDeck 创建的线程；支持真实模型/思考强度选择、搜索、置顶、重命名、归档/恢复及删除；支持从左下角上传文件和图片（最多 4 个，总计 512 KB），选择默认、Plan 和 Goal 模式，并回答 Plan 澄清问题；尚未提供完整编辑器或 Git 写操作。Plan 依赖固定版本的实验接口，仍需真机联调。独立 API 模式见 [配置及能力范围](../features/android/CONVERSATIONS_AND_API.md)。连接、TLS、项目授权和上游审批规则沿用既有实现。

## 验证证据

构建和 JVM 记录：artifacts/chat-build.txt；lint：artifacts/chat-lint.txt。
真实正常 Compose 输入框经固定证书 LAN Bridge 发起 Codex 对话，验证实际回复和 completed，并检查草稿重建、旋转及窄屏会话抽屉：artifacts/chat-real-result.json、chat-real-test-report.json。
真机截图：artifacts/chat-real-landscape.png、chat-real-portrait.png。截图使用真实测试任务，非产品默认假数据。
UI fixture 验证与真实任务验收分开记录；原验收中尚未完成的发布项仍适用，见 ACCEPTANCE.md。

最终本轮报告：artifacts/chat-final-verification.json。21 个 JVM 测试、11 个真机测试、APK/测试 APK 构建、lint（0 errors）、TypeScript/ESLint 与格式检查通过。新的内联审批本轮只验证显示和禁用条件；历史真实人工允许/拒绝验收未冒充新布局的人工复测。

运行可选真实 UI 测试（使用已人工配对且连接中的临时授权测试工作区，会创建真实 Codex 会话，不自动审批）：

```powershell
$env:ANDROID_SERIAL='d1420d4'
$env:AGENTDECK_PHYSICAL_LAN='true'
node scripts/android/android-physical-ui.mjs
```
