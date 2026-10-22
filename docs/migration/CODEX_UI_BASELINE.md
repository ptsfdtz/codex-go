# Codex UI 基准与布局接续

2026-10-22 范围更新：以下保留原桌面基准与既有实现事实；当前目标调整为移动对话客户端，效果参考 [官方移动端观察](../baselines/codex-mobile-2026-10-22.md)，完整范围见 [PLAN](CODEX_PARITY_PLAN.md)。不再把全部桌面页面逐项复刻作为当前交付条件。

2026-10-21。属于阶段 0 基准与阶段 2 布局准备，不是视觉验收结果。

## 版本核验

以下为 2026-10-21 历史核验（非当前版本）：`Get-AppxPackage *Codex*` 当时返回 OpenAI.Codex **26.1013.4894.0**，与既有 GUI 探测的 26.1013.3656.0 不同。`codex --version` 仍为 0.163.0-alpha.10.2，实际路径为 `C:/Users/user/AppData/Local/OpenAI/Codex/bin/896a0166b774037a/codex.exe`；旧接手路径已不存在。不切换协议或覆盖旧报告。

对当前安装包重新执行 audit-desktop-project-host.mjs 与 audit-desktop-onboarding.mjs，报告在 `baselines/codex-msix-26.1013.4894.0/`。host main bundle 哈希与旧证据相同，6 个合成依赖检查通过；onboarding bundle 名称/哈希已变，严格匹配路由函数的 10 个合成状态检查通过。这仅重验两个代码边界，不证明整个新版桌面不变或原版 GUI 可操作。

## 桌面接入决策

| 范围 | 已有证据 | 当前决策与解阻动作 |
| --- | --- | --- |
| 原生线程/活动轮次 | 既有独立认证客户端隔离实验 | 继续复用原身份，不新建副本；尚需真实 GUI 同活动任务操作 |
| GUI 认证与索引 | 旧锁定包隔离 GUI 初始化、原线程列表/读取 | 不升级为完整共享；当前包需单独实际 GUI 回归 |
| 项目宿主缓存与发布 | 当前 host 代码指纹相同；未知缓存项目 rename 静默无操作 | 原生 project/update 不能替代桌面发布；仅有内部 renderer 服务，外部宿主 endpoint 尚未验证，不开放任意 IPC |
| GUI 历史和首次设置 | 旧实验源有完整内容，GUI 未请求完整历史；当前路由合成检查通过 | 需要受支持的独立初始化/导航路径；不写首次完成标志，不复制私有数据库 |
| 视觉/账户/宿主工具 | 缺实际逐页截图与行为证据 | 保持未验收，建立受支持的截图采集路径后逐页比较 |

当前 computer-use 技能 guidance 明确禁止自动化 ChatGPT desktop app，安装版 GUI 入口是 ChatGPT.exe；本轮未通过该工具操作或截图生产桌面，也未使用其他屏幕抓取方式绕过限制。后续须先确认可用于 Codex 独立测试实例的受支持 UI 途径。此为当前工具使用边界，不是产品不支持共享的证据。

## 导航与整体布局实现台账

| 条目 | Android 当前实现 | 缺失证据/下一步 |
| --- | --- | --- |
| 侧栏 | Ui.kt，900dp 起常驻，可收起；手机抽屉；真实授权项目/会话与设置/电脑切换 | 桌面宽度、排序组织、图标、间距逐项对照；原生与宿主项目身份映射 |
| 顶部栏 | 当前会话标题优先，项目名回退；电脑/连接状态、真实审查及新对话入口 | 与实际桌面布局对照，手机拥挤与软键盘验收 |
| 审查工作区 | 剩余内容宽度达到 1000dp 时，会话和 440dp 审查面板并排；否则全宽切换；关闭/返回恢复会话 | 阈值为防挤压的临时实现值，不是桌面测量值；真实截图及旋转验证未执行 |
| 会话状态 | 同一组合位置保留宽屏会话；手机切换审查通过 SaveableStateHolder 保留文字草稿等 saveable 状态 | 非 saveable 附件草稿不在恢复承诺内；需后续提升到宿主/会话作用域，不能称完整输入框完成 |
| 工作台与设置 | 已有只读 Git、设置保持真实功能 | 编辑器/终端/浏览器等未接通，不添加空按钮冒充入口 |

`adb devices` 本轮为空。APK 编译不等于手机/平板布局或点击验收；所有尺寸、截图和行为对照仍待执行。阶段 0 和 sharedDesktopRuntime 保持未通过。


## 2026-10-22 导航及设置增量（未视觉验收）

- 侧栏可逐项目折叠，折叠项显示会话数，搜索自动展开结果并提供无匹配状态。折叠是安卓设备展示状态，不写桌面宿主项目组织。
- 设置可用宽度 720dp 起改成左侧分类导航，窄屏保留全部横向分类；尚缺锁定桌面逐页截图与行为对照，不能称像素一致。
- 会话内增加已加载内容查找，支持触屏和 Ctrl+F、Escape、Enter/Shift+Enter；不是全历史/全项目服务端搜索。手机查找输入与结果导航分两行保留全部操作。

## 2026-10-22 当前安装包静态入口映射（不是锁定版本视觉基准）

当前核验 MSIX **26.1016.6573.0**。ASAR SHA256 为 `6f56542b508eea5b6e4d03e852dcd90afc2578aac7125baa3f25ebe85ebc7e25`；可复现静态清单见 `baselines/codex-msix-26.1016.6573.0/ui-definition-inventory.json`，脚本为 `scripts/codex/inventory-desktop-ui.mjs`。8 个模块、62 条字面消息；每模块保留路径、哈希和消息字节偏移。未执行包内脚本、读取账户配置或私有数据库。

安装包含共享 Codex/ChatGPT 模块，以下均为定义证据。当前包不能替代锁定 0.163.0-alpha.10.2 的功能/协议基准；账户、实验、平台条件和实际开启入口仍待 GUI 核验。

| 静态来源/入口 | Android 实现与明确缺口 |
| --- | --- |
| settings-page：搜索、清除、无结果、导航收起/展开 | 已实现分类关键词搜索与响应式导航；具体设置项定位和视觉对照未实现/未验收 |
| use-visible-settings-sections：profile、agent、personalization | 账户只读摘要、部分外观与执行配置只读页；不宣称与这些候选页面一一等价，配置写入/个性化仍缺失 |
| 同模块顺序候选：mcp-settings、plugins-settings、file-type-handlers、hooks-settings、gateways | 管理界面及其安全操作未完成，不展示空按钮 |
| 同模块顺序候选：local-environments、worktrees、storage、archived-chats、voice | 归档恢复与 Bridge 日志策略已有部分功能；环境/工作树/原生存储及语音仍未完整迁移 |
| settings-host-dropdown：本机/远端宿主与连接状态 | 已配对电脑切换；原桌面宿主身份与组织映射未通过 |
| settings-command-menu-section-items：设置命令、可见性过滤、外部账户跳转 | 设置分类可访问；统一命令菜单、外部账户入口及其条件未实现 |
| keyboard-shortcut-command-order / keyboard-shortcuts-dialog | 新增安卓当前已接通按键说明；桌面完整命令/绑定与自定义未迁移，不将命令 ID 当按键 |
| sidebar-actions | 已有授权项目与会话侧栏、折叠/查找；完整桌面操作、排序和宿主发布未通过 |

候选顺序不是完整可用设置清单；可见性分支还包含 general-settings、notifications、keyboard-shortcuts 等，实际条件需继续核验。导航尺寸仍为实现选择，未完成桌面截图/手机平板视觉验收。阶段 0 共享宿主结论保持原表状态。
