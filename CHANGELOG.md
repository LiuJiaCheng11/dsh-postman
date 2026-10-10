# Changelog

本文件记录 dsh-postman 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
