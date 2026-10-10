'use strict'

/**
 * API 端点解析测试。
 *
 * 背景：浏览器里那个 `<团队名>.postman.co` 地址与 API 无关（它是 teamDomain，
 * 只决定网页入口）。API 端点全局统一为 api.getpostman.com，唯一例外是
 * Enterprise 的 EU 数据驻留（api.eu.postman.com）。为此保留了一个不改代码的
 * 逃生口：环境变量 POSTMAN_API_BASE。这里把它钉住。
 *
 * 运行：node test/api-base.js
 */

const assert = require('node:assert')
const api = require('../src/postman-api.js')

const checks = []
const failures = []
function check(label, fn) {
  try {
    fn()
    checks.push(label)
    console.log(`   ✓ ${label}`)
  } catch (error) {
    failures.push(label)
    console.error(`   ✗ ${label}\n     ${error.message}`)
    process.exitCode = 1
  }
}

const ORIGINAL = process.env.POSTMAN_API_BASE

console.log('1) 端点解析')

check('默认端点是 https://api.getpostman.com', () => {
  delete process.env.POSTMAN_API_BASE
  assert.strictEqual(api.resolveBase(), 'https://api.getpostman.com')
  assert.strictEqual(api.DEFAULT_BASE, 'https://api.getpostman.com')
  assert.strictEqual(api.BASE, 'https://api.getpostman.com', 'BASE 常量应保持默认值')
})

check('POSTMAN_API_BASE 可覆盖为 EU 端点', () => {
  process.env.POSTMAN_API_BASE = 'https://api.eu.postman.com'
  assert.strictEqual(api.resolveBase(), 'https://api.eu.postman.com')
})

check('尾部斜杠会被去掉（避免拼出 //collections）', () => {
  process.env.POSTMAN_API_BASE = 'https://api.eu.postman.com///'
  assert.strictEqual(api.resolveBase(), 'https://api.eu.postman.com')
})

check('空串 / 纯空白 → 回退默认，不会拼出坏 URL', () => {
  for (const v of ['', '   ', '\t']) {
    process.env.POSTMAN_API_BASE = v
    assert.strictEqual(api.resolveBase(), 'https://api.getpostman.com', `值为 ${JSON.stringify(v)} 时应回退`)
  }
})

check('覆盖值是「每次调用现读」，改环境变量立刻生效', () => {
  process.env.POSTMAN_API_BASE = 'https://api.eu.postman.com'
  assert.strictEqual(api.resolveBase(), 'https://api.eu.postman.com')
  delete process.env.POSTMAN_API_BASE
  assert.strictEqual(api.resolveBase(), 'https://api.getpostman.com')
})

console.log('\n2) 真实请求确实走 resolveBase（而不是那个常量）')

void (async () => {
  process.env.POSTMAN_API_BASE = 'http://127.0.0.1:1'
  try {
    await api.listCollections('PMAK-not-a-real-key')
    assert.fail('把端点指到不可达地址后，调用本应失败')
  } catch (error) {
    assert.strictEqual(error.code, 'network', `期望 network 错误，实际：${error.code} / ${error.message}`)
    checks.push('端点被覆盖后，真实请求走的是覆盖值')
    console.log('   ✓ 端点被覆盖后，真实请求走的是覆盖值（连不上 127.0.0.1:1 而报 network）')
  }

  if (ORIGINAL === undefined) delete process.env.POSTMAN_API_BASE
  else process.env.POSTMAN_API_BASE = ORIGINAL

  if (failures.length > 0) {
    console.error(`\n${checks.length} 项通过，${failures.length} 项失败 ❌`)
    process.exitCode = 1
  } else {
    console.log(`\n${checks.length} 项断言全部通过 ✅`)
  }
})()
