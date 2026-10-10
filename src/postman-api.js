'use strict'

/**
 * Postman 公开 API 客户端（CJS，零外部依赖）。
 *
 * 由 postman_api.py 移植而来，语义保持一致：
 *   - 集合用「名称或 uid」定位；
 *   - PUT /collections/{uid} 是**整体覆盖**，所以每次写操作前先 GET 最新版本，
 *     并自动备份到 ~/.postman_backup/<uid>.json；
 *   - 返回结构化结果（{ ok, text } / 抛 PostmanError），供上层工具转成文本。
 *
 * API Key 解析优先级：
 *   1) 插件配置（cordis.patch.yml 的 config.apiKey / POSTMAN_API_KEY 环境变量）
 *   2) 插件设置文件 ~/.dsh/dsh-postman/config.json 的 apiKey（配置页写入）
 *   3) 历史文件 ~/.postman_api_key
 *   4) 环境变量 POSTMAN_API_KEY
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/**
 * Postman API 的默认端点。
 *
 * 浏览器里那个 `<团队名>.postman.co` 地址**与 API 无关** —— 它是 Postman 给每个团队
 * 自动生成的 `teamDomain`（团队名的 slug），只决定浏览器打开哪个团队的界面。
 * API 按 API Key 认证、按账号返回数据，端点全局统一。
 *
 * 唯一例外是 **Enterprise 的 EU 数据驻留**：那种账号的 Postman API 在
 * `api.eu.postman.com`（官方文档：*The Postman API uses the `api.eu.postman.com`
 * subdomain*），且部分端点不可用。为它保留一个不改代码的逃生口：环境变量
 * `POSTMAN_API_BASE`（例如 `https://api.eu.postman.com`）。
 */
const DEFAULT_BASE = 'https://api.getpostman.com'

/** 解析当前要用的 API 端点（每次调用都读，便于测试与临时切换）。 */
function resolveBase() {
  const raw = process.env.POSTMAN_API_BASE
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim().replace(/\/+$/, '')
  return DEFAULT_BASE
}

/** 默认端点常量（导出供文档/探测脚本引用；实际请求请用 resolveBase()）。 */
const BASE = DEFAULT_BASE

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_DIR = path.join(DSH_HOME, 'dsh-postman')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const LEGACY_KEY_FILE = path.join(os.homedir(), '.postman_api_key')
const BACKUP_DIR = path.join(os.homedir(), '.postman_backup')
const REQUEST_TIMEOUT_MS = 90000

/** 业务错误：带稳定 code，便于工具层统一转文本。 */
class PostmanError extends Error {
  constructor(message, code = 'postman-error') {
    super(message)
    this.name = 'PostmanError'
    this.code = code
  }
}

// ── API Key 解析与持久化 ──────────────────────────────────────────────────────

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 解析当前生效的 API Key。
 * @param {object} [pluginConfig] 插件配置对象。
 * @returns {{ key: string, source: string, file?: string }}
 */
function resolveApiKey(pluginConfig) {
  const cfg = pluginConfig && typeof pluginConfig === 'object' ? pluginConfig : {}

  if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim() !== '') {
    return { key: cfg.apiKey.trim(), source: '插件配置（dsh 设置页 / cordis.patch.yml / 环境变量）' }
  }

  const stored = readJsonFile(CONFIG_FILE)
  if (stored && typeof stored.apiKey === 'string' && stored.apiKey.trim() !== '') {
    return { key: stored.apiKey.trim(), source: '插件设置文件', file: CONFIG_FILE }
  }

  try {
    const legacy = fs.readFileSync(LEGACY_KEY_FILE, 'utf8').trim()
    if (legacy !== '') {
      return { key: legacy, source: '历史文件 ~/.postman_api_key', file: LEGACY_KEY_FILE }
    }
  } catch {
    /* 文件不存在，继续 */
  }

  const env = process.env.POSTMAN_API_KEY
  if (typeof env === 'string' && env.trim() !== '') {
    return { key: env.trim(), source: 'POSTMAN_API_KEY 环境变量' }
  }

  return { key: '', source: '未配置' }
}

/**
 * 保存 API Key 到插件设置文件（原子写 + 0600 权限）。
 * @param {string} apiKey 待保存的 Key。
 * @returns {string} 写入的文件路径。
 */
function saveApiKey(apiKey) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (key === '') throw new PostmanError('API Key 不能为空', 'empty-key')
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const payload = { apiKey: key, updatedAt: new Date().toISOString() }
  const temp = `${CONFIG_FILE}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  try {
    fs.chmodSync(temp, 0o600)
  } catch {
    /* Windows 上可能不支持，忽略 */
  }
  fs.renameSync(temp, CONFIG_FILE)
  return CONFIG_FILE
}

/** 清除插件设置文件里的 API Key。 */
function clearApiKey() {
  try {
    fs.unlinkSync(CONFIG_FILE)
    return true
  } catch {
    return false
  }
}

/** 把 Key 掩码成便于展示的形式。 */
function maskKey(key) {
  if (typeof key !== 'string' || key === '') return ''
  if (key.length <= 12) return `${key.slice(0, 4)}…`
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}

// ── HTTP 调用 ────────────────────────────────────────────────────────────────

/**
 * 调用 Postman API。
 * @param {string} method HTTP 方法。
 * @param {string} apiPath 以 / 开头的路径。
 * @param {string} key API Key。
 * @param {object} [body] 请求体（对象）。
 * @returns {Promise<{ status: number, data: any }>}
 */
async function call(method, apiPath, key, body) {
  const headers = { 'X-Api-Key': key, Accept: 'application/json' }
  const init = { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(resolveBase() + apiPath, init)
  } catch (error) {
    throw new PostmanError(`请求 Postman API 失败：${error && error.message ? error.message : String(error)}`, 'network')
  }
  const raw = await res.text()
  let data
  try {
    data = raw ? JSON.parse(raw) : undefined
  } catch {
    data = raw
  }
  return { status: res.status, data }
}

/** 需要成功状态码，否则抛错。 */
function ensureOk(result, what) {
  if (result.status < 200 || result.status >= 300) {
    const detail = typeof result.data === 'string' ? result.data.slice(0, 600) : JSON.stringify(result.data)
    if (result.status === 401 || result.status === 403) {
      throw new PostmanError(`${what} 失败（${result.status}）：API Key 无效或权限不足。请在插件设置页更新 Key。`, 'unauthorized')
    }
    throw new PostmanError(`${what} 失败（${result.status}）：${detail}`, 'http')
  }
  return result.data
}

// ── 集合解析与读取 ───────────────────────────────────────────────────────────

/** 列出全部集合。 */
async function listCollections(key) {
  const data = ensureOk(await call('GET', '/collections', key), '列出集合')
  return (data && data.collections) || []
}

/**
 * 把「集合名或 uid」解析为一个集合元数据对象。
 * @param {string} key API Key。
 * @param {string} ref 集合名或 uid。
 * @returns {Promise<{ uid: string, name: string }>}
 */
async function resolveCollection(key, ref) {
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw new PostmanError('必须指定集合名称或 uid', 'bad-request')
  }
  const target = ref.trim()
  const cols = await listCollections(key)
  const exact = cols.find((c) => c.uid === target)
  if (exact) return exact
  const named = cols.filter((c) => c.name === target)
  if (named.length === 1) return named[0]
  if (named.length > 1) {
    const list = named.map((c) => `  ${c.name}  ${c.uid}`).join('\n')
    throw new PostmanError(`有 ${named.length} 个同名集合，请改用 uid：\n${list}`, 'ambiguous')
  }
  throw new PostmanError(`找不到集合：${target}`, 'not-found')
}

/**
 * 读取集合完整内容（写操作前调用），可选备份。
 * @param {string} key API Key。
 * @param {string} uid 集合 uid。
 * @param {boolean} [backup] 是否备份到 ~/.postman_backup。
 * @returns {Promise<object>} 集合对象。
 */
async function getCollection(key, uid, backup = true) {
  const data = ensureOk(await call('GET', `/collections/${uid}`, key), '读取集合')
  const col = data && data.collection
  if (!col) throw new PostmanError('Postman 返回的集合内容为空', 'bad-response')
  if (backup) {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
      fs.writeFileSync(path.join(BACKUP_DIR, `${uid}.json`), JSON.stringify(col, null, 2), 'utf8')
    } catch {
      /* 备份失败不阻断主流程 */
    }
  }
  if (col.info && typeof col.info === 'object') {
    delete col.info.updatedAt
    delete col.info.createdAt
    delete col.info.lastUpdatedBy
  }
  return col
}

/**
 * 整体覆盖写回集合。
 * @param {string} key API Key。
 * @param {string} uid 集合 uid。
 * @param {object} col 集合对象。
 */
async function putCollection(key, uid, col) {
  return ensureOk(await call('PUT', `/collections/${uid}`, key, { collection: col }), '写回集合')
}

// ── 树操作辅助 ───────────────────────────────────────────────────────────────

/** 递归统计请求数。 */
function countRequests(items) {
  let n = 0
  for (const it of items || []) {
    if (Array.isArray(it.item)) n += countRequests(it.item)
    else n += 1
  }
  return n
}

/** 按 "A/B" 路径查找目录节点；找不到返回 undefined。 */
function findFolder(items, folderPath) {
  const parts = String(folderPath || '').split('/').filter((p) => p !== '')
  let cur = items
  let node
  for (const part of parts) {
    const next = (cur || []).find((it) => Array.isArray(it.item) && it.name === part)
    if (!next) return undefined
    node = next
    cur = next.item
  }
  return node
}

/** 在给定层内按名称查找请求（不递归）。 */
function findRequestShallow(items, name) {
  return (items || []).find((it) => !Array.isArray(it.item) && it.name === name)
}

/** 递归查找请求，返回 { list, node } 便于删除。 */
function findRequestDeep(items, name) {
  for (const it of items || []) {
    if (Array.isArray(it.item)) {
      const found = findRequestDeep(it.item, name)
      if (found) return found
    } else if (it.name === name) {
      return { list: items, node: it }
    }
  }
  return undefined
}

/** 把 URL 字符串拆成 Postman url 对象。 */
function buildUrl(raw) {
  const o = { raw }
  let u
  try {
    u = new URL(raw)
  } catch {
    return o
  }
  o.protocol = u.protocol.replace(':', '')
  o.host = u.hostname.split('.')
  if (u.port) o.port = u.port
  o.path = u.pathname.split('/').filter((p) => p !== '')
  const query = []
  for (const [k, v] of u.searchParams.entries()) query.push({ key: k, value: v })
  if (query.length > 0) o.query = query
  return o
}

/** 生成树形文本。 */
function renderTree(items, indent = 0) {
  const lines = []
  for (const it of items || []) {
    if (Array.isArray(it.item)) {
      lines.push(`${'  '.repeat(indent)}[${it.name}] (${it.item.length})`)
      lines.push(...renderTree(it.item, indent + 1))
    } else {
      const r = it.request || {}
      const raw = r.url && typeof r.url === 'object' ? r.url.raw || '' : String(r.url || '')
      lines.push(`${'  '.repeat(indent)}- ${it.name} (${r.method || 'GET'}) ${raw}`)
    }
  }
  return lines
}

/**
 * 生成树形文本，但限制输出行数，并如实报告是否被截断。
 *
 * 为什么需要：宿主对工具输出有长度上限，超了会**静默截断**。模型拿到半棵树却
 * 以为看到了全部，就可能误判「目录不存在」进而建出重复目录。这里主动截断并把
 * 事实说出来，把静默失败变成显式提示。
 *
 * @param {Array} items 起始层级的 item 数组。
 * @param {number} limit 最多输出多少行。
 * @param {number} [indent] 起始缩进层级。
 * @returns {{ lines: string[], total: number, truncated: boolean }} total 是遍历到的总项数（目录+请求）。
 */
function renderTreeCapped(items, limit, indent = 0) {
  const lines = []
  let total = 0
  const walk = (list, depth) => {
    for (const it of list || []) {
      total += 1
      if (Array.isArray(it.item)) {
        if (lines.length < limit) lines.push(`${'  '.repeat(depth)}[${it.name}] (${it.item.length})`)
        walk(it.item, depth + 1)
      } else if (lines.length < limit) {
        const r = it.request || {}
        const raw = r.url && typeof r.url === 'object' ? r.url.raw || '' : String(r.url || '')
        lines.push(`${'  '.repeat(depth)}- ${it.name} (${r.method || 'GET'}) ${raw}`)
      }
    }
  }
  walk(items, indent)
  return { lines, total, truncated: total > lines.length }
}

/** 列出某一层里所有目录的名字（用于「目录不存在」时给出可选项）。 */
function listFolderNames(items) {
  return (items || []).filter((it) => Array.isArray(it.item)).map((it) => it.name)
}

module.exports = {
  PostmanError,
  BASE,
  DEFAULT_BASE,
  resolveBase,
  CONFIG_FILE,
  LEGACY_KEY_FILE,
  BACKUP_DIR,
  resolveApiKey,
  saveApiKey,
  clearApiKey,
  maskKey,
  call,
  listCollections,
  resolveCollection,
  getCollection,
  putCollection,
  countRequests,
  findFolder,
  findRequestShallow,
  findRequestDeep,
  buildUrl,
  renderTree,
  renderTreeCapped,
  listFolderNames,
}
