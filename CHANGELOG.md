# Changelog

本文件记录 dsh-postman 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
