---
name: postman-skill
description: 用 dsh-postman 插件读写线上 Postman 集合：列出集合、查看目录树、新增/删除接口、导出导入 JSON、扫源码补齐接口。当用户提到 Postman、接口集合、collection、API 文档同步时使用。
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
   集合名可能重名，拿不准时用 uid。

## 工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `postman_list` | 列出账号下所有集合（名称 + uid + 请求数） | 无 |
| `postman_tree` | 展示某集合的目录树与接口清单 | `collection` |
| `postman_add` | 在指定目录新增接口 | `collection` `name` `url`；可选 `method` `path` `headers` `body` `auth` `createFolder` |
| `postman_rm` | 按名称删除接口（递归找第一个匹配） | `collection` `name` |
| `postman_pull` | 导出集合为本地 Postman v2.1 JSON | `collection` `out` |
| `postman_push` | 用本地 JSON 整体覆盖集合 | `collection` `file` |
| `postman_scan` | 扫源码提取路由，报告/对比/写入集合 | `dir`；可选 `collection` `import` `folder` `baseUrl` `module` `limit` |
| `postman_config` | 查看/设置/清除 API Key | `action`（status/set/clear） |

## 典型流程

**新增一个接口**

```text
postman_list()
postman_tree({ collection: "App" })
postman_add({ collection: "App", path: "测试", name: "健康检查", url: "http://localhost:8080/health", method: "GET", createFolder: true })
```

**改接口前先确认现状** —— 没有「改」这个动作，改 = 删掉再新增，或 `postman_pull` 导出改完 `postman_push` 覆盖。

**批量补接口**（源码 → Postman）

```text
postman_scan({ dir: "D:/src/MyApi", collection: "App" })              # 只报告差异
postman_scan({ dir: "D:/src/MyApi", collection: "App", import: true, baseUrl: "http://localhost:8080" })
```

`dir` 支持多个根，用逗号/分号分隔。`baseUrl` 决定写进集合的 URL 前缀，
**不要替用户猜端口**——不知道就问，或让用户自己传。

## 硬性规则

- **`PUT` 是整体覆盖**：`postman_add` / `postman_rm` / `postman_push` 都会先 `GET` 云端最新版本
  并备份到 `~/.postman_backup/<uid>.json`。不要绕过工具直接发请求。
- **写操作前必须让用户确认**：删除接口、`postman_push` 覆盖集合、`postman_scan import=true`
  批量写入，都属于破坏性操作，先说明「要改什么、影响多少条」再执行。
- **不要猜集合名**：`postman_list` 拿到真实名称再用。
- **同目录不可重名**：`postman_add` 遇到同名会报错，换名字或先删。
- **报告优先**：不确定时先跑不带 `import` 的 `postman_scan`，让用户看过差异再写入。
