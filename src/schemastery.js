'use strict'

/**
 * 加载 `@deepseek-ai/schemastery` —— dsh 的「设置」页需要插件模块导出一个 `Config`
 * schema（schemastery 对象）。dsh 侧取法见 `@deepseek-ai/dsh-settings`：
 *
 *   private schema(entry) {
 *     const schema = entry.fiber?.runtime?.Config
 *     return schema !== undefined && 'toJSON' in schema ? schema : undefined
 *   }
 *
 * 没有它，插件条目在 `--dump-config-schema` 里就是 `unknownConfig`，
 * 设置对话框里那一项没有表单可渲染（表现为「异常」）。
 *
 * 难点在于**模块解析**：插件以 `link:E:/Code/...` 装进 profile 时，Node 按真实路径
 * 解析依赖，从插件目录向上找 `node_modules` 永远找不到 profile 里的 schemastery。
 * 所以这里按优先级尝试多个锚点，全部失败时返回 null（插件照常工作，只是没有设置页）。
 *
 * @module dsh-postman/schemastery
 */

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { createRequire } = require('node:module')

/** 目标包名。 */
const PKG = '@deepseek-ai/schemastery'

/** DSH_HOME（默认 `~/.dsh`）。 */
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * 候选锚点：`createRequire(anchor)` 会从锚点所在目录向上查找 `node_modules`。
 * `null` 表示「直接 require」（插件被正常复制进 profile 的 node_modules 时可用）。
 * @returns {Array<string|null>} 锚点列表，按优先级排列。
 */
function anchors() {
  const home = dshHome()
  const list = [
    // 1) pnpm 提升目录：与 profile 名无关，且拿到的是宿主的同一份实例
    path.join(home, 'profiles', 'node_modules', '__anchor__.js'),
  ]
  // 2) 各 profile 目录
  try {
    for (const name of fs.readdirSync(path.join(home, 'profiles'))) {
      if (name === 'node_modules') continue
      list.push(path.join(home, 'profiles', name, 'package.json'))
    }
  } catch {
    /* 目录不存在时忽略 */
  }
  // 3) 兜底：插件自己的依赖（正常 npm 安装时）
  list.push(null)
  return list
}

/** @type {object|null|undefined} 缓存；undefined = 尚未尝试，null = 确定拿不到。 */
let cached

/**
 * 取得 schemastery 模块。
 * @returns {object|null} 模块对象（`z.object` 等）；拿不到时为 null。
 */
function loadSchemastery() {
  if (cached !== undefined) return cached
  for (const anchor of anchors()) {
    try {
      const mod = anchor === null ? require(PKG) : createRequire(anchor)(PKG)
      if (mod && typeof mod.object === 'function') {
        cached = mod
        return cached
      }
    } catch {
      /* 换下一个锚点 */
    }
  }
  cached = null
  return cached
}

module.exports = { loadSchemastery, dshHome, PKG }
