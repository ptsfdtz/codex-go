# 安卓任务通知与导航

当前实现为应用进程与 Bridge 在线时的系统通知，不是推送或常驻后台服务。断线期间的事件重放不会补发通知，安卓被系统终止时也不能接收通知。完整后台恢复仍是迁移待办。

## 目标身份

`DeckNotifications.publish` 接受事件来源电脑 ID，不从点击时的当前电脑推断来源。显式 `MainActivity` Intent 只携带电脑/会话标识；data URI 包含独立编码的电脑、会话、事件 ID。URI 同时区分 PendingIntent 与通知 tag，同一 eventId 在不同电脑不会互相覆盖。正文不含任务文本、路径、输出或凭据。

事件没有 sessionId 时不创建任务导航通知。现有通知动作仍为 approval.requested 与 Bridge turn.completed/failed/interrupted；原生 upstream.* 动作及审批过期通知清理需另行实现。旧版本已生成的无目标通知只会打开应用，不自动猜测目标。

## 点击流程

1. MainActivity 在 onCreate/onNewIntent 处理明确的 OPEN_TASK 请求，消费 action，解析有界非空目标标识；普通启动不触发导航。
2. Repository 等待凭据初始化完成，然后仅在已配对电脑中查找目标。切换电脑复用现有 HostBook/activateBook；保存选中电脑与激活过程不被后续通知取消到一半。最新通知取消上一次导航等待。
3. 连接等待最长 60 秒，等待期间不占用 actionMutex。电脑 epoch 变化则放弃原请求。
4. 已连接后重新读取快照，只允许电脑身份一致、非 stale、最新快照中存在的准确 sessionId。缺失/删除/无授权、移除配对与离线均不会打开另一台电脑的同 ID 会话，也不恢复或创建原线程。
5. 使用既有 selectSession，再发出独立导航标记，让 Codex 聊天面板取代设置、侧栏或独立 API 聊天。查看会话不执行审批或启动轮次。

## 验证与接手

`NotificationTargetTest` 是 JVM 身份/旧缓存/缺失会话/输入检查。`NotificationIntentTest` 是设备 instrumentation，检查真实 Intent.filterEquals、PendingIntent 隔离与仅有标识字段；不发送 PendingIntent、不启动任务。编译测试 APK 不代表执行过设备测试。

```powershell
cd android
.\gradlew.bat testDebugUnitTest assembleDebug assembleDebugAndroidTest --max-workers=1
# 等上一步进程结束后再运行 Lint，避免测试 KAPT 与 Lint 并发。
.\gradlew.bat lintDebug --max-workers=1
# 需要已连接的测试设备：
.\gradlew.bat connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.agentdeck.app.NotificationIntentTest --max-workers=1
```

后续设备验收还需覆盖冷启动/热启动、旋转、进程退出、两台电脑相同本地 sessionId、快速连续点击、移除配对、任务删除、网络切换、审批时效、权限撤销，以及从设置/API 面板打开任务。真实通知到真实源会话链路尚未验收；不能据单元测试或 APK 构建声称后台通知迁移完成。
