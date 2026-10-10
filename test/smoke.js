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

const fakeSkills = {
  register(def) {
    skills.push(def)
    return () => {}
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
console.log('   ✓ Config 导出（apiKey, role=secret）')

console.log('\n2) apply() 执行')
plugin.apply(fakeCtx, {})
console.log('   effect 数量 =', effects.length, effects)
assert.ok(effects.length >= 3, '至少注册 tools / config page / skill 三个 effect')

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

console.log('\n6) 端到端：postman_list 真实调用')
const listTool = registered.find((t) => t.name === 'postman_list')
listTool
  .execute({})
  .then((result) => {
    assert.ok(result && typeof result.text === 'string', 'execute 必须返回 { text }')
    console.log('   ✓ 返回：')
    console.log(
      result.text
        .split('\n')
        .map((l) => '     ' + l)
        .join('\n')
    )
    console.log('\n全部通过 ✅')
  })
  .catch((error) => {
    // 无 Key 或网络不可达时，至少确认是引导性错误而非崩溃
    assert.ok(/API Key|失败|network/i.test(error.message), `意外错误：${error.message}`)
    console.log('   ⚠ 未完成真实调用（可接受）：', error.message)
    console.log('\n基础校验通过（端到端跳过）✅')
  })
