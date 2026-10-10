'use strict'

/**
 * postman_add_many（批量新增）的本地测试。
 *
 * 思路与 edit-and-tree.js 一致：把 postman-api 的**网络入口**换掉
 * （resolveApiKey / resolveCollection / getCollection / putCollection），
 * 其余纯函数保持真实实现。这样测的是「工具怎么改这棵树」，
 * 以及最要紧的那条性能契约——**整批只 PUT 一次**。
 *
 * 运行：node test/add-many.js
 */

const assert = require('node:assert')
const path = require('node:path')

const api = require('../src/postman-api.js')
const plugin = require('../src/index.js')

// ── 把网络入口换成内存实现 ────────────────────────────────────────────────────

let cloud = null
const puts = []

function fixture() {
  return {
    info: { _postman_id: 'uid-app', name: 'App' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    item: [
      {
        name: '测试',
        item: [
          { name: '健康检查', request: { method: 'GET', url: { raw: 'http://localhost:8080/health' } } },
          { name: '版本号', request: { method: 'GET', url: { raw: 'http://localhost:8080/version' } } },
        ],
      },
      {
        name: 'Attendance',
        item: [
          { name: '请假', request: { method: 'POST', url: { raw: 'http://localhost:8080/leave' } } },
        ],
      },
      { name: '空的目录', item: [] },
    ],
  }
}

api.resolveApiKey = () => ({ key: 'PMAK-test-key', source: '测试注入' })
api.resolveCollection = async (_key, ref) => {
  if (ref !== 'App' && ref !== 'uid-app') throw new Error(`找不到集合：${ref}`)
  return { uid: 'uid-app', name: 'App' }
}
api.getCollection = async () => structuredClone(cloud)
api.putCollection = async (_key, uid, col) => {
  puts.push({ uid, col: structuredClone(col) })
  cloud = structuredClone(col)
}

// ── 加载插件，取出工具 ────────────────────────────────────────────────────────

const registered = []
const fakeCtx = {
  logger: { info() {}, warn() {}, error() {} },
  effect: (fn) => {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  on: () => () => {},
  inject: () => () => {},
  tools: { register: (tool) => (registered.push(tool), () => {}) },
  webServer: { port: 3080, register: () => () => {} },
  connection: { requestRejection: () => undefined },
  get: () => undefined,
}
plugin.apply(fakeCtx, {})

const tool = (name) => {
  const found = registered.find((t) => t.name === name)
  assert.ok(found, `未注册工具：${name}`)
  return found
}
const addMany = tool('postman_add_many')
const addOne = tool('postman_add')

/** 按名称找节点（递归）。 */
function pick(items, name) {
  for (const it of items) {
    if (Array.isArray(it.item)) {
      const hit = pick(it.item, name)
      if (hit) return hit
    } else if (it.name === name) return it
  }
  return undefined
}

/** 按名称找目录节点。 */
function folder(name) {
  return cloud.item.find((it) => it.name === name)
}

// 注册后的工具暴露 execute（compileTool 把 spec.run 包了一层），
// 与 edit-and-tree.js 的调用方式保持一致。
const run = (args) => addMany.execute(args)

// ── 用例 ──────────────────────────────────────────────────────────────────────

const checks = []
const failures = []
async function check(label, fn) {
  cloud = fixture()
  puts.length = 0
  try {
    await fn()
    checks.push(label)
    console.log(`   ✓ ${label}`)
  } catch (error) {
    failures.push(label)
    console.error(`   ✗ ${label}\n     ${error.message}`)
    process.exitCode = 1
  }
}

;(async () => {
  console.log('1) 基本批量新增')

  await check('3 条写进两个目录，请求数 3 → 6', async () => {
    const out = await run({
      collection: 'App',
      items: [
        { name: 'a', url: 'http://localhost:8080/a', path: 'Attendance' },
        { name: 'b', url: 'http://localhost:8080/b', path: 'Attendance' },
        { name: 'c', url: 'http://localhost:8080/c' },
      ],
    })
    assert.strictEqual(api.countRequests(cloud.item), 6, '请求数应为 6')
    assert.ok(out.text.includes('已新增 3 条'), `报告应说新增 3 条：${out.text}`)
    assert.ok(out.text.includes('3 → 6'), `报告应含请求数变化：${out.text}`)
  })

  await check('★ 整批只 PUT 一次（这是它存在的理由）', async () => {
    await run({
      collection: 'App',
      items: [
        { name: 'a', url: 'http://localhost:8080/a', path: 'Attendance' },
        { name: 'b', url: 'http://localhost:8080/b', path: 'Attendance' },
        { name: 'c', url: 'http://localhost:8080/c' },
        { name: 'd', url: 'http://localhost:8080/d', path: '新模块/子目录' },
      ],
    })
    assert.strictEqual(puts.length, 1, `4 条应该只 PUT 一次，实际 ${puts.length} 次`)
  })

  await check('根层新增：不传 path 时落在集合顶层', async () => {
    await run({ collection: 'App', items: [{ name: '根接口', url: 'http://localhost:8080/root' }] })
    assert.ok(
      cloud.item.some((it) => it.name === '根接口'),
      '应直接出现在顶层 item 里',
    )
  })

  console.log('\n2) 同名与不合法项')

  await check('同目录同名被跳过，且报告里列出', async () => {
    const out = await run({
      collection: 'App',
      items: [
        { name: '请假', url: 'http://localhost:8080/leave2', path: 'Attendance' },
        { name: '全新接口', url: 'http://localhost:8080/new', path: 'Attendance' },
      ],
    })
    assert.strictEqual(api.countRequests(cloud.item), 4, '只应新增 1 条')
    assert.ok(out.text.includes('跳过 1 条'), `报告应说跳过 1 条：${out.text}`)
    assert.ok(out.text.includes('Attendance/请假'), `报告应列出被跳过的完整路径：${out.text}`)
  })

  await check('跳过时**不覆盖**已有内容（url 保持原样）', async () => {
    await run({
      collection: 'App',
      items: [{ name: '请假', url: 'http://example.com/CHANGED', path: 'Attendance' }],
    })
    const node = pick(cloud.item, '请假')
    const raw = node.request.url && node.request.url.raw
    assert.ok(
      !String(raw).includes('CHANGED'),
      `已有请求的 url 不该被改，实际 ${raw}`,
    )
  })

  await check('缺 name / 缺 url 的项被跳过并报出第几项，其余项照常写入', async () => {
    const out = await run({
      collection: 'App',
      items: [
        { name: '', url: 'http://localhost:8080/x' },
        { name: '没url' },
        { name: '正常', url: 'http://localhost:8080/ok' },
      ],
    })
    assert.strictEqual(api.countRequests(cloud.item), 4, '只有 1 条该写进去')
    assert.ok(out.text.includes('忽略 2 条'), `报告应说忽略 2 条：${out.text}`)
    assert.ok(out.text.includes('第 1 项'), `应指出是第 1 项：${out.text}`)
    assert.ok(out.text.includes('第 2 项'), `应指出是第 2 项：${out.text}`)
  })

  await check('★ 一条都没写成功时不发起 PUT，集合不受影响', async () => {
    const out = await run({ collection: 'App', items: [{ name: '', url: '' }] })
    assert.strictEqual(puts.length, 0, '不该 PUT')
    assert.strictEqual(api.countRequests(cloud.item), 3, '集合不该变')
    assert.ok(out.text.includes('集合未改动'), `应明说未改动：${out.text}`)
  })

  await check('全部同名时也不 PUT', async () => {
    await run({ collection: 'App', items: [{ name: '请假', url: 'http://x/y', path: 'Attendance' }] })
    assert.strictEqual(puts.length, 0, '全是跳过就不该 PUT')
  })

  console.log('\n3) 目录')

  await check('多级目录自动创建，并在报告里列出', async () => {
    const out = await run({
      collection: 'App',
      items: [{ name: '深接口', url: 'http://localhost:8080/deep', path: '新模块/子目录' }],
    })
    const top = folder('新模块')
    assert.ok(top, '应创建顶层目录「新模块」')
    assert.ok(
      top.item.some((it) => it.name === '子目录' && Array.isArray(it.item)),
      '应创建子目录「子目录」',
    )
    assert.ok(out.text.includes('新模块/子目录'), `报告应列出新建目录：${out.text}`)
  })

  await check('已存在的目录不会被重复创建，也不报「新建」', async () => {
    const out = await run({
      collection: 'App',
      items: [{ name: '再来一个', url: 'http://localhost:8080/again', path: 'Attendance' }],
    })
    assert.strictEqual(cloud.item.filter((it) => it.name === 'Attendance').length, 1, '不该多出一个 Attendance')
    assert.ok(!out.text.includes('新建目录'), `不该报新建目录：${out.text}`)
  })

  await check('createFolder=false 时目录不存在 → 该项跳过，其余项仍写入', async () => {
    const out = await run({
      collection: 'App',
      createFolder: false,
      items: [
        { name: '进不去', url: 'http://localhost:8080/x', path: '不存在的目录' },
        { name: '能进去', url: 'http://localhost:8080/y', path: 'Attendance' },
      ],
    })
    assert.strictEqual(folder('不存在的目录'), undefined, '不该创建目录')
    assert.ok(pick(cloud.item, '能进去'), '另一项应正常写入')
    assert.ok(out.text.includes('目录不存在'), `报告应说明原因：${out.text}`)
  })

  console.log('\n4) dryRun 预演')

  await check('★ dryRun 不写入、不 PUT，但报告里说清会做什么', async () => {
    const out = await run({
      collection: 'App',
      dryRun: true,
      items: [
        { name: '预演接口', url: 'http://localhost:8080/dry', path: '新目录' },
        { name: '请假', url: 'http://x/y', path: 'Attendance' },
      ],
    })
    assert.strictEqual(puts.length, 0, 'dryRun 不该 PUT')
    assert.strictEqual(api.countRequests(cloud.item), 3, 'dryRun 不该改集合')
    assert.ok(folder('新目录') === undefined, 'dryRun 不该真建目录')
    assert.ok(out.text.includes('预演'), `应标明是预演：${out.text}`)
    assert.ok(out.text.includes('将新增 1 条'), `应说将新增 1 条：${out.text}`)
    assert.ok(out.text.includes('跳过 1 条'), `应说跳过 1 条：${out.text}`)
    assert.ok(out.text.includes('将新建目录'), `应说将新建目录：${out.text}`)
  })

  console.log('\n5) 字段透传')

  await check('method / headers / body / language / description 都正确落到 request', async () => {
    await run({
      collection: 'App',
      items: [
        {
          name: '全字段',
          url: 'http://localhost:8080/full',
          method: 'post',
          headers: ['X-A: 1', 'X-B: 2', '没有冒号的会被丢掉'],
          body: '{"a":1}',
          description: '接口说明',
        },
        {
          name: '显式语言',
          url: 'http://localhost:8080/lang',
          body: 'plain text',
          language: 'text',
        },
      ],
    })
    const full = pick(cloud.item, '全字段')
    assert.strictEqual(full.request.method, 'POST', 'method 应转大写')
    assert.deepStrictEqual(
      full.request.header,
      [
        { key: 'X-A', value: '1' },
        { key: 'X-B', value: '2' },
      ],
      'header 应解析成对象数组，且丢掉没有冒号的项',
    )
    assert.strictEqual(full.request.body.mode, 'raw')
    assert.strictEqual(full.request.body.raw, '{"a":1}')
    assert.strictEqual(full.request.body.options.raw.language, 'json', '应以 { 开头猜成 json')
    assert.strictEqual(full.request.description, '接口说明')

    const lang = pick(cloud.item, '显式语言')
    assert.strictEqual(lang.request.body.options.raw.language, 'text', '显式 language 应优先')
  })

  await check('auth=true 时继承集合级 auth', async () => {
    await run({
      collection: 'App',
      items: [
        { name: '带鉴权', url: 'http://localhost:8080/auth', auth: true },
        { name: '不带鉴权', url: 'http://localhost:8080/noauth' },
      ],
    })
    assert.deepStrictEqual(pick(cloud.item, '带鉴权').request.auth, cloud.auth, '应继承集合 auth')
    assert.strictEqual(pick(cloud.item, '不带鉴权').request.auth, undefined, '未声明则不带 auth')
  })

  await check('postman_add 与 postman_add_many 生成的 request 形状一致', async () => {
    const spec = { name: '同一个', url: 'http://localhost:8080/same', method: 'PUT', headers: ['A: 1'], body: '{}', description: 'd' }
    await run({ collection: 'App', items: [spec] })
    const many = pick(cloud.item, '同一个').request
    cloud = fixture()
    await addOne.execute({ collection: 'App', ...spec })
    const one = pick(cloud.item, '同一个').request
    assert.deepStrictEqual(many, one, '两个工具应共用 buildRequest，形状必须一致')
  })

  console.log('\n6) 参数校验与接线')

  await check('items 为空 / 不是数组 → 明确报错', async () => {
    await assert.rejects(() => run({ collection: 'App', items: [] }), /items 为空/)
    await assert.rejects(() => run({ collection: 'App', items: 'not-an-array' }), /items 为空/)
  })

  await check('集合不存在时报错，且不 PUT', async () => {
    await assert.rejects(() => run({ collection: '不存在', items: [{ name: 'x', url: 'http://x' }] }), /找不到集合/)
    assert.strictEqual(puts.length, 0)
  })

  await check('系统提示与 SKILL 正文里都提到 postman_add_many', () => {
    const fs = require('node:fs')
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')
    const skill = fs.readFileSync(path.join(__dirname, '..', 'skill', 'SKILL.md'), 'utf8')
    assert.ok(/postman_add_many/.test(src), 'index.js 应提到 postman_add_many')
    assert.ok(/postman_add_many/.test(skill), 'SKILL.md 应提到 postman_add_many')
    assert.strictEqual(registered.filter((t) => t.name === 'postman_add_many').length, 1, '只应注册一个')
  })

  await check('工具数与市场描述里的数字一致', () => {
    const fs = require('node:fs')
    const entry = fs.readFileSync(
      path.join(__dirname, '..', 'marketplace', 'LiuJiaCheng11__dsh-postman.yml'),
      'utf8',
    )
    const count = registered.filter((t) => /^postman_/.test(t.name)).length
    assert.ok(
      entry.includes(`${count} tools`) || entry.includes(`${count} 个工具`),
      `市场描述里的工具数应与实际一致（实际 ${count}）：${entry}`,
    )
  })

  if (failures.length > 0) {
    console.error(`\n${checks.length} 项通过，${failures.length} 项失败 ❌`)
    process.exitCode = 1
  } else {
    console.log(`\n${checks.length} 项断言全部通过 ✅`)
  }
})().catch((error) => {
  console.error('\n测试自身崩溃：', error)
  process.exitCode = 1
})
