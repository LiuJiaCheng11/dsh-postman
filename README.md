# dsh-postman

一个 [dsh（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 插件：
**给 AI 一套访问线上 Postman 的工具**——查询、新增、删除接口，导出导入集合，扫源码批量补齐。

- 8 个模型可见工具：`postman_list` / `postman_tree` / `postman_add` / `postman_rm` /
  `postman_pull` / `postman_push` / `postman_scan` / `postman_config`
- **`/postman-skill` 技能**：像 `/browser-skill` 一样，一句话把整套用法注入当前会话
- **配置在 dsh 的「设置 → Postman」**：自带客户端半边注册设置分区，`apiKey` 标了
  `role('secret')`，明文不会回传浏览器
- **不绑定任何具体项目**：源码目录、URL 前缀全部由参数传入，没有写死的路径或端口
- 只依赖 `@deepseek-ai/schemastery`（dsh 自带的配置 schema 库），其余全用 Node 内置模块

## 安装

插件目录本身就是一个 dsh bundle。用 dsh 自带的插件命令安装即可：

```sh
# 在任意目录执行；dsh 会把路径转发给 profile 目录的 pnpm
dsh plugin --profile web add "E:/Code/DshPlugins/dsh-postman"
```

安装后 dsh 会自动把 `dsh-postman` 追加进 `~/.dsh/profiles/web/package.json` 的
`dsh.profile.bundles`。**重启 dsh**（重新 `dsh web`）后插件生效。

验证装配：

```sh
dsh --profile web --dump-config | grep -i postman
```

## 配置 Postman API Key

**推荐：在 dsh 里打开「设置 → Postman」**，直接填进表单。因为标了 `role('secret')`，
读取时值被抹掉、页面只显示「已配置 / 未配置」，明文不回流浏览器；保存后立即生效。

在 [Postman 账号设置 → API Keys](https://web.postman.co/settings/me/api-keys) 生成 Key（`PMAK-` 开头）。

留空时的回退顺序：

1. 设置表单里的 `apiKey`（profile user 层）
2. `~/.dsh/dsh-postman/config.json`（备用页写入，权限 0600）
3. `~/.postman_api_key`（历史文件）
4. `POSTMAN_API_KEY` 环境变量

备用页在 `http://127.0.0.1:<port>/dsh-postman`，功能与设置表单等价，多了「保存并验证」。

### 设置页是怎么来的（关键：光导出 `Config` 不够）

dsh 里并存着**两套**设置服务实现，插件对两套都做了适配，且不会重复出页：

| dsh 版本 | 实现 | `describe()` 的数据来源 | 本插件的适配 |
| --- | --- | --- | --- |
| 0.2.x | `SettingsForms` | 遍历 profile 条目，取 `entry.fiber.runtime.Config` 当 schema；`volatileForm()` 会丢掉没有任何 volatile 字段的条目 | 导出 `Config`（`src/index.js` 顶部） |
| 0.1.x | `SettingsProvider` | 只列**显式注册过**的命名空间 | 调 `settings.register('dsh-postman', Config, { base })`，并 `watch()` 变更做实时生效 |

两条路径互不干扰：0.2.x 的服务没有 `register` 方法，插件会直接跳过；0.1.x 不读 `Config`。

`apiKey` 必须标 `volatile`（这里用 `.extra('volatile', true)`，见 `src/index.js` 的注释）：
在 0.2.x 上，一个 volatile 字段都没有的条目会被 `volatileForm()` 整个滤掉。

**但这两件事只让命名空间「有 schema 可渲染」，并不会让设置里出现一行。**
Web 客户端的设置导航行**只**来自客户端注册的 `settings.section` 槽位
（`ui-settings-general` 的 nav 投影就是 `ctx.slots.entries('settings.section')`）；
宿主侧那个 `autoGenerate` 字段在 Web 客户端**没有任何消费方**（桌面端才用）。
所以本插件自带了一个客户端半边 —— `client/client.js`，注册 id 为 `postman` 的设置分区，
页面直接编辑 `dsh-postman` 命名空间的 `apiKey`：

- 接线靠 `package.json` 的 `dsh.client`（`platform: 'web'` + `inject`）与 `exports["./client"]`；
  宿主把该文件经 `/plugins` 发给浏览器，不需要构建步骤（手写 JS，只用 `require("react")`）。
- 页面通过 `ctx.configForms.get('dsh-postman')` 读写，与官方设置页共用同一套
  「读取脱敏 / 写入走 profile user 层 / revision 冲突栅栏」。
- 「Key 是否已配置」读的是 `describe()` 视图的 `secrets`（`role('secret')` 字段的值被抹掉，
  只回一个 `set` 布尔），所以页面永远拿不到明文。
- 用 `configForms.whileServed(['dsh-postman'], …)` 包住注册：命名空间没被服务时不出现这一页。

> 自检（三层，缺一层就会漏掉一种失败）：
> - `node test/settings-page.js` —— 复刻 dsh 已构建产物里的表单投影逻辑跑真实 `Config`，
>   并带一条反向对照（去掉 volatile → 条目必被丢弃）。
> - `node test/client-bundle.js` —— 在假浏览器里加载 `client/client.js`，验证
>   bundle id、槽位注册与写入路径。
> - `bash test/client-served.sh` —— **真启动**，从 index.html 的启动图里读出该插件的
>   bundle 地址再取回来校验（`dsh.client` 接线错了宿主不会报错，只会让那一页消失）。
>
> 想直接看宿主侧的判定：`dsh --profile web --dump-config-schema`，
> `dsh-postman` 应指向真实 schema（如 `#/$defs/config101`）而不是 `unknownConfig`。

## 技能：/postman-skill

插件注册了一个运行时技能，在输入框敲 `/` 就能看到（与 `browser-skill` 并列）：

```
/postman-skill
```

它把这套工具的完整用法（工具表、典型流程、破坏性操作的前置确认规则）注入当前会话。
不用它也行——系统提示里已带精简说明，直接说「帮我在 Postman 的 App 集合里加个接口」即可。

## 工具用法

| 工具 | 作用 |
|---|---|
| `postman_list` | 列出全部集合（名称 + uid） |
| `postman_tree` | 展示某集合的目录树与接口清单 |
| `postman_add` | 在指定目录新增接口（可自动建目录、继承集合 auth） |
| `postman_rm` | 按名称删除接口 |
| `postman_pull` | 导出集合为 Postman v2.1 JSON |
| `postman_push` | 用本地 JSON 整体覆盖集合 |
| `postman_scan` | **扫描源码提取路由，报告 / 对比 / 写入集合** |
| `postman_config` | 查看/设置/清除 API Key |

对话示例：

> 列出我的 Postman 集合
>
> 在 App 的「测试」目录下加一个 GET 接口 http://localhost:8080/api/v1/models
>
> 把 Converter 集合导出到 D:/tmp/converter.json
>
> 扫一下 D:/src/MyApi，看哪些接口还没进 Postman
>
> 把 D:/src/MyApi 里没同步的接口写进 App 集合

### postman_scan：扫代码生成接口

参数：

| 参数 | 说明 |
|---|---|
| `dir` | **必填**。源码根目录（多个根用逗号或分号分隔） |
| `module` | 只扫某个业务模块（`[Area]` 名） |
| `collection` | 指定集合名；给出后进入**对比模式** |
| `import` | `true` 时进入**写入模式**，把缺失接口写进集合 |
| `folder` | 写入时用的顶层目录（默认 `源码同步`） |
| `baseUrl` | 写进集合的 URL 前缀；不传时用 `http://localhost` |
| `limit` | 最多渲染多少条（默认 150） |

三种模式：

1. **报告模式**（只给 `dir`）：列出扫到的全部路由，按模块分组。
2. **对比模式**（`dir` + `collection`）：与集合内已有请求比对，报告「缺失 / 已存在」。
3. **写入模式**（再加 `import=true`）：把缺失接口按
   `源码同步/<模块>/<控制器>/<控制器.方法>` 落进目录，并自动生成请求体骨架。

识别规则（ASP.NET Core 约定路由）：

- 路由模板 `/api/{Area}/{Controller}/{Action}`；模块名取控制器上的 `[Area("...")]`（含 BaseController 继承）
- 只把**带显式 `[HttpGet]` / `[HttpPost]` / `[HttpPut]` / `[HttpDelete]` / `[HttpPatch]` 的 public 方法**当作 action（支持多动词特性）
- 描述取 `/// <summary>`；参数文档取 `/// <param name="...">`；请求体骨架按 C# 类型生成
- `[RightAuthorize("...")]` → 权限备注；`[ExportToFile]` → 导出接口备注
- 自动跳过 `obj/ bin/ .vs/ .git/ node_modules/ packages/ .build-tmp/`

## 安全说明

- **PUT 是整体覆盖**：每次写操作前都会先 `GET` 最新云端版本，并备份到 `~/.postman_backup/<uid>.json`。
- API Key 只存本机，不会外发；设置页里标了 `role('secret')`，明文不回流浏览器。
- 配置接口挂了与 dsh 其它 host 路由一致的信任栅栏（`connection.requestRejection`），拒绝跨站调用。
- 破坏性操作（删除、覆盖、批量写入）在技能里被要求**先向用户确认**。

## 目录结构

```
dsh-postman/
  package.json          # 声明 dsh.bundle.patch 与 dsh.client
  cordis.patch.yml      # 插件装配补丁（insert 一行）
  README.md
  CHANGELOG.md
  PUBLISHING.md         # 发布指南（GitHub / npm / 插件市场）
  LICENSE
  client/
    client.js           # 客户端半边：注册「设置 → Postman」那一页（手写 JS，无需构建）
  skill/
    SKILL.md            # /postman-skill 的正文
  src/
    index.js            # 宿主入口：Config schema + 工具 + 技能 + 备用配置页
    postman-api.js      # Postman API 客户端
    route-scanner.js    # C# 控制器路由扫描器
    schemastery.js      # 稳健加载 @deepseek-ai/schemastery（设置页 schema）
    page.js             # 备用配置页 HTML
  test/
    smoke.js            # 冒烟测试（假 ctx 加载 + 契约校验 + 真实 list 调用）
    scanner.js          # 扫描器单测（内联 fixture，5 组断言）
    settings-page.js    # 命名空间回归：复刻 dsh 的表单投影逻辑跑真实 Config
    client-bundle.js    # 客户端 bundle 单测（假浏览器 + 假 React）
    realstart.sh        # 真启动：探宿主路由 + 查致命报错
    client-served.sh    # 真启动：确认客户端 bundle 被编入启动图并正常发出
  scripts/
    setup-publish.sh    # 一键填仓库地址 + 生成市场投稿文件
  .github/workflows/
    publish.yml         # 打 tag 自动发 npm
```

## 开发

```sh
cd E:/Code/DshPlugins/dsh-postman
npm run check              # node --check 全部源文件（含 client/client.js）
npm test                   # 下面四个单测一起跑
node test/smoke.js         # 导出契约 + Config + 工具 + 技能 + 设置命名空间 + 路由
node test/scanner.js       # 扫描器单测
node test/settings-page.js # 命名空间会不会进 describe()（含反向对照）
node test/client-bundle.js # 客户端 bundle 的注册契约与写入路径
npm run test:real          # 真启动：宿主路由 + 客户端 bundle 都要过
npm run test:client        # 只跑客户端 bundle 的真启动验证
```

> `test:real` 会在空闲端口拉起真实 dsh 实例，做两件事：
> 1. `realstart.sh` 探 `/dsh-postman` 是否返回 200（对照组必须 404），并检查启动日志里有无
>    `unsupported JSON schema` 之类的致命错误；
> 2. `client-served.sh` 从 index.html 的启动图里读出本插件的 bundle 地址再取回来校验。
>    **`dsh.client` 接线错了宿主不会报错**，只会让「设置 → Postman」那一页凭空消失，
>    所以这一步不能省。
>
> **改完工具 schema 或 `Config` 一定要跑它**——`--dump-config`
> 只组合 YAML、不 import 插件，测不出这类问题。
>
> 两个运行时都测过（用第二个参数或 `DSH=` 指定入口）：
>
> ```sh
> # 已安装运行时（0.1.x，走 settings.register 那条路径）
> bash test/realstart.sh 3096
> bash test/client-served.sh 3095
> # 源码仓库运行时（0.2.x，走 Config 派生那条路径）
> DSH="E:/software/deepseek-harness/apps/cli/lib/bin.js" bash test/realstart.sh 3097
> DSH="E:/software/deepseek-harness/apps/cli/lib/bin.js" bash test/client-served.sh 3098
> ```
>
> 两者发 bundle 的 URL 格式不同，`client-served.sh` 两种都认：
> 0.2.x 是 combo（`/plugins/??dsh-postman/client.js&rev=…`），
> 0.1.x 是单资源（`/plugins/dsh-postman/client.js?rev=…`）。
>
> 命名空间 schema 单独验证：
>
> ```sh
> dsh --profile web --dump-config-schema | grep -A5 '"dsh-postman"'
> ```

## 实测参考

在一套多模块 .NET 项目上扫过约 **5000 条路由**（40+ 模块、600+ 控制器，扫描耗时约 10 秒），
与 Postman 集合比对覆盖率约 **74%**；未匹配的多为第三方服务路径或已变更接口。
具体数字取决于项目结构与集合新旧，仅供参考。

## 发布

要推到 GitHub / 发 npm / 上架 dsh 插件市场，见 **[PUBLISHING.md](./PUBLISHING.md)**。
最快路径：

```sh
bash scripts/setup-publish.sh 你的GitHub用户名   # 填仓库地址 + 生成市场投稿文件
```

之后按脚本提示做四步即可。变更记录见 [CHANGELOG.md](./CHANGELOG.md)。
