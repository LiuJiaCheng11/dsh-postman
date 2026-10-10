'use strict'

/**
 * 设置命名空间回归测试 —— 直接复刻 dsh **已构建产物**里的表单投影逻辑，验证插件导出的
 * `Config` 真的能通过 dsh 的过滤，让 `dsh-postman` 进入 `settings.describe()`。
 *
 * 它能证明什么、不能证明什么（容易搞混，写清楚）：
 *   ✅ 能证明：命名空间带真实 schema 出现在 `describe()` 里，字段是 apiKey（secret + volatile）。
 *      这是「插件管理页里能渲染配置表单」与「客户端那一页能绑上值」的前提。
 *   ❌ 不能证明：设置导航里会出现一行。Web 客户端的设置导航行**只**来自客户端注册的
 *      `settings.section`（见 `client/client.js` 与 `test/client-bundle.js`）；
 *      宿主侧的 `autoGenerate` 字段在 Web 客户端没有任何消费方。
 *
 * 为什么不能只测 `Config.toJSON()`：
 *   dsh 的 `SettingsForms.describe()` 对每个 profile 条目做
 *
 *     const schema = entry.fiber?.runtime?.Config
 *     if (schema === undefined || !('toJSON' in schema)) return []
 *     const form = volatileForm(schema)
 *     if (form === undefined) return []          // ← 整条目被丢掉
 *     ... autoGenerate = presentations.get(fiber)?.auto ?? true
 *
 *   也就是说：**没有 Config → 条目消失；有 Config 但一个 volatile 字段都没有 →
 *   条目照样消失**。只断言 toJSON() 里带 volatile 标记是不够的，必须跑一遍
 *   volatileForm()。
 *
 * 下面 volatileForm / plainSchema / projectForm 的实现逐行取自
 *   <dsh-repo>/packages/settings/settings/lib/index.js
 * （源文件 src/schema.ts），只把内部的 `z` 换成运行时真正加载的那一份。
 * isVolatile 取自 @deepseek-ai/cosmokit，与 lib 里同一个 import。
 *
 * 运行：node test/settings-page.js
 */

const assert = require('node:assert')

const plugin = require('../src/index.js')
const { loadSchemastery } = require('../src/schemastery.js')

const z = loadSchemastery()
assert.ok(z, 'schemastery 未加载到——无法验证设置页（先跑一次 dsh 让它装好 profile 依赖）')

/**
 * `isVolatile` 取自 `@deepseek-ai/cosmokit`（实现：`typeof value === 'object' &&
 * value !== null && write in value`，write 是个 Symbol）。profile 里装的
 * cosmokit 1.8.2 尚未导出这个符号，所以这里按 Volatile 的**行为**判定：
 * 一个带 `get()` 的对象。插件自己的 unwrapVolatile 用的是同一判据。
 */
function isVolatile(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
}

// ── 以下三个函数逐行复刻 packages/settings/settings/lib/index.js ────────────

function plainConfig(value) {
  if (isVolatile(value)) return plainConfig(value.get())
  if (Array.isArray(value)) return value.map(plainConfig)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfig(child)]))
  }
  return value
}

function plainSchema(schema) {
  const result = new z(schema.toJSON())
  const walk = (node) => {
    delete node.meta.volatile
    if (node.meta.role === 'secret') {
      delete node.meta.default
      delete node.meta.required
    } else if (node.meta.default !== undefined) {
      // 原实现是 redactSecrets(node, node.meta.default).value；非 secret 分支
      // 的 redactSecrets 就是恒等（walk 只在 meta.role === 'secret' 时裁剪），
      // 所以这里等价于原值。
      node.meta.default = node.meta.default
    }
    for (const child of Object.values(node.dict ?? {})) walk(child)
    if (node.inner) walk(node.inner)
    for (const child of node.list ?? []) walk(child)
  }
  walk(result)
  return result
}

function volatileForm(schema) {
  if (schema.meta.volatile) return plainSchema(schema)
  if (schema.type === 'object') {
    const dict = Object.fromEntries(
      Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
        const field = volatileForm(child)
        return field === undefined ? [] : [[key, field]]
      })
    )
    return Object.keys(dict).length === 0 ? undefined : z.object(dict)
  }
}

function projectForm(schema, value) {
  if (schema.type === 'object' && value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
        const field = Reflect.get(value, key)
        return field === undefined ? [] : [[key, projectForm(child, field)]]
      })
    )
  }
  return value
}

// ── 断言 ────────────────────────────────────────────────────────────────────

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log('  ✓', label)
  } catch (error) {
    failures += 1
    console.log('  ✗', label)
    console.log('   ', error.message)
  }
}

console.log('设置页校验（dsh settings 表单投影的真实语义）')

// 1. Config 导出本身
check('模块导出了 Config', () => {
  assert.ok(plugin.Config, 'plugin.Config 缺失')
  assert.strictEqual(typeof plugin.Config.toJSON, 'function', 'Config 不是 schemastery 对象（没有 toJSON）')
})

// 2. 关键：volatileForm 之后条目仍然存在
check('volatileForm(Config) 不为 undefined（条目不会被 describe() 丢掉）', () => {
  const form = volatileForm(plugin.Config)
  assert.notStrictEqual(form, undefined, 'volatileForm 返回 undefined → 设置里这一页会整个消失')
  assert.strictEqual(form.type, 'object')
  assert.deepStrictEqual(Object.keys(form.dict ?? {}), ['apiKey'], '表单字段应只有 apiKey')
})

// 3. 原始 schema 上的标记：secret + volatile
check('Config 里 apiKey 带 role=secret 与 volatile=true', () => {
  const field = plugin.Config.dict?.apiKey
  assert.ok(field, 'Config 里没有 apiKey 字段')
  assert.strictEqual(field.meta?.role, 'secret', 'apiKey 应是 secret（读取时脱敏）')
  assert.strictEqual(field.meta?.volatile, true, 'apiKey 应标 volatile（否则会被 volatileForm 滤掉）')
})

// 4. 投影成表单后，volatile 标记被抹掉、secret 的 default 被清掉
//    （dsh 不把默认值当「已配置」，否则表单会显示一个假的已填值）
check('表单里 volatile 标记已剥离、secret 的 default 已清除', () => {
  const field = volatileForm(plugin.Config).dict?.apiKey
  assert.ok(field, '表单里没有 apiKey 字段')
  assert.strictEqual(field.meta?.volatile, undefined, 'plainSchema 会删掉 meta.volatile')
  assert.strictEqual(field.meta?.default, undefined, 'secret 字段不应带 default')
  assert.strictEqual(field.meta?.role, 'secret', 'secret 标记应保留，客户端据此渲染成密码框')
})

// 5. 反向对照：去掉 volatile 标记 → 条目必被丢弃（证明这一标是承重的）
check('反向对照：无 volatile 标记时 volatileForm 返回 undefined', () => {
  const bare = z.object({ apiKey: z.string().role('secret').default('') })
  assert.strictEqual(volatileForm(bare), undefined, '没有 volatile 字段时本应被过滤掉——说明修复是必需的')
})

// 6. projectForm 只投影已声明的字段
check('projectForm 只保留 apiKey（普通配置字段不会进表单）', () => {
  const form = volatileForm(plugin.Config)
  const projected = projectForm(form, { apiKey: 'PMAK-abc', baseUrl: 'http://localhost' })
  assert.deepStrictEqual(projected, { apiKey: 'PMAK-abc' }, '表单只应包含声明过的 volatile 字段')
})

// 7. Volatile 包装解包：值可能是 { get() } 而不是裸值
check('plainConfig 能解开 cordis 的 Volatile 包装', () => {
  const wrapped = { get: () => 'PMAK-wrapped' }
  assert.deepStrictEqual(plainConfig({ apiKey: wrapped }), { apiKey: 'PMAK-wrapped' })
})

// 8. 命名空间与显示名（与客户端 shortName() 对齐）
check('命名空间 id 与设置导航显示名', () => {
  const entryId = 'dsh-postman'
  const shortName = entryId.replace(/^dsh-(?:api-|client-|host-)?/, '')
  assert.strictEqual(shortName, 'postman', '客户端 shortName() 会把 dsh-postman 显示成 postman')
})

// 9. schema 能解析（两代实现注册/派生时都会 resolve 一次，抛错就会整条目失败）
check('Config 能解析默认值与用户值', () => {
  const withDefaults = plugin.Config({})
  assert.deepStrictEqual(withDefaults, { apiKey: '' }, '空配置应解析出默认值')
  const withValue = plugin.Config({ apiKey: 'PMAK-xyz' })
  assert.strictEqual(withValue.apiKey, 'PMAK-xyz', '用户值应原样解析')
  // 旧版注册时 base 里没有的键会退回默认值（不会变成 undefined 把表单搞乱）
  assert.deepStrictEqual(plugin.Config({ apiKey: undefined }), { apiKey: '' })
})

console.log('')
if (failures === 0) {
  console.log('设置页校验通过：dsh-postman 命名空间会进入 settings.describe()，字段为 apiKey（secret + volatile）。')
  console.log('')
  console.log('注意：这只保证命名空间「有 schema 可渲染」，不等于设置里会出现导航行 ——')
  console.log('      Web 客户端的设置导航行只来自客户端注册的 settings.section（见 client/client.js），')
  console.log('      宿主侧的 autoGenerate 字段在 Web 客户端没有任何消费方。')
  process.exit(0)
} else {
  console.log(`设置页校验失败：${failures} 项未通过。`)
  process.exit(1)
}
