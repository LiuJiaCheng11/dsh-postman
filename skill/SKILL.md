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
| `postman_add` | 在指定目录新增接口 | `collection` `name` `url`；可选 `method` `path` `headers` `body` `auth` `createFolder` |
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

本插件**不含任何源码解析**——它只提供单条写入能力。读代码是你的活：

```text
1. 自己读用户的代码（Java / Python / C# / Go / 随便什么），列出要加的接口：
   名称、HTTP 方法、完整 URL、请求体
2. 先 postman_tree({ collection: "App" }) 看集合里已有什么，避免重复
3. 对每个要加的接口调一次 postman_add({ collection, name, url, method, path, body })
```

几条实操建议：

- **先报告再写**：把整理好的接口清单给用户过一眼，确认后再逐个写入。
- **一次别写太多**：每次 `postman_add` 都会 `GET` + 备份 + `PUT` 整个集合。
  集合很大时（几百个请求）连续写几十条会明显变慢——分批写，写完用 `postman_tree` 复核。
- **端口不要猜**：URL 前缀（`http://localhost:8080` 之类）问用户，或从用户给的样例里取。
- **接口的 URL 必须是你自己确认过的**：插件不会替你推导路由，写进去什么就是什么。

## 硬性规则

- **`PUT` 是整体覆盖**：`postman_add` / `postman_edit` / `postman_rm` / `postman_push` 都会先 `GET` 云端最新版本
  并备份到 `~/.postman_backup/<uid>.json`。不要绕过工具直接发请求。
- **改已有接口一律用 `postman_edit`**：`postman_edit` 是就地 patch，会保留 `event`（Pre-request/Tests 脚本）、
  `response`（示例响应）、`protocolProfileBehavior` 等它不认识的字段。`rm` + `add` 会把这些**静默丢掉**。
- **`postman_tree` 输出可能被截断**：默认上限 400 行，被截断时返回末尾会有 `⚠️ 输出已截断` 的显式提示。
  看到提示就改用 `path` 只看某个目录，或调大 `limit`，**不要**当作「树就这么大」。
- **写操作前必须让用户确认**：删除接口、`postman_push` 覆盖集合、批量 `postman_add`，
  都属于破坏性操作，先说明「要改什么、影响多少条」再执行。
- **不要猜集合名**：`postman_list` 拿到真实名称再用。
- **同目录不可重名**：`postman_add` 遇到同名会报错（想改已有的请用 `postman_edit`）；
  `postman_edit` 的 `newName` 撞到同层已有名字也会报错。
- **批量写入先报告清单**：你从代码里整理出的接口，先给用户确认再写。插件不校验你的路由推导，
  写错了它不会拦你。
