# dsh-postman

一个 [dsh（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 插件：让 dsh 直接读写你的 **Postman 云端集合**。

- 提供模型可见工具：`postman_list` / `postman_tree` / `postman_add` / `postman_rm` / `postman_pull` / `postman_push` / `postman_config`
- 提供配置页（`http://127.0.0.1:<port>/dsh-postman`）用于填写 Postman API Key
- **零外部依赖**（只用 Node 内置模块），加载成功率高

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

有三种方式，优先级从高到低：

1. **插件配置**（`cordis.patch.yml` 的 `config.apiKey`，或环境变量 `POSTMAN_API_KEY`）
2. **插件设置文件** `~/.dsh/dsh-postman/config.json`（配置页写入，权限 0600）
3. **历史文件** `~/.postman_api_key`

推荐直接打开配置页填写：

```
http://127.0.0.1:3080/dsh-postman
```

页面上可以保存、保存并验证、显示/隐藏、清除 Key。

在 [Postman 账号设置 → API Keys](https://web.postman.co/settings/me/api-keys) 生成 Key（`PMAK-` 开头）。

## 工具用法

| 工具 | 作用 |
|---|---|
| `postman_list` | 列出全部集合（名称 + uid） |
| `postman_tree` | 展示某集合的目录树与接口清单 |
| `postman_add` | 在指定目录新增接口（可自动建目录、继承集合 auth） |
| `postman_rm` | 按名称删除接口 |
| `postman_pull` | 导出集合为 Postman v2.1 JSON |
| `postman_push` | 用本地 JSON 整体覆盖集合 |
| `postman_scan` | **扫描 C# 控制器，报告 / 对比 / 写入 Postman 集合** |
| `postman_config` | 查看/设置/清除 API Key |

对话示例：

> 列出我的 Postman 集合
>
> 在 App 的「测试」目录下加一个 GET 接口 http://localhost:10423/api/v1/models
>
> 把 Converter 集合导出到 D:/tmp/converter.json
>
> 扫一下 E:/Code/App/App.Business，看哪些接口还没进 Postman
>
> 把 E:/Code/App/App.Customization 里没同步的接口写进 App 集合

### postman_scan：扫代码生成接口

参数：

| 参数 | 说明 |
|---|---|
| `dir` | **必填**。源码根目录（可多次调用扫多个根，或用分号分隔） |
| `module` | 只扫某个业务模块（如 `App.Attendance`） |
| `collection` | 指定集合名；给出后进入**对比模式** |
| `import` | `true` 时进入**写入模式**，把缺失接口写进集合 |
| `folder` | 写入时用的目标目录（默认 `源码同步`） |
| `baseUrl` | 生成 URL 时替换协议+主机，如 `http://localhost:10423` |
| `limit` | 最多返回多少条（防止报告过长） |

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
- API Key 只存本机，不会外发。
- 配置接口挂了与 dsh 其它 host 路由一致的信任栅栏（`connection.requestRejection`），拒绝跨站调用。

## 目录结构

```
dsh-postman/
  package.json          # 声明 dsh.bundle.patch
  cordis.patch.yml      # 插件装配补丁（insert 一行）
  src/
    index.js            # 插件入口：注册工具 + 配置页
    postman-api.js      # Postman API 客户端（零依赖）
    route-scanner.js    # C# 控制器路由扫描器（零依赖）
    page.js             # 配置页 HTML
  test/
    smoke.js            # 冒烟测试（假 ctx 加载 + 真实 list 调用）
    scanner.js          # 扫描器单测（内联 fixture，5 组断言）
```

## 开发

```sh
cd E:/Code/DshPlugins/dsh-postman
npm run check        # node --check 四个源文件
node test/smoke.js   # 插件装配 + 工具注册 + 路由
node test/scanner.js # 扫描器单测
```

## 实测数据

在本机 `E:\Code\App` 上的扫描结果（可作为参考）：

| 源码根 | 模块数 | 路由数 |
|---|---|---|
| `App.Business` | 46 | 3938 |
| `20250520/App.Core` | 12 | 560 |
| `App.Customization` | 15 | 504 |

三根合计约 5000 条路由。与 Postman 内 App 集合（518 请求）比对，覆盖率 **73.6%**（381/518）；
未匹配的多为第三方服务（如 `/wv/wordviewer/request.pdf`、`/docs/api/local/...`）或已变更接口。
