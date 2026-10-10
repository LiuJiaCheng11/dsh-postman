# 发布指南

本插件要「上线」，需要走完三步：**推 GitHub → 发 npm → 提市场 PR**。
市场本身不托管代码，它只从 npm 安装、从精选列表读条目。

---

## 0. 先改占位符

`package.json` 里的 `repository` / `homepage` / `bugs` 目前是 `USERNAME` 占位符。
把三处 `USERNAME` 换成你的 GitHub 用户名：

```sh
cd E:/Code/DshPlugins/dsh-postman
# 把 USERNAME 替换成你的 GitHub 用户名
sed -i 's/USERNAME/你的GitHub用户名/g' package.json
```

`LICENSE` 里的署名已经是 `LiuJiaCheng`，需要的话一并改。

---

## 1. 推 GitHub

在 GitHub 上**先建一个空仓库**（不要勾选 README / .gitignore / LICENSE），
名字建议 `dsh-postman`，然后：

```sh
cd E:/Code/DshPlugins/dsh-postman

git add -A
git commit -m "chore: 填写仓库地址"
git remote add origin https://github.com/你的GitHub用户名/dsh-postman.git
git push -u origin main
```

> 仓库名与 npm 包名保持一致（都叫 `dsh-postman`）最省事。
> 若用 SSH，把地址换成 `git@github.com:用户名/dsh-postman.git`。

建议顺手加上仓库话题（Topics）：`dsh`、`dsh-plugin`、`deepseek-harness`、`postman`。

---

## 2. 发 npm

市场是**通过 npm 安装**的，所以必须先发包。包名 `dsh-postman` 已确认未被占用。

```sh
cd E:/Code/DshPlugins/dsh-postman

# 首次发布前先登录（会打开浏览器）
npm login

# 干跑一遍，确认要上传的文件清单（应该只有 9 个文件，不含 test/）
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

流程：

1. Fork [github.com/awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
2. 按仓库 README 的格式，在插件列表里加一条（通常包含 npm 包名、仓库地址、中英文简介）
3. 提 PR，说明这是一个 dsh 工具类插件
4. 合并后站点 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 与
   `dshmarket` 面板会自动收录，**通常一天内生效**

收录后，别人就能在 dsh 的 **设置 → 插件市场** 里搜到并一键安装。

> 收录不等于背书。市场文档原话：「插件是第三方代码，请只安装你信任的来源。」

---

## 附：别人怎么装

市场收录前，用户也能直接装：

```sh
# 从 npm 装（发布后）
dsh plugin --profile web add dsh-postman

# 从 GitHub 装
dsh plugin --profile web add github:你的GitHub用户名/dsh-postman

# 从本地目录装（开发时）
dsh plugin --profile web add E:/Code/DshPlugins/dsh-postman
```

装完**重启 dsh**（重新 `dsh web`）生效。之后打开
`http://127.0.0.1:3080/dsh-postman` 填 API Key。

---

## 发版检查清单

- [ ] `package.json` 三处 `USERNAME` 已替换
- [ ] `version` 已递增（npm 不允许覆盖已发布版本）
- [ ] `npm run check && npm test` 全绿
- [ ] `npm publish --dry-run` 文件清单正确（不应包含 `test/`）
- [ ] `git tag vX.Y.Z` 并推送
- [ ] GitHub Release 写清变更（市场会用它当「更新内容」）
- [ ] README 里的安装命令与实际包名一致
