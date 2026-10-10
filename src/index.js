'use strict'

/**
 * dsh-postman — Host 半边。
 *
 * 把 Postman 云端集合的读写能力作为模型可见工具暴露给 dsh：
 *   postman_list / postman_tree / postman_add / postman_edit / postman_rm /
 *   postman_pull / postman_push / postman_scan / postman_config
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
const scanner = require('./route-scanner.js')
const { CONFIG_PAGE } = require('./page.js')
const { loadSchemastery } = require('./schemastery.js')

/** 工具协作超时预算（ms）。 */
const TOOL_TIMEOUT_MS = 120000

/** 配置接口允许的最大请求体。 */
const MAX_BODY_BYTES = 16 * 1024

// ── 设置页（dsh 的「设置 → postman」） ────────────────────────────────────────
//
// dsh 的设置页 schema 直接取 `entry.fiber.runtime.Config`（见 @deepseek-ai/dsh-settings
// 的 `schema(entry)`）。没有这个导出，本插件在设置里就是一个没有表单的空页
// （`--dump-config-schema` 里表现为 unknownConfig）。
//
// apiKey 标 role('secret')，dsh 会在读取时把值抹掉、只回一个 `set: true/false`，
// 所以 Key 明文不会流到浏览器。写回走 profile 的 user 配置层，插件会被热重载。

/** @type {object|undefined} */
let Config
{
  const z = loadSchemastery()
  if (z) {
    try {
      Config = z.object({
        apiKey: z
          .string()
          .role('secret')
          .default('')
          // 必须标 volatile：dsh 的 settings 用 volatileForm() 过滤表单，
          // 非 volatile 的叶子字段会被丢弃；一个字段都不剩时整个条目被滤掉，
          // 设置里就不会出现这一页（见 @deepseek-ai/dsh-settings 的 src/schema.ts）。
          //
          // 这里用 extra('volatile', true) 而不是 .volatile()：后者是
          // schemastery 3.18.4 才有的语法糖（实现就是 this.extra('volatile', true)），
          // 而 dsh 运行时可能加载 3.18.1（没有该方法，会直接抛错）。
          .extra('volatile', true)
          .description(
            'Postman API Key（PMAK- 开头）。留空则依次回退到 ~/.dsh/dsh-postman/config.json、' +
              '~/.postman_api_key、POSTMAN_API_KEY 环境变量。'
          ),
      })
    } catch (error) {
      Config = undefined
    }
  }
}

/**
 * 解开 cordis 的 Volatile 包装。
 *
 * schema 标了 volatile 的字段，插件拿到的不是裸值而是一个引用对象（有 `.get()`）。
 * dsh 自己的插件也是这么处理的（如 `llm-deepseek-api-key` 里的 `config.apiKeyEnv.get()`）。
 * 这里做一次归一化，让下游只面对普通值。
 *
 * @param {unknown} value 配置里的一个字段值。
 * @returns {unknown} 解包后的普通值。
 */
function unwrapVolatile(value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/**
 * 归一化插件配置：解 Volatile 包装，保证是个普通对象。
 * @param {unknown} rawConfig cordis 传入的插件配置。
 * @returns {object} 普通对象形式的配置。
 */
function normalizeConfig(rawConfig) {
  if (rawConfig === null || rawConfig === undefined || typeof rawConfig !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(rawConfig)) out[key] = unwrapVolatile(value)
  return out
}

// ── 技能（斜杠命令 /postman-skill） ──────────────────────────────────────────
/** 技能名（kebab-case，作为 /postman-skill 的标识）。 */
const SKILL_NAME = 'postman-skill'

/** 技能路由描述，出现在技能目录与斜杠菜单里。 */
const SKILL_DESCRIPTION =
  '用 dsh-postman 插件读写线上 Postman 集合：列出集合、查看目录树、新增/删除接口、导出导入 JSON、扫源码补齐接口。'

/** 技能资源目录（相对路径按此解析）。 */
const SKILL_DIR = require('node:path').join(__dirname, '..', 'skill')

/** 读取技能正文（读不到就返回 null，插件照常工作）。 */
function readSkillMarkdown() {
  try {
    return require('node:fs').readFileSync(require('node:path').join(SKILL_DIR, 'SKILL.md'), 'utf8')
  } catch {
    return null
  }
}

/**
 * 把技能注册进 dsh 的技能目录。
 *
 * 这里同时做「插件级」与「agent 级」两次注册，对齐 `browser-skill-dsh-plugin`
 * 的做法：DSH 的技能分层是 nearest-first（agent -> preset -> global），
 * 只在插件级注册时，磁盘上同名的 preset 技能会把它盖掉。
 * 没有 `skills` 服务（或没有 `agents`）时静默降级。
 *
 * @param {object} ctx Cordis 上下文。
 * @returns {() => void} 释放函数。
 */
function armSkill(ctx) {
  const skills = ctx.get('skills')
  if (skills === null || skills === undefined || typeof skills.register !== 'function') return () => {}
  const content = readSkillMarkdown()
  if (content === null) return () => {}

  const definition = () => ({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    content,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: SKILL_DIR },
  })

  /** @type {Map<object, () => void>} */
  const perAgent = new Map()
  const disposers = []

  // 插件级（global 层）
  try {
    const dispose = skills.register(definition())
    if (typeof dispose === 'function') disposers.push(dispose)
  } catch {
    /* ignore */
  }

  // agent 级：新 agent 走 agent/created，已存在的立刻注册
  const registerForAgent = (agent) => {
    if (!agent || perAgent.has(agent)) return
    const agentSkills = agent.ctx && agent.ctx.get ? agent.ctx.get('skills') : undefined
    if (agentSkills === null || agentSkills === undefined || typeof agentSkills.register !== 'function') return
    try {
      const dispose = agentSkills.register(definition())
      perAgent.set(agent, typeof dispose === 'function' ? dispose : () => {})
    } catch {
      /* ignore */
    }
  }

  if (typeof ctx.on === 'function') {
    const stopCreated = ctx.on('agent/created', ({ agent }) => registerForAgent(agent))
    const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
      const dispose = perAgent.get(agent)
      if (dispose) dispose()
      perAgent.delete(agent)
    })
    disposers.push(stopCreated, stopDisposed)
  }

  const agents = ctx.get('agents')
  if (agents !== null && agents !== undefined && typeof agents.list === 'function') {
    try {
      for (const agent of agents.list()) registerForAgent(agent)
    } catch {
      /* ignore */
    }
  }

  return () => {
    for (const dispose of [...perAgent.values()].reverse()) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
    perAgent.clear()
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
    disposers.length = 0
  }
}

/** 工具输出契约：单个 { text } 渲染成一个 text ContentBlock。 */
function textOutput() {  return {
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
          '尚未配置 Postman API Key。请在 dsh 的「设置 → postman」里填写，' +
            '或设置 POSTMAN_API_KEY 环境变量（也可以打开 http://127.0.0.1:' +
            deps.port() +
            '/dsh-postman 用备用页填写）。'
        )
      }
      return spec.run(args || {}, { key: keyInfo.key, keySource: keyInfo.source, deps })
    },
  }
}

// ── 源码扫描辅助 ─────────────────────────────────────────────────────────────

/** 把 URL / 路径归一化成可比较的键（去协议主机、去查询串、去尾斜杠、小写）。 */
function normalizeRoutePath(raw) {
  let p = String(raw || '').replace(/^https?:\/\/[^/]+/i, '')
  p = p.split('?')[0]
  try {
    p = decodeURIComponent(p)
  } catch {
    /* 保留原样 */
  }
  return p.replace(/\/+$/, '').toLowerCase()
}

/** 解析 dir 参数：支持字符串（逗号/分号/换行分隔）或数组。 */
function parseRoots(dir) {
  if (Array.isArray(dir)) return dir.map((d) => String(d).trim()).filter(Boolean)
  return String(dir || '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 把 ["Key: Value", ...] 解析成 Postman 的 header 数组。
 * 没有冒号的项直接丢掉（免得把裸字符串塞进集合）。
 * @param {unknown} raw headers 参数原值。
 * @returns {Array<{key: string, value: string}>} Postman header 列表。
 */
function parseHeaders(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((h) => typeof h === 'string' && h.includes(':'))
    .map((h) => ({
      key: h.slice(0, h.indexOf(':')).trim(),
      value: h.slice(h.indexOf(':') + 1).trim(),
    }))
}

/** 按内容猜 body 的 raw language（`{`/`[` 开头当 json，否则 text）。 */
function guessLanguage(body, explicit) {
  if (typeof explicit === 'string' && explicit !== '') return explicit
  return /^\s*[\[{]/.test(String(body)) ? 'json' : 'text'
}

/** 在 Postman item 树里按路径逐级取/建目录，返回末级目录的 item 数组。 */
function ensureFolderChain(items, parts) {
  let cur = items
  for (const part of parts) {
    let node = cur.find((it) => Array.isArray(it.item) && it.name === part)
    if (!node) {
      node = { name: part, item: [] }
      cur.push(node)
    }
    cur = node.item
  }
  return cur
}

/** 收集集合里全部请求的归一化路径集合。 */
function collectCollectionPaths(items, out = new Set()) {
  for (const it of items || []) {
    if (Array.isArray(it.item)) collectCollectionPaths(it.item, out)
    else {
      const u = it.request && it.request.url
      const raw = u && typeof u === 'object' ? u.raw : u
      if (raw) out.add(normalizeRoutePath(raw))
    }
  }
  return out
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
      '以缩进文本展示某个 Postman 集合的目录树与接口清单（方法 + URL）。用于了解集合结构、定位目标目录。' +
      '集合很大时输出会被截断 —— 传 path 只看某个目录（推荐），或调大 limit。',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称或 uid。' },
        path: {
          type: 'string',
          description:
            '只看某个目录的子树，如 "Discipline/EvaluateIndicator"（多级用 / 分隔）。留空看整棵树。',
        },
        limit: { type: 'number', description: '最多渲染多少行，默认 400。' },
      },
      required: ['collection'],
      additionalProperties: false,
    },
    async run(args, { key }) {
      const meta = await api.resolveCollection(key, args.collection)
      const col = await api.getCollection(key, meta.uid, false)
      const items = col.item || []

      // 只看子树：先把范围缩到一个目录，输出量就跟集合大小解耦了
      let scope = items
      let scopeLabel = ''
      if (typeof args.path === 'string' && args.path.trim() !== '') {
        const wanted = args.path.trim()
        const folder = api.findFolder(items, wanted)
        if (!folder) {
          const tops = api.listFolderNames(items)
          throw new Error(
            `目录不存在：${wanted}。集合「${meta.name}」的顶层目录：${tops.join('、') || '（无）'}`,
          )
        }
        scope = folder.item
        scopeLabel = ` › ${wanted}`
      }

      const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 400
      const header = `${meta.name}${scopeLabel}  (${api.countRequests(scope)} 个请求)  uid=${meta.uid}`
      const { lines, total, truncated } = api.renderTreeCapped(scope, limit)

      if (total === 0) return { text: `${header}\n（空目录）` }

      const body = lines.join('\n')
      if (!truncated) return { text: `${header}\n${body}` }

      // 截断了就明说，并把「可以往哪钻」直接给出来，别让模型在残树上猜
      const tops = api.listFolderNames(items)
      return {
        text: [
          header,
          body,
          '',
          `⚠️ 输出已截断：只渲染了前 ${lines.length} 行（该范围共 ${total} 项）。`,
          `请用 path 参数只看某个目录再继续，或调大 limit。`,
          tops.length > 0 ? `顶层目录：${tops.join('、')}` : '',
        ]
          .filter((line) => line !== '')
          .join('\n'),
      }
    },
  },
  {
    name: 'postman_add',
    description:
      '在指定 Postman 集合的某个目录下新增一个接口请求。写操作前会自动拉取最新版本并备份。' +
      'path 支持多级（如 "测试" 或 "Attendance/Leave"），留空表示加到集合根层；目录不存在时可自动创建。' +
      '同目录下已有同名请求时会报错 —— 想改已有的请用 postman_edit。',
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

      const headers = parseHeaders(args.headers)

      const request = {
        method: String(args.method || 'GET').toUpperCase(),
        header: headers,
        url: api.buildUrl(args.url),
      }

      if (typeof args.body === 'string' && args.body !== '') {
        const lang = guessLanguage(args.body, args.language)
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
    name: 'postman_edit',
    description:
      '就地修改集合里**已存在**的一个接口请求（按名称递归定位，改第一个匹配项）。只动传入的字段，' +
      '其余字段（含 Tests / Pre-request 脚本、示例响应、protocolProfileBehavior）原样保留。' +
      '**要改已有接口就用它** —— 不要用 postman_rm + postman_add，那条路会静默丢掉上述字段，' +
      '而且两次 PUT 之间请求是不存在的。写操作前会自动拉取最新版本并备份。',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称或 uid。' },
        name: { type: 'string', description: '要修改的请求的当前名称。' },
        newName: { type: 'string', description: '改名字（同目录下不能重名）。' },
        url: { type: 'string', description: '新的完整请求 URL。' },
        method: { type: 'string', description: '新的 HTTP 方法。' },
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: '整份替换请求头，每项形如 "Key: Value"。不传则保持原样。',
        },
        body: { type: 'string', description: '新的 raw 请求体文本。不传则保持原样；要清空请用 clearBody。' },
        language: { type: 'string', description: 'body 语言（json/text 等）；只改语言不改内容时可单独传。' },
        clearBody: { type: 'boolean', description: 'true 时彻底移除请求体。' },
        description: { type: 'string', description: '新的接口说明；传空字符串即删除说明。' },
        auth: { type: 'boolean', description: 'true 继承集合级 auth；false 移除请求级 auth。' },
      },
      required: ['collection', 'name'],
      additionalProperties: false,
    },
    async run(args, { key }) {
      const meta = await api.resolveCollection(key, args.collection)
      const col = await api.getCollection(key, meta.uid, true) // 覆盖前先备份云端当前版本
      const found = api.findRequestDeep(col.item || [], args.name)
      if (!found) throw new Error(`找不到请求：${args.name}`)

      const node = found.node
      if (node.request === null || typeof node.request !== 'object') node.request = {}
      const request = node.request
      const changes = []

      // 改名：先查重名，免得悄悄造出两个同名请求
      if (typeof args.newName === 'string' && args.newName.trim() !== '') {
        const next = args.newName.trim()
        if (next !== node.name) {
          const clash = found.list.some((it) => it !== node && !Array.isArray(it.item) && it.name === next)
          if (clash) throw new Error(`同目录下已存在同名请求：${next}`)
          changes.push(`名称 ${node.name} → ${next}`)
          node.name = next
        }
      }

      if (typeof args.method === 'string' && args.method.trim() !== '') {
        request.method = args.method.trim().toUpperCase()
        changes.push(`方法 → ${request.method}`)
      }

      if (typeof args.url === 'string' && args.url.trim() !== '') {
        const next = args.url.trim()
        request.url = api.buildUrl(next)
        changes.push(`URL → ${next}`)
      }

      if (Array.isArray(args.headers)) {
        request.header = parseHeaders(args.headers)
        changes.push(`请求头 → ${request.header.length} 条`)
      }

      // 请求体：clearBody 优先；给了 body 就整体替换；只给了 language 就只改语言
      if (args.clearBody === true) {
        if (request.body !== undefined) changes.push('请求体已清除')
        delete request.body
      } else if (typeof args.body === 'string' && args.body !== '') {
        const lang = guessLanguage(args.body, args.language)
        request.body = { mode: 'raw', raw: args.body, options: { raw: { language: lang } } }
        changes.push(`请求体已更新（${lang}）`)
      } else if (typeof args.language === 'string' && args.language !== '') {
        if (request.body !== undefined && request.body.mode === 'raw') {
          request.body.options = { ...(request.body.options || {}), raw: { language: args.language } }
          changes.push(`请求体语言 → ${args.language}`)
        } else {
          throw new Error('要改 language 需要该请求已有 raw 请求体；没有的话请一起传 body。')
        }
      }

      if (typeof args.description === 'string') {
        if (args.description === '') {
          delete request.description
          changes.push('说明已删除')
        } else {
          request.description = args.description
          changes.push('说明已更新')
        }
      }

      if (args.auth === true) {
        if (!col.auth) throw new Error('该集合没有集合级 auth，无法继承。')
        request.auth = col.auth
        changes.push('已继承集合 auth')
      } else if (args.auth === false) {
        delete request.auth
        changes.push('已移除请求级 auth')
      }

      if (changes.length === 0) {
        throw new Error(
          '没有提供任何要修改的字段。可用：newName / url / method / headers / body / language / clearBody / description / auth。',
        )
      }

      await api.putCollection(key, meta.uid, col)
      return {
        text: `已更新「${args.name}」：${changes.join('；')}（${meta.name}）；请求数 ${api.countRequests(
          col.item || [],
        )}。`,
      }
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
    name: 'postman_scan',
    description:
      '扫描 C# / ASP.NET Core 源码（*Controller.cs）提取接口路由：按 [Area]/类名/方法名 推导 ' +
      '/api/{模块}/{控制器}/{方法}，并抽取 HTTP 动词、XML 摘要、参数与权限。' +
      '给了 collection 就与 Postman 集合对比并列出差异；import=true 时把集合中缺失的接口写入集合。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '源码根目录；多个用逗号或分号分隔。' },
        module: { type: 'string', description: '只保留某个模块（Area），如 Attendance。' },
        collection: { type: 'string', description: 'Postman 集合名或 uid；给了就做差异对比。' },
        import: { type: 'boolean', description: 'true 时把集合缺失的接口写入（默认 false，只报告）。' },
        folder: { type: 'string', description: '导入时使用的顶层目录名，默认「源码同步」。' },
        baseUrl: {
          type: 'string',
          description: '写入 URL 的前缀（如 http://localhost:8080）。不传时用 http://localhost。',
        },
        limit: { type: 'number', description: '清单渲染条数上限，默认 150。' },
      },
      required: ['dir'],
      additionalProperties: false,
    },
    async run(args, { key }) {
      const roots = parseRoots(args.dir)
      if (roots.length === 0) throw new Error('dir 不能为空。')
      const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 150

      // 1) 扫描（多个根可能重叠，后面按路径去重）
      const scanned = []
      const all = []
      for (const root of roots) {
        const result = scanner.scanDirectory(root)
        all.push(...result.routes)
        scanned.push({
          root: result.stats.root,
          count: result.stats.routeCount,
          controllers: result.stats.controllerFiles,
          warnings: result.warnings.length,
        })
      }

      let list = all
      if (args.module) {
        const want = String(args.module).toLowerCase()
        list = list.filter((r) => r.area.toLowerCase() === want)
      }
      const dedup = new Map()
      for (const r of list) {
        const k = normalizeRoutePath(r.path)
        if (!dedup.has(k)) dedup.set(k, r)
      }
      list = [...dedup.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

      const header = scanned.map((s) => `  ${s.root} → ${s.count} 条 / ${s.controllers} 个控制器`).join('\n')

      // 2) 纯报告模式
      if (!args.collection) {
        const byArea = new Map()
        for (const r of list) byArea.set(r.area, (byArea.get(r.area) || 0) + 1)
        const areaLines = [...byArea.entries()].sort().map(([a, n]) => `  ${a} (${n})`)
        return {
          text: [
            `扫描完成：${list.length} 条路由${args.module ? `（仅模块 ${args.module}）` : ''}`,
            header,
            '',
            '模块分布：',
            areaLines.join('\n') || '  （无）',
            '',
            '清单：',
            scanner.renderRoutes(list, limit),
          ].join('\n'),
        }
      }

      // 3) 与集合对比
      const meta = await api.resolveCollection(key, args.collection)
      const col = await api.getCollection(key, meta.uid, true)
      const existing = collectCollectionPaths(col.item || [])
      const missing = list.filter((r) => !existing.has(normalizeRoutePath(r.path)))

      const lines = [
        `集合「${meta.name}」已有 ${existing.size} 条路径；源码扫出 ${list.length} 条（去重后）。`,
        header,
        '',
        `✅ 集合里已有：${list.length - missing.length} 条`,
        `🆕 集合里缺失：${missing.length} 条`,
      ]

      if (missing.length === 0) {
        lines.push('', '集合已与源码完全同步，无需补充。')
        return { text: lines.join('\n') }
      }

      const byArea = new Map()
      for (const r of missing) byArea.set(r.area, (byArea.get(r.area) || 0) + 1)
      lines.push('', '缺失分布：', [...byArea.entries()].sort().map(([a, n]) => `  ${a} (${n})`).join('\n'))
      lines.push('', '缺失清单：', scanner.renderRoutes(missing, limit))

      if (args.import !== true) {
        lines.push('', '（当前仅报告。把 import 设为 true 即写入集合。）')
        return { text: lines.join('\n') }
      }

      // 4) 写入缺失项：集合 → <folder>/<模块>/<控制器>/<控制器.方法>
      const baseUrl = String(args.baseUrl || 'http://localhost').replace(/\/+$/, '')
      const topFolder = String(args.folder || '源码同步')
      let added = 0
      for (const r of missing) {
        const folder = ensureFolderChain(col.item, [topFolder, r.area, r.controller])
        const sample = scanner.buildSampleBody(r.params)
        const request = {
          method: r.verbs[0],
          header: r.params.length > 0 ? [{ key: 'Content-Type', value: 'application/json' }] : [],
          url: api.buildUrl(baseUrl + r.path),
        }
        if (sample) request.body = { mode: 'raw', raw: sample, options: { raw: { language: 'json' } } }
        if (col.auth) request.auth = col.auth
        if (r.summary) request.description = r.summary
        folder.push({ name: `${r.controller}.${r.action}`, request, response: [] })
        added += 1
      }
      await api.putCollection(key, meta.uid, col)
      lines.push('', `✅ 已写入 ${added} 条到「${meta.name}」→ ${topFolder}/<模块>/<控制器>/（写前已自动备份）。`)
      return { text: lines.join('\n') }
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
      const base = api.resolveBase()
      const baseNote = base === api.DEFAULT_BASE ? '（默认）' : '（POSTMAN_API_BASE 覆盖）'
      return {
        text:
          `已配置：${api.maskKey(info.key)}\n来源：${info.source}` +
          (info.file ? `\n文件：${info.file}` : '') +
          `\n端点：${base}${baseNote}`,
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
   * 设置页 schema（dsh 的「设置 → postman」表单）。
   * 拿不到 schemastery 时为 undefined —— 插件照常工作，只是设置里没有表单。
   */
  Config,

  /**
   * 注册工具与配置页。
   * @param {object} ctx Cordis 上下文。
   * @param {object} [rawConfig] 插件配置（`config.apiKey`，来自设置页或 profile patch）。
   */
  apply(ctx, rawConfig) {
    const pluginConfig = normalizeConfig(rawConfig)

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
                  base: api.resolveBase(),
                  baseIsDefault: api.resolveBase() === api.DEFAULT_BASE,
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

    // ── 设置页命名空间（旧版 dsh 兼容） ──────────────────────────────────────
    //
    // 两代 dsh 的设置机制完全不同，这里都覆盖：
    //
    //   0.2.x（SettingsForms）：`describe()` 遍历 profile 条目，取
    //     `entry.fiber.runtime.Config` 当 schema，自动生成一页（autoGenerate
    //     默认 true）。插件什么都不用做 —— 只需要导出 Config（见模块顶部）。
    //
    //   0.1.x（SettingsProvider）：`describe()` 只列出**显式注册过**的命名空间，
    //     没有派生机制，必须自己 `settings.register(ns, schema, { base })`。
    //     官方辅助函数是 `installSettingsSection()`，它注册之后把插件的配置
    //     来源指向注册返回的 scope，并 watch 变更 —— 也就是「改完立即生效，
    //     不用重启」。下面按同样的语义手写一遍（不 import 那个包，保持零依赖）。
    //
    // 两套并存不会重复出页：0.2.x 的 settings 服务没有 `register` 方法，直接跳过。
    if (Config && typeof ctx.inject === 'function') {
      /** 把设置里的值并进 pluginConfig（原地改，deps.resolveKey 是闭包读它）。 */
      const adoptSettingsValue = (value) => {
        const next = normalizeConfig(value)
        for (const [key, field] of Object.entries(next)) {
          if (field !== undefined) pluginConfig[key] = field
        }
      }
      try {
        ctx.inject(['settings'], (scoped) => {
          const settings = scoped.settings
          if (settings === null || settings === undefined || typeof settings.register !== 'function') return
          scoped.effect(() => {
            /** @type {(() => void)|undefined} */
            let off
            try {
              // base = 组合层里的条目配置（这里是 patch/默认值），用户层的值盖在它上面。
              const base = {}
              for (const [key, field] of Object.entries(pluginConfig)) {
                if (field !== undefined) base[key] = field
              }
              const scope = settings.register('dsh-postman', Config, { base })
              if (scope === null || scope === undefined) return () => {}
              if (typeof scope.get === 'function') adoptSettingsValue(scope.get())
              if (typeof scope.watch === 'function') {
                // watch 回调签名是 (next, prev)。
                off = scope.watch((next) => adoptSettingsValue(next))
              }
            } catch (error) {
              warn(`注册设置命名空间失败（旧版 dsh）：${String((error && error.message) || error)}`)
            }
            return () => {
              if (typeof off === 'function') off()
            }
          }, 'dsh-postman: settings namespace')
        })
      } catch {
        /* 没有 settings 服务时忽略 */
      }
    }

    // ── 技能：斜杠命令 /postman-skill ────────────────────────────────────────
    ctx.effect(() => armSkill(ctx), 'dsh-postman: skill')

    // ── 系统提示：让模型知道有这套工具 ───────────────────────────────────────
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
      ctx.effect(
        () =>
          systemPrompt.section({
            name: 'tool:dsh-postman',
            order: 108,
            text:
              'Postman 工具可用（也可用 ' +
              SKILL_NAME +
              ' 技能获得完整用法）：postman_list 查看集合、postman_tree 查看结构' +
              '（集合大时用 path 只看某个目录）、postman_add 新增接口、' +
              'postman_edit 就地修改已有接口、postman_rm 删除接口、' +
              'postman_pull/postman_push 导入导出、postman_scan 扫源码对比并补齐接口。' +
              '**改已有接口一律用 postman_edit，不要用 rm + add**（后者会丢掉 Tests 脚本、' +
              '示例响应等字段）。若返回「尚未配置 API Key」，' +
              '引导用户到「设置 → postman」填写，不要索要 Key 明文。' +
              '写操作是整体覆盖，工具已自动先拉取最新版并备份；破坏性操作前先向用户确认。',
          }),
        'dsh-postman: system prompt section'
      )
    }

    const current = api.resolveApiKey(pluginConfig)
    info(
      current.key
        ? `已就绪，API Key 来源：${current.source}；设置入口：dsh「设置 → postman」`
        : '已加载但尚未配置 API Key；请在 dsh「设置 → postman」填写'
    )
  },
}
