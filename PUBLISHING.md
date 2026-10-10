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

### 投稿格式（已核对官方校验器源码，非猜测）

**一次投稿 = 新增一个文件**，路径 `data/plugins/<owner>__<repo>.yml`（owner 与 repo 之间是**双下划线**）。
本仓库已经把这份文件生成好了，就在 [`marketplace/LiuJiaCheng11__dsh-postman.yml`](marketplace/LiuJiaCheng11__dsh-postman.yml)：

```yaml
url: https://github.com/LiuJiaCheng11/dsh-postman
name: LiuJiaCheng11/dsh-postman
category: tools
description:
  en: Manage Postman cloud collections from dsh with 9 tools — list, browse, add, edit and delete requests, export or overwrite a whole collection, and scan ASP.NET Core controllers to sync their routes into a collection.
  zh: 用 9 个工具在 dsh 里管理 Postman 云端集合——列出、浏览、新增、修改、删除接口，导出或整体覆盖集合，并可扫描 ASP.NET Core 控制器把路由同步进集合。
```

以下规则来自官方 CI 校验器 [`scripts/lib/entries.mjs`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/lib/entries.mjs)
的 `validateEntries()` 与 [`scripts/check-submission.mjs`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/check-submission.mjs)，
是**逐条对照源码**得出的，不是从 contributing.md 复述的：

| 检查 | 规则 | 我们的状态 |
|---|---|---|
| 字段白名单 | 只允许 `url` `name` `category` `description` `tarball`，**出现任何其他键直接拒**（`npm:` / `stars:` 都算） | ✅ 只用了前四个 |
| 文件名 | 必须等于 `slugFor(url)`，即 `LiuJiaCheng11__dsh-postman.yml` | ✅ |
| `name` 与 `url` | 若 `name` 含 `/`，则必须与 url 的 `owner/repo` 一致（大小写不敏感） | ✅ |
| `category` | 必须在 23 个白名单值内 | ✅ `tools` |
| `description.en` | 必填、非空、**必须单行**（不能含换行） | ✅ |
| `description.zh` | 可以省略；但写了就不能为空 | ✅ |
| 其他 locale | `ja` 之类会被拒——站点只渲染 en/zh | ✅ 只有 en/zh |
| `: ` 冒号 | 描述含 `: ` 时整行必须加引号，否则 YAML 解析失败（这是最常见的投稿翻车方式） | ✅ 无冒号 |
| `tarball` | 可选；必须是 GitHub Release 托管的 https `.tgz` | — 未使用 |

**机器会拦的**（`check-submission.mjs`，全在 CI 里跑）：

1. **`package.json` 必须声明 `dsh.bundle`** —— 只声明 `dsh.client` 会被拒（这是官方文档点名的头号被拒原因）。
   我们两样都有，`dsh.bundle.patch` 指向 `./cordis.patch.yml`。✅
2. **仓库必须创建满 1 天**（`MIN_AGE_DAYS = 1`，按 `created_at` 算，没有提交数门槛）。
   ⚠️ **我们的仓库创建于 2026-10-10T08:54:25Z，提 PR 时还不满 1 天。**
   但这**不是让你等一天再提**——官方 `regate.yml` 每 6 小时自动重跑一次被年龄卡住的 PR，
   gate 自己的报错文案就写着「this check re-runs by itself… No need to resubmit, push, or close and reopen」。
   所以**直接提 PR 即可**，年龄那关会在仓库满 1 天后（约 2026-10-11 16:54 GMT+8）自己转绿，不需要重开。
3. **一个 PR 最多加 3 条**（`MAX_ENTRIES_PER_PR = 3`，超了直接拒并要求拆）。我们只加 1 条。✅
4. **仓库存在、未归档、不是 DSH 本体** ✅

**人工评审会看的**（**不**在 CI 里，但 PR 模板会要求你逐条自查）：

5. **仓库要打 `dsh-plugin` topic** —— ⚠️ **当前 topics 是空的，必须补上**。
   去 https://github.com/LiuJiaCheng11/dsh-postman 点 About 面板右上角的**齿轮**，
   在弹出的 Edit repository metadata 对话框里，Topics 一行输入 `dsh-plugin` 回车，
   顺带加 `postman` `deepseek-harness`，然后点 Save changes。
6. **描述必须属实**，会被逐句对照代码核。所以描述里的「9 个工具」必须真有 9 个，
   提到的能力必须在代码里找得到——`postman_list/tree/add/rm/edit/pull/push/scan/config` 正好 9 个。
   ⚠️ 之前写的是「Zero dependencies / 零依赖」，但 `package.json` 里有
   `@deepseek-ai/schemastery`，**和本仓库 README 第 12 行的说法也自相矛盾**，属于会被打回的夸大，已删掉。
7. **不与其他条目重复**。列表里已有 `zhousun55-byte__dsh-postman.yml`，但那是**别人的文件上传插件**
   （category `ui`，路由 `/dsh-postman/upload`），与我们的 url、name、功能都不同，**不构成重复**。
8. **只动自己那一条**。更新条目时不要顺手改别人的描述——gate 会列出 PR 修改的每一个既有条目，
   被发现就是打回。也不要手工编辑 README。

### 步骤

#### 前置：先本地彩排

```sh
# 0. 先确保改动都推上去了（CI 读的是 GitHub 上的 package.json，不是本地的）
git push

# 1. 把官方校验规则过一遍（需先 npm i -D js-yaml）
npm run check:marketplace
```

#### 路径 A：网页操作（不用装 git）

⚠️ **顺序不能反：先 fork，再在 fork 里提交文件。**
直接打开上游的 `/compare` 页面会看到 **Create pull request 是灰的**——因为 base 和 head
都指向上游同一个仓库的同一个分支，没有差异可比。compare 页面是「比出差异」，不是「发起投稿」。

1. 打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork ，点 **Create fork**。
   得到 `github.com/LiuJiaCheng11/awesome-dsh-plugin`。
2. **在你的 fork 里**（不是上游）点 **Add file** → **Create new file**。
3. 文件名填 `data/plugins/LiuJiaCheng11__dsh-postman.yml`
   —— 输入 `/` 时 GitHub 会自动把前面那段建成目录，不用手动建文件夹。
4. 粘贴 [`marketplace/LiuJiaCheng11__dsh-postman.yml`](marketplace/LiuJiaCheng11__dsh-postman.yml)
   的 6 行内容。
5. 点 **Commit changes…** → **Commit changes**（提交到 `main` 即可）。
6. 回到 fork 首页，顶部会出现横幅
   「This branch is 1 commit ahead of awesome-dsh-plugin:main」→ 点 **Contribute** →
   **Open pull request**。

> 第 5 步之后也可以直接用这个 URL（会自动展开表单）：
> `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/compare/main...LiuJiaCheng11:awesome-dsh-plugin:main?expand=1`

#### 路径 B：命令行

```sh
git clone git@github.com:LiuJiaCheng11/awesome-dsh-plugin.git
cd awesome-dsh-plugin
mkdir -p data/plugins
cp <本仓库>/marketplace/LiuJiaCheng11__dsh-postman.yml data/plugins/
git checkout -b add-dsh-postman
git add data/plugins/LiuJiaCheng11__dsh-postman.yml
git commit -m "Add LiuJiaCheng11/dsh-postman"
git push -u origin add-dsh-postman
```

然后按 GitHub 输出的链接开 PR。

#### PR 提交后

- **按 `.github/pull_request_template.md` 的清单逐项勾选**（六条勾选框）。我们只加 1 条，上限是 3 条。
- **只加文件，不要手工改 README**（README 由 `main` 上自动重新生成）。
- CI 跑完后：年龄那关可能是红的——**不用管，也别重开 PR**，`regate.yml` 会在 6 小时内自动重跑。
  其他检查若报错，会在 PR 评论里写明改什么，在**同一分支**推修复即可，无需重开。
- 合并后站点 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 与 `dshmarket` 面板自动收录。

> **维护者会实际读仓库。** 评审看的六件事里包括「代码是否与描述一致」「是否真实可用」「源码有无可疑之处」。
> 所以推之前记得确认远端 `package.json` 的 `repository` 不是占位符——那笔修复（`42530c4`）
> 一度没推，远端读到的还是 `USERNAME`，现已推送。

### 可选但推荐（不是门槛）

- **发 npm 包**：预构建安装免 `allowBuilds` 授权，用户一条命令装好；市场还能显示下载量。
  关联条件是**已发布包的 `repository` 字段指回本仓库**（我们已指向，但见上面那条「还没推」的提醒）。
  不需要通知维护者，映射自动从 registry 采集。
- **官方 `@deepseek-ai/*` 包用 `peerDependencies` 而非 `dependencies`**，避免 profile 里出现重复运行时。
  我们目前把 `@deepseek-ai/schemastery` 放在 `dependencies`——**这是有意的**：
  `src/schemastery.js` 从 profile 的 `node_modules` 里软加载它，改成 peer 依赖后 pnpm 会把这份从 profile 移除，
  「设置 → postman」的表单会消失（代码能降级，但功能少一块）。收益不足，暂不改。
- **截图**：在自己仓库的 `package.json` 旁放 `screenshots.json` 列出 1–8 张图，
  市场详情页就能像 App Store 一样展示；以后换图推自己仓库即可，不用再提 PR。不声明也行（会从 README 抽图）。
- **预构建 tarball**：不发 npm 的话，把 `.tgz` 挂到 GitHub Release，用 `tarball:` 字段指向它。
  注意 `latest/download/` 的文件名是照字面取的——资产名带版本号的话，下次发版就会 404。

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
      ⚠️ 但该修复在 `42530c4`，**当时尚未推**——CI 与维护者读到的仍是 `USERNAME`，推之前先确认
- [x] 仓库已推送 → `git@github.com:LiuJiaCheng11/dsh-postman.git`
- [x] 市场投稿文件已生成 → `marketplace/LiuJiaCheng11__dsh-postman.yml`
- [x] GitHub 形式的安装命令已实测通过（`dsh plugin --profile web add github:LiuJiaCheng11/dsh-postman`）
- [x] 市场条目已按官方校验器规则本地彩排通过 → `npm run check:marketplace`
- [x] `dsh.bundle` manifest 已声明（CI 第 2 关）
- [ ] **`git push`**（`42530c4` 还领先 origin/main 一个提交）
- [ ] **给仓库打 `dsh-plugin` topic**（当前 topics 为空，PR 模板里有这一项自查）
- [ ] **npm 包名再确认一次**（同名 `zhousun55-byte/dsh-postman` 存在，见第 2 节）
- [ ] `version` 已递增（npm 不允许覆盖已发布版本）
- [ ] `CHANGELOG.md` 已补本次变更
- [ ] `npm run check && npm test` 全绿
- [ ] `npm run test:real` 通过（真启动验证，换端口别动 3080）
- [ ] `npm publish --dry-run` 文件清单正确（不应包含 `test/` 与 `scripts/`）
- [ ] `git tag vX.Y.Z` 并推送
- [ ] GitHub Release 写清变更（市场会用它当「更新内容」）
- [ ] 市场投稿文件 `marketplace/LiuJiaCheng11__dsh-postman.yml` 已提 PR
      （仓库年龄那关会先红，`regate.yml` 6 小时内自动重跑转绿，不用重开 PR）
- [ ] README 里的安装命令与实际包名一致
