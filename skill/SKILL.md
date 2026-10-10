---
name: postman-skill
description: 用 dsh-postman 插件读写线上 Postman 集合：列出集合、查看目录树、新增/修改/删除接口、导出导入 JSON。当用户提到 Postman、接口集合、collection、API 文档同步时使用。
---

# postman-skill

通过本插件注入的 `postman_*` 工具，直接操作**线上 Postman 账号**里的集合（collection）。
所有写操作都走 Postman 官方 API，云端是唯一事实来源。

## 开始之前

1. **先确认 Key 已配置**：调用 `postman_config({ action: "status" })`。
   若返回「尚未配置」，**不要继续**，告诉用户去 **设置 → postman** 填 Postman API Key
   （`PMAK-` 开头，在 Postman 账号设置 → API Keys 生成），或设置 `POSTMAN_API_KEY` 环境变量。
   绝不要向用户索要 Key 明文，也不要把它写进任何文件或输出里。
2. **先看再改**：任何写操作前，先用 `postman_list` + `postman_tree` 确认集合名与目标目录。
   集合名可能重名，拿不准时用 uid。集合很大时用 `postman_tree` 的 `path` 参数只看某个目录。

## 工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `postman_list` | 列出账号下所有集合（名称 + uid + 请求数） | 无 |
| `postman_tree` | 展示某集合的目录树与接口清单 | `collection`；可选 `path`（只看某个目录）`limit`（默认 400 行） |
| `postman_add` | 在指定目录新增**一个**接口 | `collection` `name` `url`；可选 `method` `path` `headers` `body` `language` `description` `auth` `createFolder` |
| `postman_add_many` | **批量新增**多个接口，整批只提交一次 | `collection` `items`（数组，每项同 `postman_add` 的字段）；可选 `dryRun` `createFolder`（默认 true） |
| `postman_edit` | **就地修改**已有接口，保留 Tests 脚本/示例响应等字段 | `collection` `name`；可选 `newName` `url` `method` `headers` `body` `language` `clearBody` `description` `auth` |
| `postman_rm` | 按名称删除接口（递归找第一个匹配） | `collection` `name` |
| `postman_pull` | 导出集合为本地 Postman v2.1 JSON | `collection` `out` |
| `postman_push` | 用本地 JSON 整体覆盖集合 | `collection` `file` |
| `postman_config` | 查看/设置/清除 API Key | `action`（status/set/clear） |

## 典型流程

**新增一个接口**

```text
postman_list()
postman_tree({ collection: "App" })
postman_add({ collection: "App", path: "测试", name: "健康检查", url: "http://localhost:8080/health", method: "GET", createFolder: true })
```

**改一个已有接口** —— 用 `postman_edit`，只传要改的字段，其余原样保留。

```text
postman_tree({ collection: "App", path: "测试" })          # 先确认它在哪个目录、现在长什么样
postman_edit({ collection: "App", name: "健康检查", url: "http://localhost:8080/healthz" })
postman_edit({ collection: "App", name: "健康检查", method: "POST", body: "{\"deep\":true}", language: "json" })
postman_edit({ collection: "App", name: "健康检查", clearBody: true, description: "" })   # 清空 body、删掉描述
```

`headers` 是**整份替换**（不是合并），要保留原有 header 就先把它们一并写进去。
`body` 省略 = 不动 body；`clearBody: true` = 删掉 body（优先级高于 `body`）；只给 `language` 时要求原本已有 raw body。

**真的删接口才用 `postman_rm`。** 不要为了改内容去 `rm` + `add` —— 那会**静默丢掉**
Pre-request/Tests 脚本（`event`）、示例响应（`response`）等字段，中间还有一段时间请求不存在。

**大范围重写**（比如整份 JSON 已在本地编辑好）才用 `postman_pull` 导出 → 改 → `postman_push` 覆盖。

**按代码批量补接口**（源码 → Postman）

本插件**不含任何源码解析**——读代码是你的活，插件只负责把结果写进去。
用 `postman_add_many` 一次提交，别循环调 `postman_add`（那样每加一条都要
`GET` + 备份 + `PUT` 整个集合，几十条会慢得离谱）：

```text
1. 自己读用户的代码（Java / Python / C# / Go / 随便什么），整理成 items：
   [{ name, url, method, path, body, description }, ...]
2. postman_tree({ collection: "App" }) 看集合里已有什么，避免重复
3. 先预演：postman_add_many({ collection, items, dryRun: true })
   把报告给用户确认
4. 再真写：postman_add_many({ collection, items })
```

`items` 里每项的字段与 `postman_add` 同名同义：

| 字段 | 说明 |
|---|---|
| `name` | 必填。接口名称（同目录下不可重名） |
| `url` | 必填。完整 URL |
| `method` | 默认 GET |
| `path` | 目录路径，如 `"Attendance/Leave"`；留空=集合根层 |
| `headers` | 数组，每项 `"Key: Value"` |
| `body` / `language` | raw 请求体与其语言（不传按内容猜 json/text） |
| `description` | 接口说明（可选，适合放代码里的注释） |
| `auth` | `true` 时继承集合级 auth |

行为要点：

- **同目录同名会被跳过，不覆盖**——结果里会单独列出跳过了哪些，方便你判断
  「这条已经存在了」还是「我名字写错了」。
- `path` 指向的目录不存在时**会自动创建**（`createFolder` 默认 true，可关掉），
  新建了哪些目录会在结果里列出——**目录名打错在这里就能看出来**。
- 参数不合法（缺 `name` 或 `url`）的项会被跳过并报出第几项，不影响其余项写入。
- 一条都没写成功时**不会发起 PUT**，集合不受影响。

几条实操建议：

- **先 `dryRun` 再写**：预演报告直接给用户看，确认后再真写。
- **端口不要猜**：URL 前缀（`http://localhost:8080` 之类）问用户，或从用户给的样例里取。
- **URL 必须是你自己确认过的**：插件不会替你推导路由，写进去什么就是什么。
- 写完用 `postman_tree` 复核。

## 硬性规则

- **`PUT` 是整体覆盖**：`postman_add` / `postman_add_many` / `postman_edit` / `postman_rm` / `postman_push`
  都会先 `GET` 云端最新版本并备份到 `~/.postman_backup/<uid>.json`。不要绕过工具直接发请求。
- **改已有接口一律用 `postman_edit`**：`postman_edit` 是就地 patch，会保留 `event`（Pre-request/Tests 脚本）、
  `response`（示例响应）、`protocolProfileBehavior` 等它不认识的字段。`rm` + `add` 会把这些**静默丢掉**。
- **`postman_tree` 输出可能被截断**：默认上限 400 行，被截断时返回末尾会有 `⚠️ 输出已截断` 的显式提示。
  看到提示就改用 `path` 只看某个目录，或调大 `limit`，**不要**当作「树就这么大」。
- **写操作前必须让用户确认**：删除接口、`postman_push` 覆盖集合、`postman_add_many` 批量新增，
  都属于破坏性操作，先说明「要改什么、影响多少条」再执行。
  批量新增优先用 `dryRun: true` 出一份预演报告给用户看。
- **不要猜集合名**：`postman_list` 拿到真实名称再用。
- **同目录不可重名**：`postman_add` 遇到同名会报错（想改已有的请用 `postman_edit`）；
  `postman_edit` 的 `newName` 撞到同层已有名字也会报错。
- **批量写入先报告清单**：你从代码里整理出的接口，先给用户确认再写。插件不校验你的路由推导，
  写错了它不会拦你。
