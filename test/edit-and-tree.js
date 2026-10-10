'use strict'

/**
 * 0.5.0 新增能力的本地测试：postman_edit（就地 patch）与 postman_tree（path/limit）。
 *
 * 思路：把 postman-api 的**网络入口**换掉（resolveApiKey / resolveCollection /
 * getCollection / putCollection），其余纯函数（findFolder / findRequestDeep /
 * renderTreeCapped / buildUrl / countRequests …）保持真实实现。
 * 这样测的是「工具怎么改这棵树」，而不是「Postman 服务器怎么回话」。
 *
 * 运行：node test/edit-and-tree.js
 */

const assert = require('node:assert')
const path = require('node:path')

const api = require('../src/postman-api.js')
const plugin = require('../src/index.js')

// ── 把网络入口换成内存实现 ────────────────────────────────────────────────────

/** 每次用例前重建的云端「集合」；putCollection 把整份对象收进 puts。 */
let cloud = null
const puts = []

function fixture() {
  return {
    info: { _postman_id: 'uid-app', name: 'App', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    item: [
      {
        name: '测试',
        item: [
          {
            name: '健康检查',
            request: {
              method: 'GET',
              header: [{ key: 'X-Trace', value: '1' }],
              url: { raw: 'http://localhost:8080/health', protocol: 'http', host: ['localhost'], port: '8080', path: ['health'] },
              description: '原始说明',
            },
            // 下面三个字段就是 rm + add 会静默丢掉的东西，edit 必须原样带过去
            event: [{ listen: 'test', script: { type: 'text/javascript', exec: ['pm.test("status 200")'] } }],
            response: [{ name: '示例 200', code: 200, status: 'OK' }],
            protocolProfileBehavior: { disableBodyPruning: true },
          },
          {
            name: '无 body 的占位',
            request: { method: 'GET', url: { raw: 'http://localhost:8080/placeholder' } },
          },
        ],
      },
      {
        name: 'Attendance',
        item: [{ name: '请假', request: { method: 'POST', url: { raw: 'http://localhost:8080/leave' } } }],
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
const edit = tool('postman_edit')
const tree = tool('postman_tree')
const add = tool('postman_add')

/** 按名称取节点（浅层递归即可）。 */
function pick(items, name) {
  for (const it of items) {
    if (Array.isArray(it.item)) {
      const hit = pick(it.item, name)
      if (hit) return hit
    } else if (it.name === name) return it
  }
  return undefined
}

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

// ── 用例 ──────────────────────────────────────────────────────────────────────

console.log('1) postman_tree：path 过滤 / 截断提示 / 空目录')

void (async () => {
  await check('整树渲染包含目录与请求', async () => {
    const { text } = await tree.execute({ collection: 'App' })
    assert.ok(text.includes('[测试] (2)'), text)
    assert.ok(text.includes('- 健康检查 (GET) http://localhost:8080/health'), text)
    assert.ok(text.includes('[Attendance] (1)'), text)
    assert.ok(text.includes('uid=uid-app'), text)
  })

  await check('path 只看某个目录，输出里不再有其它目录', async () => {
    const { text } = await tree.execute({ collection: 'App', path: '测试' })
    assert.ok(text.includes('健康检查'), text)
    assert.ok(!text.includes('请假'), `不该出现其它目录的请求：${text}`)
    assert.ok(!text.includes('Attendance'), `不该出现其它目录：${text}`)
    assert.ok(text.includes('› 测试'), `头部应标注作用范围：${text}`)
  })

  await check('path 支持多级，且找不到时报错并列出顶层目录', async () => {
    const ok = await tree.execute({ collection: 'App', path: '测试' })
    assert.ok(ok.text.includes('健康检查'))
    await assert.rejects(
      () => tree.execute({ collection: 'App', path: 'Discipline/Evaluate' }),
      (err) => {
        assert.ok(/目录不存在/.test(err.message), err.message)
        assert.ok(err.message.includes('测试'), `应列出顶层目录：${err.message}`)
        assert.ok(err.message.includes('Attendance'), `应列出顶层目录：${err.message}`)
        return true
      },
    )
  })

  await check('limit 触发截断时给出显式提示 + 顶层目录', async () => {
    const { text } = await tree.execute({ collection: 'App', limit: 2 })
    assert.ok(text.includes('⚠️ 输出已截断'), text)
    assert.ok(/只渲染了前 2 行/.test(text), text)
    assert.ok(text.includes('顶层目录'), text)
    assert.ok(text.includes('path 参数'), text)
    // 截断不等于静默丢数据：必须如实报出总数
    assert.ok(/共 \d+ 项/.test(text), text)
  })

  await check('path 指向空目录时明确说「空目录」，不是空白', async () => {
    const { text } = await tree.execute({ collection: 'App', path: '空的目录' })
    assert.ok(text.includes('（空目录）'), text)
  })

  console.log('\n2) postman_edit：就地 patch，不丢未知字段')

  await check('改 URL —— event / response / protocolProfileBehavior 全部保留', async () => {
    const { text } = await edit.execute({ collection: 'App', name: '健康检查', url: 'http://localhost:8080/healthz' })
    assert.ok(text.includes('URL → http://localhost:8080/healthz'), text)
    assert.strictEqual(puts.length, 1, '应只 PUT 一次（rm+add 是两次）')

    const node = pick(puts[0].col.item, '健康检查')
    assert.strictEqual(node.request.url.raw, 'http://localhost:8080/healthz')
    assert.ok(Array.isArray(node.event) && node.event.length === 1, 'event（Tests 脚本）必须保留')
    assert.strictEqual(node.event[0].script.exec[0], 'pm.test("status 200")')
    assert.ok(Array.isArray(node.response) && node.response.length === 1, 'response（示例）必须保留')
    assert.deepStrictEqual(node.protocolProfileBehavior, { disableBodyPruning: true })
    assert.strictEqual(node.request.description, '原始说明', '没传的字段不应被清掉')
  })

  await check('改 method 大小写归一，且不动 header', async () => {
    await edit.execute({ collection: 'App', name: '健康检查', method: 'post' })
    const node = pick(puts[0].col.item, '健康检查')
    assert.strictEqual(node.request.method, 'POST')
    assert.deepStrictEqual(node.request.header, [{ key: 'X-Trace', value: '1' }])
  })

  await check('headers 是整份替换（不是合并）', async () => {
    await edit.execute({ collection: 'App', name: '健康检查', headers: ['Authorization: Bearer x', '坏行没有冒号'] })
    const node = pick(puts[0].col.item, '健康检查')
    assert.deepStrictEqual(node.request.header, [{ key: 'Authorization', value: 'Bearer x' }], '无冒号的行应被忽略')
  })

  await check('body + language：自动推断 json', async () => {
    await edit.execute({ collection: 'App', name: '健康检查', body: '{"deep":true}' })
    const node = pick(puts[0].col.item, '健康检查')
    assert.strictEqual(node.request.body.mode, 'raw')
    assert.strictEqual(node.request.body.raw, '{"deep":true}')
    assert.strictEqual(node.request.body.options.raw.language, 'json')
  })

  await check('只给 language 且已有 raw body 时，只改语言', async () => {
    await edit.execute({ collection: 'App', name: '健康检查', body: 'hello' })
    await edit.execute({ collection: 'App', name: '健康检查', language: 'json' })
    const node = pick(puts[1].col.item, '健康检查')
    assert.strictEqual(node.request.body.raw, 'hello', '内容不应被动')
    assert.strictEqual(node.request.body.options.raw.language, 'json')
  })

  await check('只给 language 但没有 raw body 时报错', async () => {
    await assert.rejects(
      () => edit.execute({ collection: 'App', name: '无 body 的占位', language: 'json' }),
      /已有 raw 请求体/,
    )
  })

  await check('clearBody 彻底移除请求体，且优先于 body', async () => {
    await edit.execute({ collection: 'App', name: '健康检查', body: '{"a":1}' })
    await edit.execute({ collection: 'App', name: '健康检查', clearBody: true, body: '{"b":2}' })
    const node = pick(puts[1].col.item, '健康检查')
    assert.strictEqual(node.request.body, undefined, 'clearBody 应压过 body')
    assert.ok(Array.isArray(node.event), '清 body 不该连带清掉 Tests 脚本')
  })

  await check('description 传空串 = 删除说明', async () => {
    await edit.execute({ collection: 'App', name: '健康检查', description: '' })
    const node = pick(puts[0].col.item, '健康检查')
    assert.strictEqual(node.request.description, undefined)
    assert.strictEqual(node.name, '健康检查', '删说明不该改名')
  })

  await check('newName 改名成功；撞同层已有名字则报错', async () => {
    await edit.execute({ collection: 'App', name: '健康检查', newName: '健康检查 v2' })
    assert.ok(pick(puts[0].col.item, '健康检查 v2'), '应已改名')
    assert.ok(!pick(puts[0].col.item, '健康检查'), '旧名应消失')

    await assert.rejects(
      () => edit.execute({ collection: 'App', name: '健康检查 v2', newName: '无 body 的占位' }),
      /已存在同名请求/,
    )
  })

  await check('auth: true 继承集合级 auth；false 移除请求级 auth', async () => {
    await edit.execute({ collection: 'App', name: '健康检查', auth: true })
    const node = pick(puts[0].col.item, '健康检查')
    assert.strictEqual(node.request.auth.type, 'bearer', '应继承集合的 bearer auth')

    await edit.execute({ collection: 'App', name: '健康检查', auth: false })
    const after = pick(puts[1].col.item, '健康检查')
    assert.strictEqual(after.request.auth, undefined)
  })

  await check('集合没有 auth 时，auth: true 明确报错而不是写入 undefined', async () => {
    cloud = fixture()
    cloud.auth = undefined
    puts.length = 0
    await assert.rejects(
      () => edit.execute({ collection: 'App', name: '健康检查', auth: true }),
      /没有集合级 auth/,
    )
    assert.strictEqual(puts.length, 0, '报错时不该发出 PUT')
  })

  await check('没传任何字段时报错并列出可用字段', async () => {
    await assert.rejects(
      () => edit.execute({ collection: 'App', name: '健康检查' }),
      /没有提供任何要修改的字段/,
    )
    assert.strictEqual(puts.length, 0, '空改动不该发出 PUT')
  })

  await check('找不到请求时报错', async () => {
    await assert.rejects(() => edit.execute({ collection: 'App', name: '不存在的东西' }), /找不到请求/)
    assert.strictEqual(puts.length, 0)
  })

  console.log('\n3) 对照：rm + add 会丢掉 event / response —— 这就是 edit 存在的理由')

  await check('先 rm 再 add 同一个接口，Tests 脚本与示例响应永久消失', async () => {
    const before = pick(cloud.item, '健康检查')
    assert.strictEqual(before.event.length, 1, '前提：原节点有 Tests 脚本')
    assert.strictEqual(before.response.length, 1, '前提：原节点有示例响应')

    await tool('postman_rm').execute({ collection: 'App', name: '健康检查' })
    await add.execute({
      collection: 'App',
      path: '测试',
      name: '健康检查',
      url: 'http://localhost:8080/health',
      method: 'GET',
    })

    const after = pick(puts[1].col.item, '健康检查')
    assert.ok(after, 'rm + add 之后应存在同名节点')
    assert.strictEqual(after.event, undefined, 'event 已丢失')
    assert.strictEqual(after.response.length, 0, 'response 已丢失')
    assert.strictEqual(after.request.description, undefined, 'description 已丢失')
    // 而同样的改动走 postman_edit 就什么都不会丢（见第 2 节第一条用例）
  })

  await check('add 单独新增时只写 method/header/url/body/auth', async () => {
    await add.execute({
      collection: 'App',
      path: '测试',
      name: '新接口',
      url: 'http://localhost:8080/new',
      method: 'GET',
    })
    const node = pick(puts[0].col.item, '新接口')
    assert.ok(node, 'add 应新增节点')
    assert.strictEqual(node.event, undefined, 'add 不会带来 Tests 脚本')
    assert.deepStrictEqual(node.response, [], 'add 的 response 是空数组')
  })

  console.log('\n4) 技能正文与系统提示的工具清单已同步')

  await check('skill/SKILL.md 里已经讲 postman_edit，且不再教「rm + add」改接口', () => {
    const fs = require('node:fs')
    const body = fs.readFileSync(path.join(__dirname, '..', 'skill', 'SKILL.md'), 'utf8')
    assert.ok(body.includes('postman_edit'), '技能应介绍 postman_edit')
    assert.ok(/改已有接口一律用 `postman_edit`/.test(body), '技能应写死这条硬性规则')
    assert.ok(body.includes('clearBody'), '技能应说明 clearBody')
    assert.ok(body.includes('path'), '技能应说明 tree 的 path')
    assert.ok(!/没有「改」这个动作/.test(body), '旧的「没有改这个动作」说法应已删除')
  })

  await check('index.js 的系统提示与工具表里都有 postman_edit', () => {
    const fs = require('node:fs')
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')
    assert.ok(/postman_edit/.test(src))
    assert.ok(/不要用 postman_rm \+ postman_add|不要用 rm \+ add/.test(src), '系统提示应劝阻 rm+add')
    assert.strictEqual(registered.filter((t) => t.name === 'postman_edit').length, 1, '只应注册一个 postman_edit')
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
