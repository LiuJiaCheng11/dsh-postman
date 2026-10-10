'use strict'

/**
 * dsh-postman — Host 半边。
 *
 * 把 Postman 云端集合的读写能力作为模型可见工具暴露给 dsh：
 *   postman_list / postman_tree / postman_add / postman_rm / postman_pull /
 *   postman_push / postman_config
 *
 * 同时在 webServer 上挂一个配置页（/dsh-postman），用于填写 Postman API Key。
 *
 * 设计取舍：
 *   - 零外部依赖（只用 node: 内置模块），最大化可移植性与加载成功率；
 *   - 工具定义直接构造 `ToolDefinition` 形状（name/description/parameters/
 *     output/execute），不 import @deepseek-ai/dsh-tools —— register() 只要求
 *     普通对象 + 受支持子集的 JSON Schema（type/properties/required/
 *     additionalProperties/items/enum/description）；
 *   - API Key 的持久化落在 ~/.dsh/dsh-postman/config.json，与 dsh 自身的
 *     storage 服务解耦，避免硬依赖。
 *
 * @module dsh-postman
 */

const api = require('./postman-api.js')
const { CONFIG_PAGE } = require('./page.js')

/** 工具协作超时预算（ms）。 */
const TOOL_TIMEOUT_MS = 120000

/** 配置接口允许的最大请求体。 */
const MAX_BODY_BYTES = 16 * 1024

/** 工具输出契约：单个 { text } 渲染成一个 text ContentBlock。 */
function textOutput() {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    render(_args, value) {
      return [{ type: 'text', text: String(value && value.text !== undefined ? value.text : '') }]
    },
  }
}

/**
 * 把一条工具规格编译成注册用的 ToolDefinition。
 * @param {object} spec 工具规格（name/description/parameters/run）。
 * @param {object} deps 运行时依赖（取 Key、日志）。
 * @returns {object} ToolDefinition。
 */
function compileTool(spec, deps) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    timeoutMs: TOOL_TIMEOUT_MS,
    output: textOutput(),
    async execute(args) {
      const keyInfo = deps.resolveKey()
      if (!keyInfo.key) {
        throw new Error(
          '尚未配置 Postman API Key。请打开插件配置页 http://127.0.0.1:' +
            deps.port() +
            '/dsh-postman 填写，或设置 POSTMAN_API_KEY 环境变量。'
        )
      }
      return spec.run(args || {}, { key: keyInfo.key, keySource: keyInfo.source, deps })
    },
  }
}

/** 工具规格集合。 */
const TOOL_SPECS = [
  {
    name: 'postman_list',
    description:
      '列出当前 Postman 账号下的所有集合（名称 + uid + 请求数）。用于确认集合名称，再做后续读写。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, { key }) {
      const cols = await api.listCollections(key)
      if (cols.length === 0) return { text: '账号下没有任何集合。' }
      const lines = cols.map((c) => `  ${c.name}  uid=${c.uid}`)
      return { text: `共 ${cols.length} 个集合：\n${lines.join('\n')}` }
    },
  },
  {
    name: 'postman_tree',
    description:
      '以缩进文本展示某个 Postman 集合的目录树与接口清单（方法 + URL）。用于了解集合结构、定位目标目录。',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称或 uid。' },
      },
      required: ['collection'],
      additionalProperties: false,
    },
    async run(args, { key }) {
      const meta = await api.resolveCollection(key, args.collection)
      const col = await api.getCollection(key, meta.uid, false)
      const items = col.item || []
      const header = `${meta.name}  (${api.countRequests(items)} 个请求)  uid=${meta.uid}`
      const tree = api.renderTree(items)
      return { text: tree.length ? `${header}\n${tree.join('\n')}` : `${header}\n（空集合）` }
    },
  },
  {
    name: 'postman_add',
    description:
      '在指定 Postman 集合的某个目录下新增一个接口请求。写操作前会自动拉取最新版本并备份。' +
      'path 支持多级（如 "测试" 或 "Attendance/Leave"），留空表示加到集合根层；目录不存在时可自动创建。',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称或 uid。' },
        name: { type: 'string', description: '接口名称（同一目录下不可重名）。' },
        url: { type: 'string', description: '完整请求 URL。' },
        method: { type: 'string', description: 'HTTP 方法，默认 GET。' },
        path: { type: 'string', description: '目录路径，如 "测试"；留空=根层。' },
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: '请求头，每项形如 "Key: Value"；可多个。',
        },
        body: { type: 'string', description: 'raw 请求体文本（可选）。' },
        language: { type: 'string', description: 'body 语言，默认按内容猜 json/text。' },
        auth: { type: 'boolean', description: '为 true 时继承集合级 auth（如 oauth2）。' },
        createFolder: { type: 'boolean', description: '目录不存在时自动创建，默认 false。' },
      },
      required: ['collection', 'name', 'url'],
      additionalProperties: false,
    },
    async run(args, { key }) {
      const meta = await api.resolveCollection(key, args.collection)
      const col = await api.getCollection(key, meta.uid, true)
      const before = api.countRequests(col.item || [])
      const items = col.item || []

      let target = items
      const folderPath = args.path ? String(args.path) : ''
      if (folderPath) {
        let folder = api.findFolder(items, folderPath)
        if (!folder) {
          if (!args.createFolder) {
            throw new Error(`目录不存在：${folderPath}（把 createFolder 设为 true 可自动创建）`)
          }
          let cur = items
          for (const part of folderPath.split('/').filter((p) => p !== '')) {
            let next = cur.find((it) => Array.isArray(it.item) && it.name === part)
            if (!next) {
              next = { name: part, item: [] }
              cur.push(next)
            }
            cur = next.item
          }
          folder = api.findFolder(items, folderPath)
        }
        target = folder.item
      }

      if (api.findRequestShallow(target, args.name)) {
        throw new Error(`该目录下已存在同名请求：${args.name}`)
      }

      const headers = Array.isArray(args.headers)
        ? args.headers
            .filter((h) => typeof h === 'string' && h.includes(':'))
            .map((h) => ({ key: h.slice(0, h.indexOf(':')).trim(), value: h.slice(h.indexOf(':') + 1).trim() }))
        : []

      const request = {
        method: String(args.method || 'GET').toUpperCase(),
        header: headers,
        url: api.buildUrl(args.url),
      }

      if (typeof args.body === 'string' && args.body !== '') {
        const lang = args.language || (/^\s*[\[{]/.test(args.body) ? 'json' : 'text')
        request.body = { mode: 'raw', raw: args.body, options: { raw: { language: lang } } }
      }
      if (args.auth === true && col.auth) request.auth = col.auth

      target.push({ name: args.name, request, response: [] })
      await api.putCollection(key, meta.uid, col)
      const after = api.countRequests(col.item || [])
      return {
        text: `已新增「${args.name}」到 ${folderPath || '集合根层'}（${meta.name}）；请求数 ${before} → ${after}。`,
      }
    },
  },
  {
    name: 'postman_rm',
    description: '从指定 Postman 集合中按名称删除一个接口请求（递归查找第一个匹配项）。',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称或 uid。' },
        name: { type: 'string', description: '要删除的请求名称。' },
      },
      required: ['collection', 'name'],
      additionalProperties: false,
    },
    async run(args, { key }) {
      const meta = await api.resolveCollection(key, args.collection)
      const col = await api.getCollection(key, meta.uid, true)
      const before = api.countRequests(col.item || [])
      const found = api.findRequestDeep(col.item || [], args.name)
      if (!found) throw new Error(`找不到请求：${args.name}`)
      found.list.splice(found.list.indexOf(found.node), 1)
      await api.putCollection(key, meta.uid, col)
      const after = api.countRequests(col.item || [])
      return { text: `已删除「${args.name}」（${meta.name}）；请求数 ${before} → ${after}。` }
    },
  },
  {
    name: 'postman_pull',
    description: '把某个 Postman 集合导出为本地 Postman v2.1 JSON 文件。',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称或 uid。' },
        out: { type: 'string', description: '输出文件路径（.json）。' },
      },
      required: ['collection', 'out'],
      additionalProperties: false,
    },
    async run(args, { key }) {
      const meta = await api.resolveCollection(key, args.collection)
      const col = await api.getCollection(key, meta.uid, true)
      const fs = require('node:fs')
      const path = require('node:path')
      const out = path.resolve(String(args.out))
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, JSON.stringify(col, null, 2), 'utf8')
      return { text: `已导出「${meta.name}」→ ${out}（${api.countRequests(col.item || [])} 个请求）。` }
    },
  },
  {
    name: 'postman_push',
    description: '用本地 JSON 文件整体覆盖某个 Postman 集合（PUT 语义，先备份当前云端版本）。',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称或 uid。' },
        file: { type: 'string', description: '本地集合 JSON 文件路径。' },
      },
      required: ['collection', 'file'],
      additionalProperties: false,
    },
    async run(args, { key }) {
      const meta = await api.resolveCollection(key, args.collection)
      await api.getCollection(key, meta.uid, true) // 覆盖前先备份云端当前版本
      const fs = require('node:fs')
      const col = JSON.parse(fs.readFileSync(String(args.file), 'utf8'))
      await api.putCollection(key, meta.uid, col)
      return { text: `已用 ${args.file} 覆盖「${meta.name}」；请求数 ${api.countRequests(col.item || [])}。` }
    },
  },
  {
    name: 'postman_config',
    description:
      '查看/设置 Postman API Key。action=status 查看当前配置来源；action=set 配合 apiKey 写入；action=clear 清除本地保存的 Key。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'set', 'clear'], description: '操作类型。' },
        apiKey: { type: 'string', description: 'action=set 时要写入的 API Key。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async run(args, { deps }) {
      if (args.action === 'set') {
        if (typeof args.apiKey !== 'string' || args.apiKey.trim() === '') {
          throw new Error('action=set 时必须提供 apiKey。')
        }
        const file = api.saveApiKey(args.apiKey)
        return { text: `已保存 API Key 到 ${file}（权限 0600）。` }
      }
      if (args.action === 'clear') {
        const ok = api.clearApiKey()
        return { text: ok ? '已清除本地保存的 API Key。' : '本地没有可清除的 API Key 文件。' }
      }
      const info = deps.resolveKey()
      if (!info.key) return { text: '尚未配置 Postman API Key。' }
      return {
        text: `已配置：${api.maskKey(info.key)}\n来源：${info.source}` + (info.file ? `\n文件：${info.file}` : ''),
      }
    },
  },
]

// ── HTTP 辅助 ────────────────────────────────────────────────────────────────

/** 读取请求体文本，超限抛错。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 发送 JSON 响应。 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

// ── 插件主体 ─────────────────────────────────────────────────────────────────

module.exports = {
  name: 'dsh-postman',
  inject: ['tools', 'webServer', 'connection'],

  /**
   * 注册工具与配置页。
   * @param {object} ctx Cordis 上下文。
   * @param {object} [rawConfig] 插件配置（config.apiKey）。
   */
  apply(ctx, rawConfig) {
    const pluginConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}

    const info = (msg) => {
      try {
        ctx.logger.info(`dsh-postman: ${msg}`)
      } catch {
        /* ignore */
      }
    }
    const warn = (msg) => {
      try {
        ctx.logger.warn(`dsh-postman: ${msg}`)
      } catch {
        /* ignore */
      }
    }

    const deps = {
      resolveKey: () => api.resolveApiKey(pluginConfig),
      port: () => {
        try {
          return ctx.webServer.port
        } catch {
          return 3080
        }
      },
    }

    // ── 注册模型工具 ─────────────────────────────────────────────────────────
    ctx.effect(() => {
      const disposers = TOOL_SPECS.map((spec) => {
        const tool = compileTool(spec, deps)
        return ctx.tools.register(tool)
      })
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* ignore */
          }
        }
      }
    }, 'dsh-postman: tools')

    // ── 配置页与配置接口 ─────────────────────────────────────────────────────
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'prefix',
          path: '/dsh-postman',
          handler: async (req, res) => {
            // 与其它 host 路由一致的信任栅栏：Host/Origin 校验 + 浏览器认证。
            // 缺了它，任何网页都能跨站读取/改写本机的 Postman API Key。
            try {
              const rejection = ctx.connection.requestRejection(req)
              if (rejection !== undefined) {
                res.writeHead(rejection)
                res.end()
                return
              }
            } catch (error) {
              warn(`信任栅栏校验异常：${String((error && error.message) || error)}`)
            }

            let url
            try {
              url = new URL(req.url || '/', 'http://dsh.local')
            } catch {
              sendJson(res, 400, { error: 'bad url' })
              return
            }
            const pathname = url.pathname.replace(/\/+$/, '') || '/dsh-postman'

            // 配置接口
            if (pathname === '/dsh-postman/api/config') {
              if (req.method === 'GET') {
                const current = api.resolveApiKey(pluginConfig)
                sendJson(res, 200, {
                  configured: current.key !== '',
                  masked: api.maskKey(current.key),
                  source: current.source,
                  file: current.file || api.CONFIG_FILE,
                  configFile: api.CONFIG_FILE,
                })
                return
              }
              if (req.method === 'POST') {
                let payload
                try {
                  payload = JSON.parse((await readBody(req)) || '{}')
                } catch (error) {
                  sendJson(res, 400, { error: `请求体不是合法 JSON：${String(error && error.message)}` })
                  return
                }
                try {
                  const file = api.saveApiKey(payload && payload.apiKey)
                  const result = { ok: true, file }
                  if (url.searchParams.get('verify') === '1') {
                    try {
                      const cols = await api.listCollections(String(payload.apiKey).trim())
                      result.verified = true
                      result.collections = cols.length
                    } catch (error) {
                      result.verified = false
                      result.verifyError = String((error && error.message) || error)
                    }
                  }
                  sendJson(res, 200, result)
                } catch (error) {
                  sendJson(res, 400, { error: String((error && error.message) || error) })
                }
                return
              }
              if (req.method === 'DELETE') {
                const cleared = api.clearApiKey()
                sendJson(res, 200, { ok: true, cleared })
                return
              }
              sendJson(res, 405, { error: 'method not allowed' })
              return
            }

            // 配置页
            if (pathname === '/dsh-postman' || pathname === '/dsh-postman/index.html') {
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
              res.end(CONFIG_PAGE)
              return
            }

            sendJson(res, 404, { error: 'not found' })
          },
        }),
      'dsh-postman: config page'
    )

    // ── 系统提示：让模型知道有这套工具 ───────────────────────────────────────
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
      ctx.effect(
        () =>
          systemPrompt.section({
            name: 'tool:dsh-postman',
            order: 108,
            text:
              'Postman 工具可用：用 postman_list 查看集合、postman_tree 查看结构、postman_add 新增接口、' +
              'postman_rm 删除接口、postman_pull/postman_push 导入导出。若返回「尚未配置 API Key」，' +
              '引导用户打开配置页填写。写操作是整体覆盖，工具已自动先拉取最新版并备份。',
          }),
        'dsh-postman: system prompt section'
      )
    }

    const current = api.resolveApiKey(pluginConfig)
    info(
      current.key
        ? `已就绪，API Key 来源：${current.source}；配置页 http://127.0.0.1:${deps.port()}/dsh-postman`
        : `已加载但尚未配置 API Key；请在 http://127.0.0.1:${deps.port()}/dsh-postman 填写`
    )
  },
}
