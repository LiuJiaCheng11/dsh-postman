# 发布指南

本插件要「上线」，需要走完三步：**推 GitHub → 发 npm → 提市场 PR**。
市场本身不托管代码，它只从 npm 安装、从精选列表读条目。

> **名字已定：`dsh-postman`**（2026-10-10 定）。曾权衡过要不要叫 `postman-bridge`，结论是**不改**：
> 在 dsh 生态里 `bridge` 已经专指**通道 / 远程接入**类插件 —— `dsh-bridge`（本地会话消息）、
> `@wenbin_wb/dsh-bridge`（远程控制、扫码接入）、`dsh-bridge-gateway`（隧道网关）、
> `bridge-dsh` 与 `@shallbay/dsh-bridge-browser`（WebSocket 载体）、`openclaw-dsh-bridge` /
> `onebox-dsh-bridge`（IM / 手机端接入）、`hermes-dsh-bridge`（把 dsh 暴露成 MCP），
> npm 上实测 15 个，无一例外。而本插件做的是「注册一组模型可见工具」，
> 官方对这类插件的命名是 `dsh-tool-*`（`dsh-tool-fs` / `dsh-tool-bash` / `dsh-tool-pwsh`）。
> 叫 bridge 会让人预期它是传输载体。真想要更贴官方惯例的名字，备选是 `dsh-tool-postman`；
> 改名成本约 **150 处 / 20 个文件** + profile 重装 + 已存 API Key 迁移，不值当。
> 三个名字在 npm 上都还没被占用，所以这是「发布前才有的便宜窗口」—— 已过。

---

## 0. 改占位符（✅ 已完成 2026-10-10）

`package.json` 里的 `repository` / `homepage` / `bugs` 原来填的是 `USERNAME` 占位符，
已替换成真实仓库 `github.com/LiuJiaCheng11/dsh-postman`，市场投稿文件也已生成。

> 换账号时重跑：`bash scripts/setup-publish.sh <github用户名>`。
> 它会做三件事：替换 `package.json` 的三处地址 → 生成
> `marketplace/<用户名>__dsh-postman.yml` → 设置 git `origin`。
> **它不会覆盖已经指向同一仓库的 remote**（你用 SSH 推送的话不会被改成 HTTPS）。

`LICENSE` 里的署名已经是 `LiuJiaCheng`，需要的话一并改。

---

## 1. 推 GitHub（✅ 已完成）

> 仓库已建好并推送：`git@github.com:LiuJiaCheng11/dsh-postman.git`（SSH）。
> 下面留作记录 / 换仓库时参考。

在 GitHub 上**先建一个空仓库**（不要勾选 README / .gitignore / LICENSE），
名字建议 `dsh-postman`，然后：

```sh
cd E:/Code/DshPlugins/dsh-postman

git add -A
git commit -m "chore: 填写仓库地址"
git remote add origin git@github.com:LiuJiaCheng11/dsh-postman.git
git push -u origin main
```

> 仓库名与 npm 包名保持一致（都叫 `dsh-postman`）最省事 —— **但注意下面第 2 节的撞名问题**。

建议顺手加上仓库话题（Topics）：`dsh`、`dsh-plugin`、`deepseek-harness`、`postman`。

---

## 2. 发 npm

市场是**通过 npm 安装**的，所以必须先发包。

> ⚠️ **发包前必须重新确认名字**：GitHub 上已有一个同名的 `zhousun55-byte/dsh-postman`
> （文件上传插件，包名也叫 `dsh-postman`）。npm 上目前两者都还没发布，
> **谁先发谁占**。发之前再查一次：
>
> ```sh
> curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/dsh-postman
> # 404 = 还能用；200 = 已被占用，改用 dsh-postman-tools 或 @liujiacheng11/dsh-postman
> ```

```sh
cd E:/Code/DshPlugins/dsh-postman

# 首次发布前先登录（会打开浏览器）
npm login

# 干跑一遍，确认要上传的文件清单（应该是 8 个文件，不含 test/ 与 scripts/）
npm publish --dry-run

# 正式发布
npm publish
```

发布后验证：

```sh
npm view dsh-postman version
npm view dsh-postman dsh
```

> `prepublishOnly` 会自动跑 `npm run check && npm test`，测试不过发不出去。
> 注意：`test/smoke.js` 会真实调用 Postman API，**需要本机有可用的
> API Key**，否则那一步会退化成「基础校验通过（端到端跳过）」——不会阻断发布。
>
> 后续升级：改 `package.json` 的 `version` → `git commit` → `git tag v0.1.1`
> → `git push --tags` → `npm publish`。

---

## 3. 上架 dsh 插件市场

市场的插件列表来自精选仓库 **[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**。
**不要去 dsh-market 仓库提插件**（那是市场应用本体）。

### 投稿格式（已核对官方 contributing.md）

**一次投稿 = 新增一个文件**，路径 `data/plugins/<owner>__<repo>.yml`（owner 与 repo 之间是**双下划线**）。
例如 `data/plugins/你的用户名__dsh-postman.yml`：

```yaml
url: https://github.com/你的用户名/dsh-postman   # 必须与仓库完全一致
name: 你的用户名/dsh-postman                     # 列表里显示的链接文字
category: tools                                 # 工具类插件
description:
  en: Manage Postman cloud collections from dsh, and scan ASP.NET Core controllers to sync API routes into a collection.
  zh: 在 dsh 里管理 Postman 云端集合，并可扫描 ASP.NET Core 控制器把接口批量同步进集合。
```

规则要点：

- **只有 `description.en` 是必填**；`zh` 写不了可以不写，维护者会补。
- 描述**必须以句号结尾**；含 `: `（英文冒号+空格）时**必须给整行加引号**，否则 YAML 解析失败。
- **绝对不要手写 `npm:` 键**——npm 映射由系统从 registry 自动采集，手写会被校验拒绝。
- 不要手写 `stars` / `downloads` / `install` / `screenshots`，全是自动生成的。
- `category` 可选值：`agi` `ui` `usage` `theme` `model` `identity` `session` `memory`
  **`tools`** `wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify`
  `dev` `security` `remote` `market` `fun`
- **两个 README 由脚本生成，不要手改。**

### 步骤

1. Fork [github.com/awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
2. 在 `data/plugins/` 下新增 `你的用户名__dsh-postman.yml`（内容见上）
3. 提 PR，说明这是一个 dsh 工具类插件
4. 合并后站点 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 与
   `dshmarket` 面板会自动收录，**通常一天内生效**

> 本仓库的 `scripts/setup-publish.sh` 会自动生成这个 yml 文件到 `marketplace/` 下，直接复制过去即可。

收录后，别人就能在 dsh 的 **设置 → 插件市场** 里搜到并一键安装。

> 收录不等于背书。市场文档原话：「插件是第三方代码，请只安装你信任的来源。」

---

## 附：别人怎么装

市场收录前，用户也能直接装：

```sh
# 从 GitHub 装（现在就能用，已实测通过）
dsh plugin --profile web add github:LiuJiaCheng11/dsh-postman

# 从 npm 装（发布之后才有）
dsh plugin --profile web add dsh-postman

# 从本地目录装（开发时，装成软链，改代码即时生效）
dsh plugin --profile web add E:/Code/DshPlugins/dsh-postman
```

装完**重启 dsh**（重新 `dsh web`）生效。之后打开
`http://127.0.0.1:3080/dsh-postman` 填 API Key。

### ⚠️ 包名冲突：GitHub 上已有一个同名的 `dsh-postman`

`zhousun55-byte/dsh-postman`（v1.0.0）是一个**文件上传**插件，包名同样是 `dsh-postman`。
两者会在四个地方互相覆盖：

| 冲突点 | 说明 |
|---|---|
| npm 包名 | `dsh-postman`（npm 上目前**两者都还没发布**，谁先发谁占） |
| profile 依赖键 | `~/.dsh/profiles/<profile>/package.json` 的 `dependencies.dsh-postman` —— 装一个会把另一个替换掉 |
| HTTP 路由前缀 | 两者都用 `/dsh-postman`（本项目是配置页，它是 `/dsh-postman/upload`） |
| 客户端 bundle id | 都是 `dsh-postman` |

**所以：**
- 装的时候务必认准 `LiuJiaCheng11/dsh-postman`，别照抄别人 README 里的
  `github:zhousun55-byte/dsh-postman`（那条命令装的是**文件上传插件**）。
- 发 npm 前先确认名字还在（`curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/dsh-postman`
  → 404 表示可用）；若已被对方占用，改用 `dsh-postman-tools` 之类的名字，
  或发布到自己的 scope（`@liujiacheng11/dsh-postman`）。
- 市场投稿时如果撞名，评审一般会要求改包名。

---

## 发版检查清单

- [x] `package.json` 三处 `USERNAME` 已替换 → `github.com/LiuJiaCheng11/dsh-postman`
- [x] 仓库已推送 → `git@github.com:LiuJiaCheng11/dsh-postman.git`
- [x] 市场投稿文件已生成 → `marketplace/LiuJiaCheng11__dsh-postman.yml`
- [x] GitHub 形式的安装命令已实测通过（`dsh plugin --profile web add github:LiuJiaCheng11/dsh-postman`）
- [ ] **npm 包名再确认一次**（同名 `zhousun55-byte/dsh-postman` 存在，见第 2 节）
- [ ] `version` 已递增（npm 不允许覆盖已发布版本）
- [ ] `CHANGELOG.md` 已补本次变更
- [ ] `npm run check && npm test` 全绿
- [ ] `npm run test:real` 通过（真启动验证，换端口别动 3080）
- [ ] `npm publish --dry-run` 文件清单正确（不应包含 `test/` 与 `scripts/`）
- [ ] `git tag vX.Y.Z` 并推送
- [ ] GitHub Release 写清变更（市场会用它当「更新内容」）
- [ ] 市场投稿文件 `marketplace/LiuJiaCheng11__dsh-postman.yml` 已提 PR
- [ ] README 里的安装命令与实际包名一致
