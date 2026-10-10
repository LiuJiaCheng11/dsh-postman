# Changelog

本文件记录 dsh-postman 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.0] — 2026-10-10

把上一轮实测里暴露的两个摩擦点直接消掉：**改接口不必再「先删再加」**，
**大树不再静默截断**。

### Added

- **`postman_edit`：就地修改已有接口。** 按名称递归定位，只 patch 传入的字段，
  其余原样保留——包括 `event`（Pre-request / Tests 脚本）、`response`（示例响应）、
  `protocolProfileBehavior` 等工具本身不认识的字段。
  参数：`newName` / `url` / `method` / `headers`（整份替换）/ `body` / `language` /
  `clearBody` / `description`（空串 = 删除）/ `auth`（`true` 继承集合级、`false` 移除）。
  改名撞同层已有名字、只给 `language` 但原本没有 raw body、集合没有 auth 却要继承、
  一个字段都没传 —— 这几种情况都会**明确报错**，而不是写入一个半成品。
- **`postman_tree` 的 `path` 与 `limit` 参数。** `path` 只看某个目录的子树
  （`"Discipline/EvaluateIndicator"`），目录不存在时报错并列出顶层目录；
  `limit` 默认 400 行。
- **截断不再静默。** 输出超限时末尾追加显式提示（渲染了多少行 / 该范围共多少项 /
  改用 `path` 或调大 `limit` / 顶层目录列表），把「静默失败」变成可行动的信号。
- `test/edit-and-tree.js`：22 项断言。用内存假云端替换 `postman-api` 的网络入口，
  其余纯函数保持真实实现。覆盖 patch 语义、字段保留、各种报错分支，
  以及**一条反向对照用例**：真跑一遍 `rm` + `add`，证明 `event` / `response` /
  `description` 确实会永久消失。
- `test/_runtime.sh`：三个真启动脚本共用的运行时选择 / 起实例 / 取 token。
- **API 端点的逃生口：环境变量 `POSTMAN_API_BASE`**（默认仍是 `https://api.getpostman.com`）。
  起因是确认「浏览器里的 `<团队名>.postman.co` 地址要不要做成配置项」—— 结论是**不要**：
  那是每个团队都有的 `teamDomain`（团队名的 slug，`GET /me` 可见），只决定网页入口；
  API 按 Key 认证、按账号返回数据，端点全局统一。唯一例外是 **Enterprise 的 EU 数据驻留**
  （`api.eu.postman.com`，需联系销售购买），为它留了这个不改代码的口子。
  `postman_config status` 与 `/dsh-postman/api/config` 现在都会报出当前端点。
- `test/api-base.js`：6 项断言。默认值、覆盖生效、尾部斜杠归一、空值回退，
  以及一条**真实请求验证**（把端点指到 `127.0.0.1:1`，确认 `call()` 走的是 `resolveBase()`
  而不是那个常量）。

### Changed

- **真启动脚本的默认运行时改为源码仓库那份 0.2.0-rc.2**
  （`node --expose-internals --import tsx/esm apps/cli/src/bin.ts web`），
  也就是本机真实在跑的那一份。此前的默认是
  `~/.dsh/dsh-browser/node_modules/@deepseek-ai/dsh`（**0.1.1-rc.1**，且是被别的包带下来的
  传递依赖）—— 那是已安装的旧版，能力不同（没有 `configForms` / `settings.section`），
  拿它当默认会把结论带偏。覆盖方式：`DSH=`（入口）/ `DSH_CMD=`（完整命令）/ `DSH_SRC=`（仓库位置）。
- `skill/SKILL.md`：工具表加 `postman_edit`；「改接口前先确认现状」那节从
  「没有『改』这个动作，改 = 删掉再新增」改为**优先 `postman_edit`**，
  并把 `rm` 定位为「仅用于真的删除」；硬性规则里新增两条（改接口一律用 `postman_edit`、
  看到截断提示该怎么办）。
- `src/index.js` 系统提示的工具清单同步（含「不要用 rm + add 改接口」的明确劝阻）；
  `postman_add` 的说明补上「同名会报错，想改已有的请用 `postman_edit`」。
- 抽出 `parseHeaders()` / `guessLanguage()` 供 `add` 与 `edit` 共用（行为等价）。
- README：工具表加 `postman_edit`、新增「postman_edit：改接口别用『先删再加』」与
  「postman_tree：大集合怎么不被截断」两节；「已知限制」里那两条已解决的移出，
  换成新的四条真实摩擦点；实测参考补上这两个改动的由来。

### Fixed

- 真启动脚本的就绪判据：从「端口有响应」改为**日志里出现 token 行**。
  实测端口会先被占住并返回 404/401，此时 dsh 还没打印访问地址，拿去换 cookie 必失败
  ——原来的写法会误判为「2 秒就绪」。
- 四个真启动脚本里 `HERE="$(cd … && pwd -W … || cd … && pwd)"` 的运算符结合性 bug
  （实际按 `(A || B) && C` 解析，会多输出一行路径，导致 `source` 找不到文件）。
- **市场投稿描述里的「Zero dependencies / 零依赖」删掉了。** 官方收录规则明确写着
  「描述会被当作出题来核对代码，夸大是让一个本来不错的插件被打回的主要原因」，
  而 `package.json` 里有 `@deepseek-ai/schemastery`，本仓库 README 第 12 行写的也是
  「只依赖 `@deepseek-ai/schemastery`」——三者互相矛盾。现在描述只讲功能，不含依赖声明。

### 投稿准备（对照官方校验器源码逐条核对，非复述 contributing.md）

- `marketplace/LiuJiaCheng11__dsh-postman.yml`：`category: tools`，
  `name` 与 `url` 同名，字段只用了白名单内的 `url`/`name`/`category`/`description`。
- 新增 `npm run check:marketplace`（`test/marketplace-entry.js`）：把官方
  `scripts/lib/entries.mjs` 的 `validateEntries()` 规则本地跑一遍——字段白名单、
  文件名 slug、`name`/`url` 一致性、category 白名单、`description.en` 必填且单行、
  不允许额外 locale、`: ` 冒号检查；另外附带检查 `dsh.bundle` 与 `repository` 占位符。
  需要 `js-yaml`，所以**不挂在 `npm test` 里**（测试套件保持零依赖），缺库时打印 SKIP 退出。
- 查清了两个会拦 PR 的真实门槛：
  1. **仓库需创建满 1 天**（`MIN_AGE_DAYS = 1`）。本仓库 `created_at = 2026-10-10T08:54:25Z`，
     提交时必然先红——但官方 `regate.yml` 每 6 小时自动重跑被年龄卡住的 PR，
     gate 报错文案本身就说「No need to resubmit, push, or close and reopen」，
     所以**照常提 PR 即可，会自己转绿**。
  2. **仓库必须打 `dsh-plugin` topic**——当前 topics 为空，待补。

### 实测（本轮依据）

- 源码运行时 0.2.0-rc.2 真启动：`/dsh-postman` → HTTP 200，`/dsh-postman/api/config` → 200，
  对照组 `/__no_such_route__` → 404；客户端 bundle
  `/plugins/??dsh-postman/client.js&rev=a37266323764` → 200（15215B），
  包装 / 注册 id / `settings.section` 均正确；启动日志无致命报错。
- `npm run check` = 0；`npm test` = 0（新增 `edit-and-tree.js` 的 22 项断言，五个单测全绿）。

## [0.4.1] — 2026-10-10

封板前的实测复核与健壮性收口。

### Added

- `test/probe-key.sh`：真启动后直接 `GET /dsh-postman/api/config`，打印插件**实际认的
  Key 来源**。排查「明明配了却读不到」最快的一招（不用开 UI）。
- `test/livereload-probe.sh`：验证「外部改 `cordis.patch.yml` 不会热加载」。自带备份 +
  trap 还原，并要求 `I_KNOW=1` 才运行（它会临时改 profile）。
- `test/client-bundle.js` 新增 2 条断言（共 11 条）：0.1.x 缺 `configForms` 时不抛错、
  保存文案不承诺「立即生效」。
- README 新增「保存为什么可能不马上生效」与「已知限制」两节。

### Changed

- 客户端 `apply()` 增加守卫：`configForms` / `slots` 缺失时**静默退出**并打一条
  `console.warn`。此前会抛 `TypeError` —— 在只有 0.1.x 客户端的部署里会污染整个
  客户端启动（表现为「设置里少一页」之外还多一堆控制台错误）。
- 保存成功文案：`已保存，立即生效。` → `已保存。若当前会话仍读到旧 Key，新开一个
  会话或重启 dsh。`（英文同步）。原文案是**错的**：见下。
- README 修正「保存后立即生效」的说法，并写清完整写入链路与两种失效场景。

### Fixed

- **纠正「设置页保存需要重启 dsh」这个中间结论**。实测发现：
  - 走设置页那条通道（`configForms.set()` → `remote.settings.mutate` → 宿主
    `settings.update(ns)` → `configEditor.edit(entry)`）**是热的** —— `configEditor`
    的文档就是 profile 的 patch 文件，写完后会显式
    `reconcileProfilePatches(root, patches, 'dsh', [entryId])` 重载该条目。
  - **外部**直接改 `cordis.patch.yml` 才不会被热加载（实测改完等 12 秒无变化）。
  - 真实会话里出现「设置存了 Key、`postman_config` 仍显示历史文件」，是**长会话持有旧
    工具闭包**所致，新开会话即恢复；不是配置没写进去（已核对 `cordis.patch.yml` 内容）。
- 确认主目标运行时是本机的**源码 0.2.0-rc.2**
  （`node --expose-internals --import tsx/esm apps/cli/src/bin.ts web`）。
  `settings.section` 与 `configForms` 在已安装的 0.1.1-rc.1 里**都不存在**，
  所以客户端那一页只在 0.2.x 上出现；0.1.x 用备用页 `/dsh-postman`。

### 实测（本轮复核依据）

- 一次真实会话（450 次工具调用）里 postman 工具共 **15 次、0 报错**：
  `add×7 tree×2 pull×2 rm×2 config×1 list×1`。同会话的 20 个报错全部来自
  `browser-skill`（`bsk`），与本插件无关。
- 两个运行时的真启动探测一致：全新启动时
  `source = 插件配置（dsh 设置页 / cordis.patch.yml / 环境变量）`。
- `npm run check` = 0；`npm test` = 0（40 ✓）。

## [0.4.0] — 2026-10-10

### Added

- **客户端半边 `client/client.js`**：「设置 → Postman」终于真的出现在设置里。
  注册 id 为 `postman` 的 `settings.section`，页面直接编辑 `dsh-postman` 命名空间的
  `apiKey`（密码框 + 已配置/未配置状态 + 保存/清除）。
  - 接线：`package.json` 的 `dsh.client`（`platform: 'web'` + `inject`）与 `exports["./client"]`；
    宿主经 `/plugins` 把该文件发给浏览器。
  - **手写 JS，不引入构建步骤**：用 `window.__ModuleLoader__.load({ id, factory })` 包装，
    只 `require("react")`（宿主提供），不需要 UI 库依赖。
  - 「Key 是否已配置」读 `describe()` 视图的 `secrets`（`SettingsNamespaceView.secrets = [{path,set}]`）——
    `configForms.get()` 的快照里**没有** secrets，只能从镜像视图取。
  - 用 `configForms.whileServed(['dsh-postman'], …)` 包住注册：命名空间没被服务时不留痕迹。
- `test/client-bundle.js`：假浏览器 + 假 React 加载 `client/client.js`，验证 bundle id、
  `settings.section` 注册契约、两种状态下渲染、以及 set/unset 写入路径（9 项断言）。
- `test/client-served.sh`：**真启动**，从 index.html 的启动图里读出本插件的 bundle 地址
  再取回来校验包装/注册 id/`settings.section`。两个运行时的 URL 格式不同，两种都认。

### Changed

- `README` 的「设置页是怎么来的」重写：把「导出 `Config` 就会有设置页」这个**错误结论**纠正掉。

### Fixed

- **纠正 0.3.0/0.3.1 的核心误判**：导出 `Config` + 标 `volatile` 只让命名空间进入
  `settings.describe()`，**不会**让设置里出现一行。Web 客户端的设置导航行**只**来自
  客户端注册的 `settings.section` 槽位（`ui-settings-general` 的 nav 投影就是
  `ctx.slots.entries('settings.section')`）；宿主侧那个 `autoGenerate` 字段
  （注释写着「Generate a page if no custom page is registered for this instance」）
  在 Web 客户端**没有任何消费方**，所以自动派生的页面在 Web 上不存在。
  这也解释了为什么第三方插件（dshmarket、dsh-vision-router）都自带客户端 bundle。
- `test/settings-page.js` 的结论文案与文件头注释同步纠正（说明它能证明什么、不能证明什么）。

## [0.3.1] — 2026-10-10

### Added

- **`test/settings-page.js`**：设置页回归测试。逐行复刻 dsh 已构建产物
  （`packages/settings/settings/lib/index.js`）里的 `volatileForm` / `plainSchema` /
  `projectForm`，跑真实 `Config`，并带一条**反向对照**（去掉 volatile 标记 → 条目必被
  丢弃），把「设置页会不会出现」这件事钉进 CI。
- `test/smoke.js` 覆盖旧版 dsh 的 `settings.register()` 路径：断言命名空间、`base`、
  以及 watch 订阅，并模拟一次设置写入验证**改完立即生效**。

### Changed

- **旧版 dsh（0.1.x 的 `SettingsProvider`）的设置改为实时生效**：注册命名空间后
  `watch()` 变更并就地刷新插件配置，对齐官方 `installSettingsSection()` 的语义。
  此前只是注册，填完 Key 需要重启 dsh 才读到。
- Key 来源标识改为「插件配置（dsh 设置页 / cordis.patch.yml / 环境变量）」。

### Fixed

- 更正 0.3.0 里对版本分界的描述：两代 dsh 的差异不是「0.1.7」，而是
  **两套并存的设置服务实现** —— `SettingsForms`（按 `entry.fiber.runtime.Config`
  自动派生，`autoGenerate` 默认 true）与 `SettingsProvider`（只列显式注册过的
  命名空间，必须自己 `register`）。插件现在两条路径都覆盖，且不会重复出页
  （新版的服务没有 `register` 方法）。

## [0.3.0] — 2026-10-10

### Added

- **设置页**：插件现在导出 `Config` schema，dsh 会在 **设置 → postman** 里渲染表单，
  直接在设置里填 Postman API Key（不再需要打开独立网页）。
  - `apiKey` 标 `role('secret')`，读取时值被抹除，明文不回流浏览器
  - 兼容 dsh < 0.1.7：那套版本没有 Config 派生机制，改用 `settings.register()` 注册命名空间
  - 新增 `src/schemastery.js`：稳健加载 `@deepseek-ai/schemastery`
    （插件以 `link:` 安装时按真实路径解析不到 profile 里的包，这里按多锚点回退）
- **`/postman-skill` 技能**：注册运行时技能（插件级 + agent 级，对齐 `browser-skill-dsh-plugin`），
  正文在 `skill/SKILL.md`，含工具表、典型流程与破坏性操作的前置确认规则

### Changed

- `postman_scan` 的 `baseUrl` 默认值从 `http://localhost:10423` 改为 `http://localhost`
  —— 去掉对特定项目的隐含绑定，端口一律由调用方传入
- 工具报错信息改为引导到「设置 → postman」而不是独立配置页
- 系统提示补充 `postman_scan` 与技能名，并加入「不要索要 Key 明文」的约束
- `README` 全面重写；实测数据改为泛化描述（不再绑定具体项目路径）

### Fixed

- 修复插件在 dsh 设置里显示但**没有表单、无法配置**的问题。有两层原因：
  1. 模块未导出 `Config`，`--dump-config-schema` 里该条目为 `unknownConfig`，
     设置页拿不到 schema 可渲染；
  2. `apiKey` 未标 **`volatile`** —— dsh 的 settings 用 `volatileForm()` 过滤表单，
     非 volatile 的叶子字段会被丢弃，一个都不剩时**整个条目被滤掉、设置页不出现**。
- 用 `.extra('volatile', true)` 代替 `.volatile()`：后者是 schemastery 3.18.4 才有的语法糖，
  而运行时可能加载 3.18.1（无该方法，直接抛错）。`extra()` 两个版本都有。
- `apply(ctx, config)` 里归一化解开 cordis 的 Volatile 包装
  （volatile 字段拿到的是有 `.get()` 的引用对象，不是裸值）。

## [0.2.0] — 2026-10-10

首个发布版本。

### Added

- **`postman_scan` 工具**：扫描 ASP.NET Core 控制器，把接口批量同步进 Postman 集合。
  - 三种模式：报告（只给目录）／对比（+集合名）／写入（+`import=true`）
  - 支持 `[HttpGet]`/`[HttpPost]`/`[HttpPut]`/`[HttpDelete]`/`[HttpPatch]` 及多动词特性
  - `[Area("...")]` 支持从 BaseController 继承；`/// <summary>` 取描述、`/// <param>` 取参数文档
  - `[RightAuthorize("...")]` 记为权限备注、`[ExportToFile]` 记为导出接口
  - 泛型参数（`Dictionary<string, object>`）的逗号不会被误切
  - 自动跳过 `obj/` `bin/` `.vs/` `.git/` `node_modules/` `packages/` `.build-tmp/`
  - 写入模式按 `源码同步/<模块>/<控制器>/<控制器.方法>` 落目录，并按 C# 类型生成请求体骨架
- `src/route-scanner.js`：零依赖 C# 路由扫描器
- `test/scanner.js`：扫描器单测（5 组内联 fixture 断言）
- `test/realstart.sh`：真启动验证脚本（换端口起实例 + 探测路由 + 检查致命报错）
- `scripts/setup-publish.sh`：一键填写仓库地址并生成市场投稿文件
- `postman_list` / `postman_tree` / `postman_add` / `postman_rm` / `postman_pull` /
  `postman_push` / `postman_config` 七个工具
- 配置页 `http://127.0.0.1:<port>/dsh-postman`，用于填写 Postman API Key
- API Key 三级回退：插件配置 → `~/.dsh/dsh-postman/config.json` → `~/.postman_api_key` → 环境变量

### Security

- 每次写操作前先 `GET` 云端最新版本，并备份到 `~/.postman_backup/<uid>.json`
- 配置接口挂 `connection.requestRejection` 信任栅栏，拒绝跨站调用
- API Key 只存本机，权限 0600，不外发

### Compatibility

- `engines.dsh: ">=0.1.1-rc.1"`，已在 **0.1.1-rc.1** 与 **0.2.0-rc.2** 两个运行时实测通过
- 零外部依赖（只用 Node 内置模块）
