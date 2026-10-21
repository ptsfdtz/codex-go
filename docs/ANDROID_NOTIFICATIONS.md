# 安卓任务通知与导航

当前实现为应用进程与 Bridge 在线时的系统通知，不是推送或常驻后台服务。重连及在线事件缺口重放可有条件补发 Bridge 任务与有效审批；原生任务补发通过 latestUpstreamTurn 能力门控调用 turn.latest 核验最新原生轮次。安卓被系统终止时不能接收通知。完整后台恢复仍是迁移待办。

## 目标身份

`DeckNotifications.publish` 接受事件来源电脑 ID，不从点击时的当前电脑推断来源。显式 `MainActivity` Intent 只携带电脑/会话标识；data URI 包含独立编码的电脑、会话、事件 ID。URI 同时区分 PendingIntent 与通知 tag，同一 eventId 在不同电脑不会互相覆盖。正文不含任务文本、路径、输出或凭据。

事件没有 sessionId 时不创建任务导航通知。通知动作包含 approval.requested、Bridge turn.completed/failed/interrupted，以及原生 upstream.turn.completed。原生事件根据顶层 status 区分成功/失败/中断，要求非空原生 turn ID；未知/非终态/格式错误不提示成功。审批仅在身份与事件一致、pending 且 expiresAt 晚于当前时间时提示，使用系统 timeoutAfter 到期移除；approval.resolved 即使在前台或通知偏好关闭时仍清理匹配电脑/审批通知。每次应用权威快照会清理该电脑已缺失、sending、已处理或过期审批的通知，保持其他电脑通知。系统 extras 只添加审批与电脑标识。旧版本没有审批标识的通知不能可靠识别清理。旧版本已生成的无目标通知只会打开应用，不自动猜测目标。

## 重放补发边界

每次连接保留一个 NotificationReplay：最多 128 个候选，每个去除输出/审批 context 后的序列化事件最多 4096 字符，超限丢弃，按插入顺序淘汰。只在事件已成功写入本机缓存后观察候选；每会话最多一个 Bridge 终态、每审批一个请求。后续任务开始/原生完成撤销该会话的旧 Bridge 终态，审批已处理撤销候选。

重放完成后先读取权威快照，确认当前 transport/电脑与连接状态，再一次性 drain 并发布。Bridge 终态需同时匹配 session.status 和快照中的具体 turn ID/status；审批需仍在该电脑的 pending 列表、身份匹配且未过期，通知使用最新审批的到期时间。无授权/删除/状态不一致/未知身份均不补发。REPLAY_GAP 清空候选，再恢复快照；首次无缓存连接不广播旧历史。

发布每条候选前再次使用当时最新快照核对电脑、项目/原线程映射及审批/Bridge 终态；这一步位于所有可能挂起的原生读取之后，防止先前 drain 的审批在等待期间已失效仍被补发。审批 payload 使用此时快照有效期，已处理/发送中/到期或新任务运行会撤销旧候选。该检查仍只覆盖已经同步到安卓的快照，不宣称与服务端变化原子同步。

前台、通知关闭或权限未授予仍不显示。已持久化游标及候选 drain 防止通常重连重复提交，但这不是“恰好一次”投递：缓存提交后进程退出/读取快照失败/系统拒绝通知可能漏发；候选不持久化，不重置事件游标来重试通知。超过容量也可能漏发。原生候选仅保留原生 turn ID/status，调用 turn.latest 严格解码合约、Bridge/原线程身份、已知状态；要求 threadStatus=idle 且最新 turn ID/终态与事件完全相同。核验前后检查 transport、hostEpoch、电脑及快照会话/项目授权映射；最多 8 个候选，每次 4 秒，失败/超时/未知/无能力均丢弃，不阻止其余通知。读取后仍可能开始新任务，不能承诺原子实时状态。这里不承诺系统推送、离线期间即时通知或完整通知恢复。

## 点击流程

1. MainActivity 在 onCreate/onNewIntent 处理明确的 OPEN_TASK 请求，消费 action，解析有界非空目标标识；普通启动不触发导航。
2. Repository 等待凭据初始化完成，然后仅在已配对电脑中查找目标。切换电脑复用现有 HostBook/activateBook；保存选中电脑与激活过程不被后续通知取消到一半。最新通知取消上一次导航等待。
3. 连接等待最长 60 秒，等待期间不占用 actionMutex。电脑 epoch 变化则放弃原请求。
4. 已连接后重新读取快照，只允许电脑身份一致、非 stale、最新快照中存在的准确 sessionId。缺失/删除/无授权、移除配对与离线均不会打开另一台电脑的同 ID 会话，也不恢复或创建原线程。
5. 使用既有 selectSession，再发出独立导航标记，让 Codex 聊天面板取代设置、侧栏或独立 API 聊天。查看会话不执行审批或启动轮次。

## JVM 真实 TLS/WSS 回归

ReplayWebSocketTest 使用生产 DeckTransport、PinnedTrust、NotificationReplay、严格解码和 ReplayDelivery，连接 MockWebServer 的真实 TLS WebSocket。临时自签证书含 localhost/127.0.0.1 SAN，固定叶证书指纹和正常主机名校验均启用；合成凭据只在回环测试请求中使用。验证 hello → events.replay → turn.latest → 发布回调，以及源返回另一原线程时不发布，握手带预期认证字段且没有源写操作。

这是 Android 代码在 JVM 上的真实传输 + 控制源内容，不是安卓系统、Room、Repository 连接管理、真实 Codex 源或 NotificationManager 验收。首次开发执行因证书仅含 localhost、实际 URL 为 127.0.0.1 而正确拒绝；补齐测试 SAN 后通过，未关闭主机名校验。运行 testDebugUnitTest 包含这两项测试。

## 验证与接手

`ReplayDeliveryTest` 使用生产异步核验器和虚拟时间，覆盖连接切换、项目/线程映射变化、单项超时/失败、父取消、能力与八次上限；不替代真实 WSS/Room/设备。`NotificationReplayTest` 是 JVM 有界候选、顺序/一次 drain、失效/换电脑/删除/后续任务筛选和最新审批到期时间测试，未执行 Repository 网络或 Room 链路。`TaskNotificationsTest` 是 JVM 原生终态、未知/错误结构、审批身份/状态/时效回归；不执行 NotificationManager 或系统定时移除。`NotificationTargetTest` 是 JVM 身份/旧缓存/缺失会话/输入检查。`NotificationIntentTest` 是设备 instrumentation，检查真实 Intent.filterEquals、PendingIntent 隔离与仅有标识字段；不发送 PendingIntent、不启动任务。编译测试 APK 不代表执行过设备测试。

```powershell
cd android
.\gradlew.bat testDebugUnitTest assembleDebug assembleDebugAndroidTest --max-workers=1
# 等上一步进程结束后再运行 Lint，避免测试 KAPT 与 Lint 并发。
.\gradlew.bat lintDebug --max-workers=1
# 需要已连接的测试设备：
.\gradlew.bat connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.agentdeck.app.NotificationIntentTest --max-workers=1
```

后续设备验收还需覆盖冷启动/热启动、旋转、进程退出、两台电脑相同本地 sessionId、快速连续点击、移除配对、任务删除、网络切换、审批时效、权限撤销，以及从设置/API 面板打开任务。真实通知到真实源会话链路尚未验收；不能据单元测试或 APK 构建声称后台通知迁移完成。
