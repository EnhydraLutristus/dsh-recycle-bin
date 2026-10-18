# dsh-recycle-bin（回收站）

把工作区里的会话移入回收站，保留 14 天后自动永久删除；也可以随时恢复或立即删除。

## 安装（给其他人）

仓库地址：<https://github.com/EnhydraLutristus/dsh-recycle-bin>

要求：DeepSeek Harness 0.2.x（本插件在 `0.2.1-rc.2` 上开发和验证；用到的是 `sidebar.panellist`、`main`、`sidebar.session.row.hover`、`shell.overlay` 四个槽位和 `webServer` 路由，老版本可能没有这些槽位）。

**方式一：直接按 GitHub 地址安装**（Harness 支持 pnpm 的 `github:` 规格）

在 Harness 里调用 `plugin_manager` 的 `install_bundle`，target 填：

```
github:EnhydraLutristus/dsh-recycle-bin
```

安装完成后条目为 `include:dsh-recycle-bin`，侧边栏底部会出现回收站图标。若没出现，按 `Ctrl+R` 刷新页面；仍未出现就把它禁用再启用一次。

**方式二：先克隆，再从本地目录安装**（想改代码或锁定版本时用）

```bash
git clone https://github.com/EnhydraLutristus/dsh-recycle-bin.git
```

然后 `install_bundle` 的 target 填克隆目录的**绝对路径**（例如 `D:\plugins\dsh-recycle-bin`）。本地安装是链接（`link:`），改完代码禁用/启用一次即可生效。

**更新**

```bash
git pull            # 本地目录安装时
```

或重新执行一次 `install_bundle`（GitHub 规格）；更新后在插件管理器里禁用再启用。

## 界面在哪里

侧边栏底部、Settings 之上的图标区（`sidebar.panellist`）多了一个回收站图标，排在其它面板图标之后。点击它，主区域会切换到回收站面板。

## 怎么把会话放进回收站

有三种方式：

1. **拖拽**：把侧边栏工作区里的会话行拖到回收站图标上——现在整个侧边栏条目（图标 + 文字区域）都是投放目标，不要求精准对准图标。
2. **大投放区**：一开始拖动会话，屏幕底部中央会浮出一个 236×52 的「松手移入回收站」提示块（`shell.overlay` 图层，盖在所有列之上），把会话拖进去松手即可；松手后提示块自动消失。放在底部中央而不是左下角，是为了不挡住侧边栏最后几行会话——否则想把会话拖到列表末尾时会误落进回收站。
3. **拖进面板**：回收站面板打开时，把会话拖进面板空白处。
4. **悬停按钮**：鼠标悬停在某个会话行上，浮层里点「移入回收站」。

放入时底层会调用官方的 `workspaceRegistry.archiveSession`，所以会话会先从工作区列表里消失（和官方「归档」一致），再进入回收站。**当前正在跑回合的会话会被拒绝**（提示「该会话正在运行，请先停止它再移入回收站」），不会打断正在进行的任务；**已经打开、但没在跑回合的会话**才会自动停掉界面占用后归档。

失败不会再只闪一下红灯：底部投放块会把原因显示 6 秒，同时写一行到 `<DSH_HOME>/recycle-bin/host.log`；跨站校验失败会记成 `guard-reject`，带完整请求头，便于排查。

## 回收站里能做什么

- **恢复**：把会话取消归档，重新回到原来的工作区。
- **立即删除**：需要点两次（第二次是「确认永久删除」，5 秒内有效）。
- **清空回收站**：同样需要二次确认。
- **自动删除**：每小时扫描一次，超过 14 天的条目会被永久删除；应用启动 5 秒后也会扫一次，补上关机期间到期的条目。

## 删除到底删了什么

DSH 目前没有「删除会话」的 Host API（`sessionPersistence` 只有 create/open/flush/stat/list，`sessionController` 与 `workspaceRegistry` 都没有删除会话的方法），所以这里的「永久删除」是文件级删除：

1. 如果该会话还在跑回合，直接拒绝并提示「该会话正在运行，请先停止它再删除」，不会取消、也不会打断任务；
2. 用 `sessionPersistence.open(id, 'write')` 抢占写句柄（重试 3 次、每次间隔 200ms）。**抢不到不再报错**：应用打开过的会话（启动时默认打开的那个、刚新建的对话、界面里还开着的归档行）会一直占着写句柄，直到页面关闭或应用重启——以前这就是「不重启就删不掉」的原因。现在抢不到就降级为直接删文件，并在 `recycle-bin/host.log` 里记一行 `force-delete`；
3. 删除 `<DSH_HOME>/sessions/<工作区桶>/<sessionId>/`（会话日志，可能是 `session.v4.jsonl.zstd`），删完再检查目录确实消失，否则整次删除判为失败、条目留在回收站；
4. 删除 `<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json`（预览缓存）；
5. 把该会话从所有工作区的 `sessionIds` 里 detach；抢占成功时再从归档集合里移除，抢占失败（会话仍活在内存里）时**保留归档标记**，这样重启前它也不会以「未分组」的空壳重新冒出来；
6. 发出 `api-session/removed` 事件，界面立刻把这一行从工作区列表（含「未分组」）里移掉，不会留下空壳。

## 状态文件

`<DSH_HOME>/recycle-bin/state.json`，记录每个被移入会话的 id、标题、所属工作区、移入时间。删除该文件等于清空回收站记录（不会恢复已删除的会话）。

## 已知限制

- **没有官方删除接口**：删除是文件级操作，属于绕过 API 的做法，未来 Host 若给会话加锁/改存储格式，需要同步调整 `lib/index.js` 的 `purgeFiles`。
- **搜索索引**：`session-query-sqlite` 的索引不在删除范围内，历史搜索命中可能仍指向已删除会话，点开时可能提示会话不存在。
- **正在运行的会话不能移动、也不能删除**：会提示先停止，不会打断任务。等回合结束后再操作。
- **打开的会话可以直接删除**：启动时默认打开的那个会话、刚新建还没重启过的对话，都能立即删除——写句柄被占用不再阻止删除，改删文件。代价是内存里仍留着它的对象，直到应用重启；因为保留了归档标记，它不会重新出现在列表里。
- **不可撤销**：删除就是真的删除，没有第三方工具无法恢复。
- **回收站里的会话仍归档在工作区**：这是有意的（不出现在会话列表），恢复时自动取消归档。
- **拖拽是否生效取决于会话行实际写入 `dataTransfer` 的负载**：插件会依次尝试 UUID、纯 id、JSON 里的 `sessionId`；优先采信 UUID 和非 `text/plain` 的私有类型，避免把会话标题误当 id。识别不到时不会报错，也不会误删。识别不到就退回用悬停按钮。
- **底部投放块只在拖动会话时出现**：拖动文本或系统文件（`Files` 类型）不会弹出，也不会被拦截。

## 排查：重启后侧边栏图标消失

`package.json` 的 `exports` 必须包含 `"./package.json": "./package.json"`。客户端模块扫描会在冷启动时通过包的导出表解析清单文件；缺这一条时，Host 半照常加载（路由可用、删除照常工作），但客户端半会被**静默跳过**，表现就是“重启后图标不见了、界面里没有任何入口”。这类“热装能用、重启就没”的现象，先查导出表。

同一条冷启动链路上还有第二个陷阱：`dsh.client.immediately`。声明了它，这个客户端半就被编进「首屏批次」，而首屏批次是在应用自己的静态清单里算好的——用户后装的插件挤不进去，于是静默丢失，只有开关一次插件（走重新扫描）才会出现。对照两个能稳定冷启动的第三方插件（`dshmarket`、`dsh-context`）都没有声明它，所以本插件也移除了这项声明，改为普通按需批次加载。

## 安装与验证

已通过 `plugin_manager` 安装为 profile bundle，Loader 条目为 `include:dsh-recycle-bin`。

- 重新启用：`plugin_manager` `set_plugin`，target `include:dsh-recycle-bin`。
- Host 逻辑自测：`node test/harness.mjs`（在临时 `DSH_HOME` 里跑真实的 route handler，覆盖 list/trash/restore/delete/sweep/鉴权与错误路径）。
- 客户端结构自测：`node test/client-smoke.mjs`（用假 `window.__ModuleLoader__` / React 执行 `lib/client.js`，断言模块契约与 4 个槽位注册）。
- 线上自检：`GET http://127.0.0.1:<当前 GUI 端口>/dsh-recycle-bin/list`，带请求头 `x-dsh-recycle-bin: 1`，应返回 `{"ok":true,"retentionDays":14,"items":[...]}`；不带该头会返回 403（路由挂在鉴权之前，这个头用来挡跨站伪造请求）。GUI 端口每次启动可能不同，以运行时上下文里的 URL 为准。
