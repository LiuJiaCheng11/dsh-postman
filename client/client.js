/**
 * dsh-postman —— Client（浏览器）半边。
 *
 * 为什么需要这个文件：
 *   dsh 的「设置」导航行**只**来自客户端注册的 `settings.section` 槽位
 *   （见 `@deepseek-ai/dsh-client-ui-settings-general` 的 nav 投影：
 *   `rows = ctx.slots.entries('settings.section')`）。宿主侧的
 *   `settings.describe()` 虽然会给每个 profile 条目生成一个带 `autoGenerate`
 *   的描述符，但 **Web 客户端不消费 `autoGenerate`** —— 自动派生的页面不会
 *   出现在设置里。第三方插件（dshmarket / dsh-vision-router）都是自带一个
 *   `settings.section` 注册才在设置里有了自己的行。
 *
 * 所以这里注册一个 id 为 `postman` 的设置分区，页面直接编辑 `dsh-postman`
 * 命名空间的 `apiKey`。表单值走 `ctx.configForms`（与官方设置页同一套：
 * 读取脱敏、写入走 profile 的 user 层、带 revision 冲突栅栏）。
 *
 * 打包形态：
 *   宿主把本文件经 `/plugins` 原样发给浏览器，浏览器用
 *   `window.__ModuleLoader__.load({ id, factory })` 注册一个懒执行的工厂。
 *   `id` 必须是包名（dsh-client-modules 的契约：「Plugin id (package name) —
 *   the registration key; must match the graph row being executed」）。
 *   因此这里手写成普通 JS，不引入构建步骤；只 `require("react")`（宿主提供）。
 *
 * @module dsh-postman/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-postman',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** 本页编辑的设置命名空间（= profile 条目 id）。 */
    const NS = 'dsh-postman'

    /** 语言字典命名空间。 */
    const LOCALE_NS = 'settings.postman'

    /** 词典。 */
    const zh = {
      nav: 'Postman',
      title: 'Postman',
      intro: 'dsh-postman 插件用它访问线上 Postman 集合：列出集合、查看目录树、新增/删除接口、导入导出、扫源码补齐接口。',
      keyLabel: 'Postman API Key',
      keyHint: '在 Postman 账号设置 → API Keys 生成，PMAK- 开头。留空则依次回退到 ~/.dsh/dsh-postman/config.json、~/.postman_api_key、POSTMAN_API_KEY 环境变量。',
      keyPlaceholder: '粘贴 PMAK-... 开头的 Key',
      configured: '已配置',
      unconfigured: '未配置',
      save: '保存',
      saving: '保存中…',
      clear: '清除',
      saved: '已保存。若当前会话仍读到旧 Key，新开一个会话或重启 dsh。',
      cleared: '已清除，回退到下一个来源。同上，必要时新开会话。',
      saveFailed: '保存未生效（Host 拒绝或写入冲突），请重试。',
      unavailable: '当前 Host 未提供 dsh-postman 设置命名空间，无法在此配置。',
      readOnly: '当前部署的设置是只读的，无法在此写入。',
      secretNote: 'Key 是 secret 字段：读取时被抹掉，页面只显示是否已配置，明文不会回流浏览器。',
    }

    /** 英文词典。 */
    const en = {
      nav: 'Postman',
      title: 'Postman',
      intro: 'The dsh-postman plugin uses this key to work with your Postman cloud collections: list collections, inspect the tree, add/remove requests, import/export, and scan source code.',
      keyLabel: 'Postman API Key',
      keyHint: 'Create one at Postman account settings → API Keys (starts with PMAK-). Left empty, the plugin falls back to ~/.dsh/dsh-postman/config.json, ~/.postman_api_key, then the POSTMAN_API_KEY environment variable.',
      keyPlaceholder: 'Paste a PMAK-... key',
      configured: 'Configured',
      unconfigured: 'Not configured',
      save: 'Save',
      saving: 'Saving…',
      clear: 'Clear',
      saved: 'Saved. If this session still reads the old key, open a new session or restart dsh.',
      cleared: 'Cleared; the next source takes over. As above, a new session may be needed.',
      saveFailed: 'The save did not land (Host refused it or the write conflicted). Try again.',
      unavailable: 'This Host does not serve the dsh-postman settings namespace, so it cannot be configured here.',
      readOnly: 'Settings are read-only in this deployment.',
      secretNote: 'The key is a secret field: reads strip it, so this page only shows whether one is set. The value never travels back to the browser.',
    }

    // ── 样式（内联，避免额外依赖 CSS Modules） ──────────────────────────────
    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 2px' },
      intro: { margin: 0, fontSize: '12px', lineHeight: '18px', opacity: 0.7 },
      field: { display: 'flex', flexDirection: 'column', gap: '6px' },
      head: { display: 'flex', alignItems: 'center', gap: '8px' },
      label: { fontSize: '13px', fontWeight: 500 },
      tag: { fontSize: '11px', lineHeight: '16px', padding: '0 6px', borderRadius: '4px', border: '1px solid currentColor', opacity: 0.75 },
      input: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', fontSize: '13px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.4)', background: 'transparent', color: 'inherit' },
      hint: { margin: 0, fontSize: '11px', lineHeight: '16px', opacity: 0.65 },
      row: { display: 'flex', alignItems: 'center', gap: '8px' },
      button: { padding: '6px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.4)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      buttonGhost: { padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: 'none', background: 'transparent', color: 'inherit', opacity: 0.7, cursor: 'pointer' },
      ok: { margin: 0, fontSize: '12px', color: 'inherit', opacity: 0.8 },
      err: { margin: 0, fontSize: '12px', color: '#d9534f' },
      notice: { margin: 0, fontSize: '12px', opacity: 0.8 },
    }

    const disabledStyle = (disabled) => (disabled ? { ...S.button, opacity: 0.45, cursor: 'default' } : S.button)

    // ── 控制器：把 ConfigForm + describe 镜像折成一个可订阅快照 ──────────────
    //
    // `ctx.configForms.get(ns)` 给的是「值 + 写入队列」，但它的快照里**没有**
    // secrets（`ConfigFormSnapshot` 只到 revision/writable/value/base/user）。
    // 「Key 是否已配置」只能从 describe 镜像的命名空间视图读：
    // `SettingsNamespaceView.secrets = [{ path, set }]`（secret 字段的值被抹掉，
    // 只回一个 set 布尔）。所以这里同时订阅两个来源，折成一个投影。

    /** 浅比较两个投影快照（字段全是原始值）。 */
    function same(a, b) {
      if (a === b) return true
      if (a === null || b === null || a === undefined || b === undefined) return false
      const ka = Object.keys(a)
      if (ka.length !== Object.keys(b).length) return false
      for (const k of ka) if (a[k] !== b[k]) return false
      return true
    }

    /**
     * @param {object} ctx 客户端 cordis 上下文。
     * @returns {object} 页面用的控制器。
     */
    function createController(ctx) {
      const form = ctx.configForms.get(NS)
      const mirror = ctx.configForms.describe()
      const listeners = new Set()
      let cached = null

      /** 从两个来源投影出页面需要的全部状态。 */
      const project = () => {
        const snapshot = form.getSnapshot()
        const view = mirror.getSnapshot().view?.namespaces.find((row) => row.ns === NS)
        const secret = Array.isArray(view?.secrets)
          ? view.secrets.find((entry) => Array.isArray(entry.path) && entry.path.join('.') === 'apiKey')
          : undefined
        return {
          status: snapshot.status,
          writable: snapshot.writable,
          configured: secret?.set === true,
        }
      }

      const emit = () => {
        const next = project()
        if (same(next, cached)) return
        cached = next
        for (const listener of [...listeners]) listener()
      }

      const offForm = form.subscribe(emit)
      const offMirror = mirror.subscribe(emit)
      cached = project()

      return {
        getSnapshot: () => cached,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        /** 写入 Key；返回 Host 是否接受。 */
        setKey: (text) => form.set('apiKey', text),
        /** 清除 Key，让取值回退到下一个来源。 */
        clearKey: () => form.unset('apiKey'),
        dispose: () => {
          offForm()
          offMirror()
          listeners.clear()
        },
      }
    }

    // ── 页面组件 ───────────────────────────────────────────────────────────

    /**
     * 设置 → Postman 这一页。
     * @param {object} props 槽位注入的 props（`inject()` 的返回值 + 运行时 props）。
     * @returns {object} React 元素。
     */
    function PostmanSection(props) {
      const { controller, t } = props
      const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)

      const available = state.status === 'ready'
      const canWrite = available && state.writable

      const run = async (action, okText, failText) => {
        if (busy) return
        setBusy(true)
        setNotice(null)
        let ok = false
        try {
          ok = await action()
        } catch {
          ok = false
        }
        setBusy(false)
        if (ok) {
          setDraft('')
          setNotice({ kind: 'ok', text: okText })
        } else {
          setNotice({ kind: 'err', text: failText })
        }
      }

      const onSave = () => {
        const text = draft.trim()
        if (text === '') return
        return run(() => controller.setKey(text), t('saved'), t('saveFailed'))
      }

      const onClear = () => run(() => controller.clearKey(), t('cleared'), t('saveFailed'))

      if (!available) {
        return h('div', { style: S.page }, h('p', { style: S.notice }, t('unavailable')))
      }

      return h(
        'div',
        { style: S.page },
        h('p', { style: S.intro }, t('intro')),
        h(
          'div',
          { style: S.field },
          h(
            'div',
            { style: S.head },
            h('label', { style: S.label, htmlFor: 'dsh-postman-apiKey' }, t('keyLabel')),
            h('span', { style: S.tag }, state.configured ? t('configured') : t('unconfigured'))
          ),
          h('input', {
            id: 'dsh-postman-apiKey',
            style: S.input,
            type: 'password',
            autoComplete: 'new-password',
            spellCheck: false,
            placeholder: t('keyPlaceholder'),
            value: draft,
            disabled: !canWrite || busy,
            onChange: (event) => {
              setDraft(event.target.value)
              if (notice !== null) setNotice(null)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') void onSave()
            },
          }),
          h('p', { style: S.hint }, t('keyHint'))
        ),
        h(
          'div',
          { style: S.row },
          h(
            'button',
            {
              type: 'button',
              style: disabledStyle(!canWrite || busy || draft.trim() === ''),
              disabled: !canWrite || busy || draft.trim() === '',
              onClick: () => void onSave(),
            },
            busy ? t('saving') : t('save')
          ),
          state.configured && canWrite
            ? h(
                'button',
                { type: 'button', style: S.buttonGhost, disabled: busy, onClick: () => void onClear() },
                t('clear')
              )
            : null
        ),
        notice !== null ? h('p', { style: notice.kind === 'ok' ? S.ok : S.err }, notice.text) : null,
        !state.writable ? h('p', { style: S.notice }, t('readOnly')) : null,
        h('p', { style: S.hint }, t('secretNote'))
      )
    }

    // ── 插件契约 ───────────────────────────────────────────────────────────

    /** 插件名（= 包名，与 bundle id 一致）。 */
    const name = 'dsh-postman'

    /** 需要的客户端服务：槽位、语言、以及设置表单（configForms 由 ui-settings 提供）。 */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * 注册设置分区。
     * @param {object} ctx 客户端 cordis 上下文。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-postman: dictionaries')

      // 设置表单服务（configForms）与 settings.section 槽位都是 0.2.x 才有的。
      // 0.1.x 的客户端没有这两个东西 —— 缺了就静默退出，不要抛错（抛错会污染
      // 整个客户端启动，表现为「设置里少一页」之外还多一堆控制台错误）。
      // 宿主半边的工具不受影响：Key 仍可通过 cordis.patch.yml 或回退来源配置。
      if (ctx.configForms === undefined || ctx.configForms === null) {
        console.warn('[dsh-postman] 客户端未提供 configForms（0.2.x 才有），跳过设置分区注册。')
        return
      }
      if (ctx.slots === undefined || ctx.slots === null) {
        console.warn('[dsh-postman] 客户端未提供 slots 服务，跳过设置分区注册。')
        return
      }

      const controller = createController(ctx)
      ctx.effect(() => () => { controller.dispose() }, 'dsh-postman: form subscriptions')

      // 命名空间被 Host 服务时才出现这一页：部署里没有这个插件时不留痕迹
      // （与官方 ui-settings-shell / ui-settings-agent-loop 的做法一致）。
      ctx.effect(
        () =>
          ctx.configForms.whileServed([NS], () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'postman',
                  order: 35,
                  label: () => t('nav'),
                  locale: LOCALE_NS,
                  inject: () => ({ controller, t }),
                },
                PostmanSection
              )
            )
          ),
        'dsh-postman: settings page'
      )
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
