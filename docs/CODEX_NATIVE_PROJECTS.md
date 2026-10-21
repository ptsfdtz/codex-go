# 原生项目读取适配

阶段 0 / P02 的 Rust 底座增量。不是桌面侧栏、安卓项目功能或完整共享运行时验收。

## 已实现

`desktop/core/src/native_projects.rs` 的 `Rpc::project_page(cursor, limit)` 在精确 DesktopBaseline 0.163.0-alpha.10.2 上读取权威 project/list。保留原生 ID、名称、全部 roots、metadata、position、时间与游标，不创建 Bridge 项目、不复制业务数据库、不改变目录授权，也不调用桌面宿主服务。Managed 0.159.2 明确返回版本不支持。

分页限制为 1..100 条，非空游标最多 4096 字节。源响应必须通过安装版实验 schema；返回条数不得超过请求，ID 不得为空、超过 160 字节或在本页重复，nextCursor 不得为空、超长或重复当前游标。单页最多 384 KiB，超限明确失败，不截断。单页检查不等于多页一致性快照或全部历史去重；未来遍历器仍需检查跨页重复、总页数、总时间和外部修改。

RPC 只为 DesktopBaseline 的 project/list 加入独立参数合约，其他请求仍校验原 ClientRequest。未开放 project/create/update/delete 等实验写操作；没有安卓 action、能力标记或自动索引导入。

## Core 授权投影

`Core::native_project_page` 是尚未开放远程 action 的内部读取接口。只返回全部 roots 都精确匹配有效 Bridge 本机目录授权的项目；父目录授权不自动包含子目录，部分授权、无根目录、相对路径及未授权项目整体隐藏。原生项目完整内容保存在 `project`，`rootGrants` 按 rootIndex 映射 Bridge projectId，两种身份不混用。不会新增授权、会话或业务副本。

读取前后复核授权快照、目录身份与运行时连接代次。撤销或授权变化返回 SYNC_CONFLICT，目录替换按现有 WORKSPACE_FORBIDDEN 拒绝，运行时替换返回 UPSTREAM_UNAVAILABLE；失败不返回部分页面。无授权时不查询上游。过滤后的空页仍保留源 nextCursor；游标目前仅供内部使用，不能直接作为设备分页协议。

五项控制源回归使用真实临时目录与 Bridge Store，覆盖多根目录、撤销/重新授权、连接替换及同路径目录替换；测试证书为占位，不构成 TLS 验收。真实安装版隔离检查另验证两个授权项目保留原 ID，一个混合未授权根目录的项目被整体隐藏，且未自动创建本机授权或会话。

## 设备分页预备接口

`Core::native_project_device_page(device, cursor, limit)` 已实现内部短期只读视图，尚无远程 action 或安卓入口。设备必须仍有效；初次读取有 30 秒上限，最多扫描 32 个源页、累计源内容 2 MiB，检测跨页重复原生 ID 与游标循环，失败不返回部分结果。输出页最多 100 条/384 KiB，单项目过大明确失败，不截断。

源游标不返回设备；随机 256-bit token 只在内存中关联设备、固定页大小、授权快照及连接代次。后续页重试返回相同内容，设备撤销、授权/目录身份变化、连接切换、未知游标均拒绝。视图 120 秒过期，每设备一个、全局最多八个，构建并发为一个；服务重启后必须重新读取。过期边界以显式 Instant 验证（120 秒前一纳秒/等于/之后），并验证实际续页移除过期缓存且不查询源；容量回归覆盖八设备占满、同设备替换、撤销回收与第九设备拒绝。

响应标注 `consistency: bounded-read-view` 和 `viewId`。这不是上游原子快照：跨页外部修改可能不产生重复 ID，不能据此声称完整一致；RPC 读取层现在在入队前观察 project/changed，推进本连接版本；构建及续页核验该版本，收到变更后返回 SYNC_CONFLICT。即使载荷不合法也只触发重新读取，不应用载荷或更改授权。直接检查 RPC alive 可在 Core 尚未处理 lost 时拒绝旧页；重连连接代次不同也拒绝旧页。接入远程前仍需未送达通知/重连缺口的完整恢复策略、版本化错误/能力约定和安卓刷新策略。不要直接将此接口加入 WSS。

新增三项控制源回归验证分页重试/不泄露源游标/跨设备与页大小拒绝、跨页重复/游标循环、构建中撤销/并发拒绝。真实安装版检查验证两个授权原生项目的设备分页与重试，仍不是已配对安卓或 GUI 验收。

## 合约来源

执行以下命令从精确安装版导出，不手改 schema：

```powershell
node scripts/pin-desktop-protocol.mjs <codex.exe绝对路径> --projects
```

命令只捕获实验 ProjectListParams/ProjectListResponse，保存至版本目录 experimental/，并生成 projects-lock.json；已有锁或文件时拒绝覆盖。Rust build.rs 校验精确版本、文件集合、路径与 SHA-256，生成仅 DesktopBaseline 可用的两个 schema 入口。原稳定 schema lock、composer lock 和固定 Managed 合约保持独立。重新核验时导出到隔离目录比较哈希，不删除已审核的锁来绕过差异。

## 验证

```powershell
cargo test --locked --manifest-path desktop/core/Cargo.toml --test native_projects --test native_project_grants
$env:AGENTDECK_DESKTOP_PROBE_EXE = '<精确0.163.0-alpha.10.2的codex.exe绝对路径>'
cargo test --locked --manifest-path desktop/core/Cargo.toml --test runtime_websocket real_desktop_baseline_ -- --ignored --nocapture
```

三项 fixture 回归覆盖完整两页/空页、错误字段、缺失 roots、重复 ID、超条数、重复/空/超长游标、超大页和发送前参数/版本拒绝；还断言其他项目写方法没有获得透传资格。Fixture 不证明原生运行时或权限。

真实无模型元数据检查在隔离 HOME 中通过独立原生协议连接创建两个项目，由 Rust 客户端以 limit=1 读取全部原 ID/roots/metadata，再由原生连接改名、另一 Rust 客户端读取更新。测试中的原生写入只用于准备隔离数据，没有成为生产 Rust API。已有真实历史/追加/中断检查继续通过，模型仍仅为隔离回环合成服务，不使用账户。

## 接入前的必要工作

低层 Rpc 页面不可直接暴露；Core 已实现全部 roots 的本机授权投影，远程入口仍需设备绑定的分页上下文、跨页一致性、授权失效恢复与版本化协议。原生 ID 与 Bridge grants 的映射不代表桌面 legacy ID 映射，后者仍需核验。

原版 GUI 主动排除 project/changed；本机项目缓存和界面发布仍需受支持的宿主适配，详见 CODEX_DESKTOP_GUI_PROBE.md。该读取接口没有解决首次设置、导航、侧栏刷新或双向桌面项目写入，sharedDesktopRuntime 继续为 false。

## 变更失效验证

两项新增控制源测试覆盖构建期间通知、已缓存续页通知、无关通知不失效，以及 RPC 断开而 Core 尚未处理 lost 时的拒绝。真实安装版测试由独立原生连接修改项目，等待 Rust 连接收到变更后确认旧游标返回 SYNC_CONFLICT；重新读取返回同一原生 ID 的新名称。通知在接收层记录，不依赖业务事件消费者已经处理。

该机制只能拒绝已经被连接观察到的变更，不保证源写入与读取的线性一致性，不能发现尚未送达/静默丢失的通知，也没有持久事件续传。完整同步、GUI 项目缓存发布与安卓真机仍未验收。

## 缓存回收与重连恢复

初次读取在源查询前清理过期、已撤销设备、旧连接代次、旧项目通知版本和不匹配授权快照的视图，再检查八设备容量；完成读取后再次清理/检查。重新开始当前设备列表会立即替换旧视图（即使新读取失败，也需重新开始），不为旧结果延长生命周期。

控制源重连测试先返回两页，再断开旧连接，在新连接返回同一原生 ID 的新名称；旧游标在连接替换后拒绝，重新读取得到新内容且不创建授权/会话。该测试不依赖断线期间通知，但不是实际安装版 supervisor/桌面/安卓的重连验收。真实安装版既有三项隔离检查继续通过。静默漏通知且连接不断的恢复、持久事件续传及 UI 刷新仍未完成。
