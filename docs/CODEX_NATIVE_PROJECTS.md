# 原生项目读取适配

阶段 0 / P02 的 Rust 底座增量。不是桌面侧栏、安卓项目功能或完整共享运行时验收。

## 已实现

`desktop/core/src/native_projects.rs` 的 `Rpc::project_page(cursor, limit)` 在精确 DesktopBaseline 0.163.0-alpha.10.2 上读取权威 project/list。保留原生 ID、名称、全部 roots、metadata、position、时间与游标，不创建 Bridge 项目、不复制业务数据库、不改变目录授权，也不调用桌面宿主服务。Managed 0.159.2 明确返回版本不支持。

分页限制为 1..100 条，非空游标最多 4096 字节。源响应必须通过安装版实验 schema；返回条数不得超过请求，ID 不得为空、超过 160 字节或在本页重复，nextCursor 不得为空、超长或重复当前游标。单页最多 384 KiB，超限明确失败，不截断。单页检查不等于多页一致性快照或全部历史去重；未来遍历器仍需检查跨页重复、总页数、总时间和外部修改。

RPC 只为 DesktopBaseline 的 project/list 加入独立参数合约，其他请求仍校验原 ClientRequest。未开放 project/create/update/delete 等实验写操作；没有安卓 action、能力标记或自动索引导入。

## 合约来源

执行以下命令从精确安装版导出，不手改 schema：

```powershell
node scripts/pin-desktop-protocol.mjs <codex.exe绝对路径> --projects
```

命令只捕获实验 ProjectListParams/ProjectListResponse，保存至版本目录 experimental/，并生成 projects-lock.json；已有锁或文件时拒绝覆盖。Rust build.rs 校验精确版本、文件集合、路径与 SHA-256，生成仅 DesktopBaseline 可用的两个 schema 入口。原稳定 schema lock、composer lock 和固定 Managed 合约保持独立。重新核验时导出到隔离目录比较哈希，不删除已审核的锁来绕过差异。

## 验证

```powershell
cargo test --locked --manifest-path desktop/core/Cargo.toml --test native_projects
$env:AGENTDECK_DESKTOP_PROBE_EXE = '<精确0.163.0-alpha.10.2的codex.exe绝对路径>'
cargo test --locked --manifest-path desktop/core/Cargo.toml --test runtime_websocket real_desktop_baseline_ -- --ignored --nocapture
```

三项 fixture 回归覆盖完整两页/空页、错误字段、缺失 roots、重复 ID、超条数、重复/空/超长游标、超大页和发送前参数/版本拒绝；还断言其他项目写方法没有获得透传资格。Fixture 不证明原生运行时或权限。

真实无模型元数据检查在隔离 HOME 中通过独立原生协议连接创建两个项目，由 Rust 客户端以 limit=1 读取全部原 ID/roots/metadata，再由原生连接改名、另一 Rust 客户端读取更新。测试中的原生写入只用于准备隔离数据，没有成为生产 Rust API。已有真实历史/追加/中断检查继续通过，模型仍仅为隔离回环合成服务，不使用账户。

## 接入前的必要工作

这是电脑内部低层接口，返回该运行时的项目，并不是远程授权边界。未来 Core/安卓入口必须根据既有本机 grants 验证项目的全部 roots；不能只按第一个 root 或会话 cwd 匹配，也不能把未知 roots 自动加入授权。未经授权的名称、路径和 metadata 不能泄露到远程页面。需要单独设计版本化原生 ID 映射、分页上下文和外部事件恢复，不能把原生 ID 当桌面 legacy ID。

原版 GUI 主动排除 project/changed；本机项目缓存和界面发布仍需受支持的宿主适配，详见 CODEX_DESKTOP_GUI_PROBE.md。该读取接口没有解决首次设置、导航、侧栏刷新或双向桌面项目写入，sharedDesktopRuntime 继续为 false。
