# 仓库结构与维护

根目录按项目划分，项目内部按功能划分。android/、desktop/、packages/ 保留现有构建入口；配置、锁文件和标准工具入口留在所属项目根目录，构建产物继续写到忽略的 artifacts/、build/、target/。

```text
android/app/src/
  main/java/dev/agentdeck/app/
    shell/                         应用入口、导航、命令菜单
    core/{data,network,security}/   状态/缓存、连接/协议、加密/遮罩
    features/
      computers/                   配对、扫码、多电脑
      conversation/                会话页面、菜单、目标、状态、模型
        composer/                  草稿、附件、展开编辑器
        history/                   历史投影、分页、搜索与修订
        messages/                  Markdown、工具、引用、图片、阅读器
        approvals/                 审批与原生问题表单
        queue/                     原生待发送队列
      projects/                    原生项目、文件浏览与预览
      review/                      只读 Git Diff
      settings/                    外观、账户、配置及设置搜索
      skills/                      技能目录、选择与设置
      notifications/               通知身份、终态与补发核验
      api/                         独立 API 客户端、存储、界面
  test/java/dev/agentdeck/app/      JVM 测试沿对应功能目录
  androidTest/java/dev/agentdeck/app/
    features/                      UI/设备组件测试
    acceptance/                    显式启用的 Physical* 验收
desktop/
  src/{app,bridge}/                React 页面/样式/测试、本机接口
  src-tauri/                      窗口、托盘、监督与安装配置
  core/src/
    execution/                    会话、任务、历史、队列、审批、索引
    upstream/                     Codex 生命周期、RPC、桌面传输适配
    projects/                     路径授权、项目视图、文件与 Git
    settings/                     账户、执行配置与技能
    server/                       服务、WSS、配对、对外协议与能力
    storage/                      SQLite 与 schema.sql
    authorization/                本机安全原语
    bin/                          独立代理可执行入口
  core/tests/                     Cargo 集成测试入口与 fixtures/
  e2e/                            桌面浏览器交互测试
packages/codex-protocol/           锁定上游导出与版本 overlay
scripts/                          按工具用途分类，见 scripts/README.md
docs/
  design/protocol/                合约按会话/项目/资源/队列/设置划分
  features/{android,desktop}/     用户功能说明
  development/                   环境、构建与目录规则
  migration/integration/          当前迁移主线与接入技术资料
  history/migration/              分日证据与历史接手快照
  baselines/                     版本化原始证据
```

## 兼容边界

Android 本轮按文件夹归类，Kotlin 声明仍为 dev.agentdeck.app。现有文件间 internal 引用、Manifest 组件名、Room 导出路径、序列化/测试身份保持原样；Gradle 会递归发现源文件。不要仅为匹配目录批量改应用包名或 Room 类型。

Rust 每个功能目录用 mod.rs 声明模块，lib.rs 保留既有公开模块再导出，外部仍可使用 agentdeck_service::rpc、service 等入口。内部按需引用，不为未使用模块添加兼容别名；schema.sql 与 store.rs 相邻，RPC websocket 子模块随 rpc 迁移。

Cargo 的 src/main.rs、src/bin/ 与 tests/\*.rs、AndroidManifest.xml、Gradle/Room schema、Tauri 配置及前端 main.tsx 是标准入口，保留原位置。生成的上游 schema、锁文件、基准 JSON 和本机忽略配置不作为普通源码重排。

## 添加与查找

- 同一功能的 UI、辅助逻辑和测试放到对应目录；跨功能状态/传输留 core，共用呈现保持单一来源。
- Rust 对外公开模块更名、Android 包/数据身份和线协议调整，需要单独检查兼容性，不能隐含在目录整理中。
- 脚本从仓库根目录执行；移动时同步相对 import、PowerShell/CMD 根目录计算、Rust include、package.json、CI 和文档引用。
- 用户入口见根 README；文档导航见 docs/README.md。开发记录只在当前 STATUS 汇总，较长证据按日期归档，不复制到 HANDOFF。
