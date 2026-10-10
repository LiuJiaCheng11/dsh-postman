'use strict'

/**
 * 本地冒烟测试：用一个假的 Cordis ctx 加载插件，验证 apply() 能正常注册
 * 工具与路由，并检查工具定义符合 register() 的契约。
 *
 * 运行：node test/smoke.js
 */

const assert = require('node:assert')
const plugin = require('../src/index.js')

const registered = []
const routes = []
const effects = []
const skills = []
const listeners = []
const settingsRegistrations = []
const settingsWatchers = []

const fakeSkills = {
  register(def) {
    skills.push(def)
    return () => {}
  },
}

/**
 * 旧版 dsh（0.1.x 的 SettingsProvider）的设置服务替身。
 * register(ns, schema, options) 返回一个 scope：get() 读值、watch(cb) 订阅变更。
 */
const fakeSettingsScope = {
  get: () => ({ apiKey: '' }),
  watch(callback) {
    settingsWatchers.push(callback)
    return () => {}
  },
}

const fakeSettings = {
  register(ns, schema, options) {
    settingsRegistrations.push({ ns, schema, options })
    return fakeSettingsScope
  },
}

const fakeCtx = {
  logger: {
    info: (m) => console.log('  [info]', m),
    warn: (m) => console.log('  [warn]', m),
    error: (m) => console.log('  [error]', m),
  },
  effect(fn, label) {
    effects.push(label)
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  on(event, handler) {
    listeners.push(event)
    return () => {}
  },
  inject(names, callback) {
    if (Array.isArray(names) && names.includes('settings')) {
      callback({ settings: fakeSettings, effect: fakeCtx.effect })
    }
    return () => {}
  },
  tools: {
    register(tool) {
      registered.push(tool)
      return () => {}
    },
  },
  webServer: {
    port: 3080,
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  connection: {
    requestRejection() {
      return undefined
    },
  },
  get(name) {
    if (name === 'skills') return fakeSkills
    return undefined
  },
}

console.log('1) 插件导出契约')
assert.strictEqual(typeof plugin.name, 'string', 'name 必须是字符串')
assert.ok(Array.isArray(plugin.inject), 'inject 必须是数组')
assert.strictEqual(typeof plugin.apply, 'function', 'apply 必须是函数')
assert.deepStrictEqual(plugin.inject, ['tools', 'webServer', 'connection'])
console.log('   name =', plugin.name, '| inject =', plugin.inject.join(', '))

// Config 是 dsh「设置 → postman」表单的来源（@deepseek-ai/dsh-settings 取
// entry.fiber.runtime.Config）。缺了它，设置里那一项就是没有表单的空页。
assert.ok(plugin.Config, '必须导出 Config（设置页 schema）')
assert.strictEqual(typeof plugin.Config.toJSON, 'function', 'Config 必须是 schemastery schema')
const configJson = JSON.stringify(plugin.Config.toJSON())
assert.ok(configJson.includes('apiKey'), 'Config 必须声明 apiKey 字段')
assert.ok(configJson.includes('"role":"secret"'), 'apiKey 必须标 role=secret（避免明文回流浏览器）')
// volatile 是必需的：dsh 的 settings 用 volatileForm() 过滤表单，非 volatile 的叶子字段
// 会被丢弃，一个字段都不剩时整个条目被滤掉 —— 设置里就不会出现这一页。
assert.ok(configJson.includes('"volatile":true'), 'apiKey 必须标 volatile，否则设置页会被过滤掉')
console.log('   ✓ Config 导出（apiKey, role=secret, volatile）')

/**
 * 复刻 @deepseek-ai/dsh-settings 的 volatileForm（packages/settings/settings/src/schema.ts）。
 * 它只保留 volatile 字段；返回 undefined 时该插件条目会被整个滤掉、设置里不出现这一页。
 * 这是本轮踩过的坑，用本地复刻把回归钉住。
 */
function volatileForm(schema) {
  if (schema.meta.volatile) return schema
  if (schema.type === 'object') {
    const dict = Object.fromEntries(
      Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
        const field = volatileForm(child)
        return field === undefined ? [] : [[key, field]]
      })
    )
    return Object.keys(dict).length === 0 ? undefined : { type: 'object', dict }
  }
  return undefined
}

const form = volatileForm(plugin.Config)
assert.ok(form, 'volatileForm 必须返回表单（返回 undefined 会导致设置页消失）')
assert.ok(form.dict && form.dict.apiKey, '过滤后必须仍保留 apiKey 字段')
console.log('   ✓ volatileForm 过滤后仍保留 apiKey')

console.log('\n2) apply() 执行')
plugin.apply(fakeCtx, {})
console.log('   effect 数量 =', effects.length, effects)
assert.ok(effects.length >= 4, '至少注册 tools / config page / settings namespace / skill 四个 effect')

/**
 * 模拟 dsh-tools 的 assertSupportedJsonSchema：校验受支持子集。
 * 关键点：`required` 必须是**对象层数组**，不能写成属性内的布尔值
 * （这正是真实启动时踩过的坑）。
 */
const ALLOWED_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'description', 'title', 'default', 'examples',
  'deprecated', 'readOnly', 'writeOnly',
])

function checkSchema(node, path) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`${path} 必须是 schema 对象`)
  }
  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      throw new Error(`${path}.${key} 不是受支持的 JSON Schema 关键字`)
    }
  }
  if (node.required !== undefined) {
    if (!Array.isArray(node.required)) {
      throw new Error(`${path}.required 必须是数组（对象层），不能是属性内的布尔值`)
    }
    if (node.type !== 'object') {
      throw new Error(`${path}.required 只能出现在 type=object 的节点上`)
    }
  }
  if (node.type === undefined && node.oneOf === undefined) {
    throw new Error(`${path} 缺少 type 或 oneOf`)
  }
  if (node.type !== undefined && node.oneOf !== undefined) {
    throw new Error(`${path} 不能同时声明 type 和 oneOf`)
  }
  if (node.properties !== undefined) {
    if (node.type !== 'object') throw new Error(`${path}.properties 需要 type=object`)
    for (const [k, v] of Object.entries(node.properties)) checkSchema(v, `${path}.properties.${k}`)
  }
  if (node.items !== undefined) checkSchema(node.items, `${path}.items`)
  if (node.oneOf !== undefined) node.oneOf.forEach((v, i) => checkSchema(v, `${path}.oneOf[${i}]`))
}

console.log('\n3) 工具契约校验')
assert.ok(registered.length >= 6, `期望注册 >=6 个工具，实际 ${registered.length}`)
for (const tool of registered) {
  assert.strictEqual(typeof tool.name, 'string', `${tool.name}: name`)
  assert.strictEqual(typeof tool.description, 'string', `${tool.name}: description`)
  assert.ok(tool.parameters && tool.parameters.type === 'object', `${tool.name}: parameters 必须是 object 根`)
  assert.ok(tool.output && typeof tool.output.render === 'function', `${tool.name}: output.render 必须是函数`)
  assert.ok(tool.output.schema && tool.output.schema.type === 'object', `${tool.name}: output.schema 必须是 object 根`)
  assert.strictEqual(typeof tool.execute, 'function', `${tool.name}: execute 必须是函数`)
  // 受支持子集校验（与 dsh-tools 的 assertSupportedJsonSchema 等价）
  checkSchema(tool.parameters, `${tool.name}.parameters`)
  checkSchema(tool.output.schema, `${tool.name}.output.schema`)
  // render 必须返回 ContentBlock[]
  const rendered = tool.output.render({}, { text: 'hello' })
  assert.ok(Array.isArray(rendered) && rendered[0].type === 'text' && rendered[0].text === 'hello', `${tool.name}: render 输出异常`)
  console.log(`   ✓ ${tool.name}`)
}

console.log('\n4) 路由校验')
const route = routes.find((r) => r.path === '/dsh-postman')
assert.ok(route, '必须有 /dsh-postman 路由')
assert.strictEqual(route.kind, 'prefix')
assert.strictEqual(typeof route.handler, 'function')
console.log('   ✓ prefix /dsh-postman')

console.log('\n5) 技能注册（/postman-skill）')
assert.ok(skills.length >= 1, `期望注册 >=1 个技能，实际 ${skills.length}`)
const skill = skills.find((s) => s.name === 'postman-skill')
assert.ok(skill, '必须注册名为 postman-skill 的技能')
assert.strictEqual(typeof skill.description, 'string')
assert.ok(skill.description.length > 0, '技能必须有描述（斜杠菜单显示）')
assert.strictEqual(typeof skill.content, 'string')
assert.ok(skill.content.includes('postman_list'), '技能正文应包含工具说明')
assert.strictEqual(skill.source, 'bundled')
assert.ok(skill.resourceBase && skill.resourceBase.kind === 'directory', 'resourceBase 必须是目录')
assert.ok(listeners.includes('agent/created'), '应监听 agent/created 做 agent 级注册')
console.log('   ✓ postman-skill（' + skill.content.length + ' 字节正文，resourceBase=' + skill.resourceBase.path + '）')

console.log('\n6) 旧版 dsh 的设置命名空间（settings.register）')
assert.strictEqual(settingsRegistrations.length, 1, `期望注册 1 个设置命名空间，实际 ${settingsRegistrations.length}`)
const registration = settingsRegistrations[0]
assert.strictEqual(registration.ns, 'dsh-postman', '命名空间必须是 dsh-postman')
assert.strictEqual(registration.schema, plugin.Config, '注册的 schema 必须是导出的 Config')
assert.ok(
  registration.options && typeof registration.options.base === 'object' && registration.options.base !== null,
  'base 必须是对象（用户层的值盖在它上面）'
)
assert.strictEqual(settingsWatchers.length, 1, '必须 watch 变更——设置里改完立即生效，不用重启 dsh')
console.log('   ✓ settings.register("dsh-postman", Config, { base })')

console.log('\n7) 端到端：postman_list 真实调用')
const listTool = registered.find((t) => t.name === 'postman_list')
const configTool = registered.find((t) => t.name === 'postman_config')

void (async () => {
  // 7a. 设置里写入的 Key 是否即时生效（旧版路径：watch → resolveKey）
  settingsWatchers[0]({ apiKey: 'PMAK-live-from-settings' }, { apiKey: '' })
  const status = await configTool.execute({ action: 'status' })
  assert.ok(!status.text.includes('PMAK-live-from-settings'), '状态输出不应回显明文 Key')
  assert.ok(status.text.includes('设置页'), `状态应说明 Key 来自 dsh 设置页，实际：${status.text}`)
  console.log('   ✓ 设置变更即时生效（watch 回调改写了 resolveKey 读到的配置）')
  // 交还回退链：置空后 resolveApiKey 会继续往下找（设置文件 / 历史文件 / 环境变量）
  settingsWatchers[0]({ apiKey: '' }, { apiKey: 'PMAK-live-from-settings' })

  // 7b. 真实调用一次线上 Postman
  try {
    const result = await listTool.execute({})
    assert.ok(result && typeof result.text === 'string', 'execute 必须返回 { text }')
    console.log('   ✓ postman_list 返回：')
    console.log(
      result.text
        .split('\n')
        .map((l) => '     ' + l)
        .join('\n')
    )
  } catch (error) {
    // 无 Key 或网络不可达时，至少确认是引导性错误而非崩溃
    assert.ok(/API Key|失败|network/i.test(error.message), `意外错误：${error.message}`)
    console.log('   ⚠ 未完成真实调用（可接受）：', error.message)
  }

  console.log('\n全部通过 ✅')
})()
