'use strict'

/**
 * 客户端 bundle（`client/client.js`）回归测试。
 *
 * 为什么要单独测：这个文件是**手写的浏览器产物**（`window.__ModuleLoader__.load`
 * 包装 + `require("react")`），没有构建步骤、也没有类型检查兜底。一旦包装契约或
 * 槽位注册写错，表现是「设置里什么都不出现」，而且宿主侧不会有任何报错。
 *
 * 这里提供一个假浏览器环境：
 *   - `global.window.__ModuleLoader__.load` 捕获 bundle 的注册；
 *   - 一个极简 React 桩（createElement / useState / useSyncExternalStore）；
 *   - 假的 `slots` / `locale` / `configForms` 服务。
 *
 * 断言六件事：
 *   1. bundle 用正确的 id（包名）注册，导出 name/inject/apply；
 *   2. 命名空间被服务时才注册 `settings.section`，id 是 postman；
 *   3. 组件在「可用 / 不可用」两种状态下都能构造出元素树，且可用时含密码输入框；
 *   4. 页面写 Key 走的是 `configForms` 的 set/unset（命名空间 dsh-postman）；
 *   5. 0.1.x 客户端没有 configForms 时**静默退出而不抛错**（抛错会污染客户端启动）；
 *   6. 保存文案不承诺「立即生效」（长会话可能仍持有旧工具闭包）。
 *
 * 运行：node test/client-bundle.js
 */

const assert = require('node:assert')
const path = require('node:path')

const BUNDLE = path.join(__dirname, '..', 'client', 'client.js')
const NS = 'dsh-postman'

// ── 假 React ────────────────────────────────────────────────────────────────

/** 极简 createElement：把 rest 参数收成 children 数组。 */
function createElement(type, props, ...children) {
  const next = { ...(props || {}) }
  if (children.length > 0) next.children = children
  return { type, props: next }
}

const ReactStub = {
  createElement,
  useState: (initial) => [initial, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useEffect: () => {},
}

// ── 假浏览器 / 假 ctx ───────────────────────────────────────────────────────

/** 加载 bundle，返回它注册的 { id, factory }。 */
function loadBundle() {
  let captured
  global.window = {
    __ModuleLoader__: {
      load(registration) {
        captured = registration
      },
    },
  }
  delete require.cache[require.resolve(BUNDLE)]
  require(BUNDLE)
  assert.ok(captured, 'bundle 必须调用 window.__ModuleLoader__.load()')
  return captured
}

/**
 * 构造一个假的客户端 ctx。
 * @param {{served?: boolean, writable?: boolean, status?: string, configured?: boolean}} [options]
 */
function makeCtx(options = {}) {
  const { served = true, writable = true, status = 'ready', configured = false, noConfigForms = false } = options
  const sections = []
  const effects = []
  const writes = []
  const dicts = new Map()
  /** 捕获 whileServed 的回调，用于模拟命名空间被服务。 */
  const servedHooks = []

  const form = {
    getSnapshot: () => ({ status, value: {}, base: {}, user: {}, writable, revision: 1, mode: 'host' }),
    subscribe: () => () => {},
    set: async (field, value) => {
      writes.push({ op: 'set', field, value })
      return true
    },
    unset: async (field) => {
      writes.push({ op: 'unset', field })
      return true
    },
    mutate: async () => true,
  }

  const mirror = {
    getSnapshot: () => ({
      status: 'ready',
      view: {
        namespaces: served
          ? [{ ns: NS, secrets: [{ path: ['apiKey'], set: configured }] }]
          : [],
      },
      error: null,
    }),
    subscribe: () => () => {},
    ensure: async () => {},
    acceptView: () => {},
    namespace: (ns) => (served && ns === NS ? { ns, secrets: [{ path: ['apiKey'], set: configured }] } : undefined),
  }

  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    effect(fn, label) {
      effects.push(label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    slots: {
      inject(slot, register) {
        const dispose = register()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(slotOptions, Component) {
        sections.push({ options: slotOptions, Component })
        return () => {}
      },
      entries: () => [],
      getVersion: () => 0,
      subscribe: () => () => {},
    },
    locale: {
      register(ns, dict) {
        dicts.set(ns, dict)
        return () => {}
      },
      // 真契约是 `ctx.locale.register(ns, { zh, en })`：字典按语言分层。
      bind(ns) {
        return (key) => {
          const dict = dicts.get(ns)
          const lang = dict && dict.zh ? 'zh' : 'en'
          const table = dict ? dict[lang] : undefined
          return table && key in table ? table[key] : key
        }
      },
      getSnapshot: () => ({ revision: 0 }),
      subscribe: () => () => {},
    },
    configForms: {
      get: (ns) => {
        assert.strictEqual(ns, NS, 'configForms.get 必须用 dsh-postman 命名空间')
        return form
      },
      describe: () => mirror,
      whileServed(namespaces, register) {
        assert.ok(namespaces.includes(NS), 'whileServed 必须跟随 dsh-postman 命名空间')
        servedHooks.push(register)
        if (served) register(new Set([NS]))
        return () => {}
      },
    },
  }

  // 0.1.x 的客户端没有 configForms 服务（只有 0.2.x 的 ui-settings 提供）。
  if (noConfigForms) delete ctx.configForms

  return { ctx, sections, effects, writes, dicts, servedHooks, form, mirror }
}

/** 深度遍历元素树，收集满足条件的节点。 */
function walk(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (typeof node.type === 'string') out.push(node)
  if (node.props && node.props.children) walk(node.props.children, out)
  return out
}

/** 把元素树里的文本拼起来，便于断言文案。 */
function textOf(node) {
  return walk(node)
    .map((el) => (Array.isArray(el.props.children) ? el.props.children.filter((c) => typeof c === 'string').join('') : ''))
    .join(' ')
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

console.log('客户端 bundle 校验（设置 → Postman 那一页）')

const registration = loadBundle()

check('bundle 用包名注册，并导出 name/inject/apply', () => {
  assert.strictEqual(registration.id, 'dsh-postman', 'bundle id 必须是包名（dsh-client-modules 的注册键）')
  assert.strictEqual(typeof registration.factory, 'function', 'factory 必须是函数')
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  assert.strictEqual(mod.name, 'dsh-postman')
  assert.ok(Array.isArray(mod.inject), 'inject 必须是数组')
  for (const service of ['slots', 'locale', 'configForms']) {
    assert.ok(mod.inject.includes(service), `inject 必须包含 ${service}`)
  }
  assert.strictEqual(typeof mod.apply, 'function', 'apply 必须是函数')
})

check('apply() 注册语言字典与 whileServed 订阅', () => {
  const { ctx, effects, dicts, servedHooks } = makeCtx()
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  assert.ok(dicts.has('settings.postman'), '必须注册 settings.postman 字典')
  assert.strictEqual(dicts.get('settings.postman').zh.nav, 'Postman')
  assert.strictEqual(dicts.get('settings.postman').en.nav, 'Postman')
  assert.strictEqual(servedHooks.length, 1, '必须通过 whileServed 跟随命名空间')
  assert.ok(effects.some((l) => /dictionaries/.test(l)), '字典注册要挂进 effect')
  assert.ok(effects.some((l) => /form subscriptions/.test(l)), '控制器释放要挂进 effect')
  assert.ok(effects.some((l) => /settings page/.test(l)), '页面注册要挂进 effect')
})

check('注册的槽位是 settings.section，id=postman，label 可解析', () => {
  const { ctx, sections } = makeCtx()
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  assert.strictEqual(sections.length, 1, '应注册一个设置分区')
  const { options, Component } = sections[0]
  assert.strictEqual(options.name, 'settings.section')
  assert.strictEqual(options.id, 'postman')
  assert.strictEqual(typeof options.order, 'number')
  assert.strictEqual(options.locale, 'settings.postman')
  assert.strictEqual(options.label(), 'Postman')
  assert.strictEqual(typeof Component, 'function', '必须提供组件')
})

check('命名空间未被服务时不注册分区（部署里不留痕迹）', () => {
  const { ctx, sections } = makeCtx({ served: false })
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  assert.strictEqual(sections.length, 0, '未服务时不应出现设置行')
})

check('组件在可用状态下渲染出密码输入框与「未配置」标记', () => {
  const { ctx, sections } = makeCtx({ configured: false })
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  const { options, Component } = sections[0]
  const injected = options.inject()
  const tree = Component({ ...injected, t: ctx.locale.bind('settings.postman') })
  const inputs = walk(tree).filter((el) => el.type === 'input')
  assert.strictEqual(inputs.length, 1, '应恰好有一个输入框')
  assert.strictEqual(inputs[0].props.type, 'password', 'Key 输入框必须是密码框')
  assert.strictEqual(inputs[0].props.autoComplete, 'new-password', '不应触发浏览器自动填充')
  assert.ok(textOf(tree).includes('未配置'), '应显示未配置状态')
})

check('组件在已配置状态下显示「已配置」', () => {
  const { ctx, sections } = makeCtx({ configured: true })
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  const { options, Component } = sections[0]
  const tree = Component({ ...options.inject(), t: ctx.locale.bind('settings.postman') })
  assert.ok(textOf(tree).includes('已配置'), '应显示已配置状态')
})

check('命名空间不可用时不渲染表单（只给一句说明）', () => {
  const { ctx, sections } = makeCtx({ status: 'unavailable' })
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  const { options, Component } = sections[0]
  const tree = Component({ ...options.inject(), t: ctx.locale.bind('settings.postman') })
  assert.strictEqual(walk(tree).filter((el) => el.type === 'input').length, 0, '不可用时应没有输入框')
  assert.ok(textOf(tree).includes('未提供'), '应说明命名空间未提供')
})

check('写入走 configForms 的 set/unset（命名空间 dsh-postman）', async () => {
  const { ctx, sections, writes } = makeCtx()
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  const injected = sections[0].options.inject()
  assert.strictEqual(typeof injected.controller.setKey, 'function')
  assert.strictEqual(typeof injected.controller.clearKey, 'function')
  return Promise.all([
    injected.controller.setKey('PMAK-test').then(() => {
      assert.deepStrictEqual(writes[0], { op: 'set', field: 'apiKey', value: 'PMAK-test' })
    }),
    injected.controller.clearKey().then(() => {
      assert.deepStrictEqual(writes[1], { op: 'unset', field: 'apiKey' })
    }),
  ])
})

check('控制器快照暴露 status/writable/configured', () => {
  const { ctx, sections } = makeCtx({ configured: true, writable: false })
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  const snapshot = sections[0].options.inject().controller.getSnapshot()
  assert.strictEqual(snapshot.status, 'ready')
  assert.strictEqual(snapshot.writable, false)
  assert.strictEqual(snapshot.configured, true)
})

check('缺少 configForms（0.1.x 客户端）时静默退出，不抛错', () => {
  const { ctx, sections, effects } = makeCtx({ noConfigForms: true })
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  // 不能抛：抛错会污染整个客户端启动
  mod.apply(ctx)
  assert.strictEqual(sections.length, 0, '没有 configForms 时不应注册分区')
  assert.ok(!effects.some((l) => /form subscriptions/.test(l)), '不应建立表单订阅')
  assert.ok(effects.some((l) => /dictionaries/.test(l)), '字典仍应注册（无害）')
})

check('保存成功的文案不承诺「立即生效」（长会话可能持有旧配置）', () => {
  const { ctx, dicts } = makeCtx()
  const mod = registration.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`未预期的 require：${id}`)
  })
  mod.apply(ctx)
  const zhSaved = dicts.get('settings.postman').zh.saved
  const enSaved = dicts.get('settings.postman').en.saved
  assert.ok(!zhSaved.includes('立即生效'), '中文文案不应声称立即生效')
  assert.ok(/新开一个会话|重启/.test(zhSaved), '中文文案应给出「新开会话/重启」的退路')
  assert.ok(/new session|restart/i.test(enSaved), '英文文案应给出「new session/restart」的退路')
})

// 异步断言收尾
setTimeout(() => {
  console.log('')
  if (failures === 0) {
    console.log('客户端 bundle 校验通过：设置里会出现 postman 一页，写 Key 走 dsh-postman 命名空间。')
    process.exit(0)
  } else {
    console.log(`客户端 bundle 校验失败：${failures} 项未通过。`)
    process.exit(1)
  }
}, 50)
