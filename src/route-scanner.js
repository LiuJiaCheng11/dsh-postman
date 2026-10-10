'use strict'

/**
 * ASP.NET Core 控制器路由扫描器（CJS，零依赖）。
 *
 * 针对本仓库（Uniwork / `E:\Code\App\App.Business`）的写法：
 *
 *   [Area("Attendance")]                       // 在 BaseController 上
 *   public class UserVacationController : BaseController
 *   {
 *       /// <summary>获取某个员工的各种假期的信息</summary>
 *       [HttpPost]
 *       [RightAuthorize("attendance$administration#1")]
 *       public async Task<...> Get(long userId, int? year, ...)
 *   }
 *
 * 推导出约定路由：`/api/{Area}/{Controller}/{Action}`。
 *
 * 设计取舍：
 *   - **只把带显式 `[Http*]` 特性的 public 方法当作 action**。本仓库每个 action
 *     都写了特性，这样能避免把控制器的公共辅助方法误报成接口。
 *   - 模块名以 `[Area("...")]` 为准（同一目录的 BaseController 上），
 *     拿不到才退回命名空间里 `App.<X>.Api` 的 `<X>`。
 *   - 纯文本解析，不依赖 Roslyn。对格式不规范的文件记 warning 而不是崩。
 */

const fs = require('node:fs')
const path = require('node:path')

/** 会被识别为 HTTP 动词的特性名 → 动词。 */
const HTTP_ATTRS = {
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpDelete: 'DELETE',
  HttpPatch: 'PATCH',
  HttpHead: 'HEAD',
  HttpOptions: 'OPTIONS',
}

/** 扫描时跳过的目录名。 */
const SKIP_DIRS = new Set(['obj', 'bin', '.vs', '.git', 'node_modules', 'packages', '.build-tmp'])

/** 去掉 UTF-8 BOM。 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 递归收集 .cs 文件。 */
function collectCsFiles(dir, out = [], depth = 0) {
  if (depth > 12) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectCsFiles(path.join(dir, entry.name), out, depth + 1)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/** 把一行里的多个特性拆开：`[HttpGet][HttpPost]` → ['HttpGet','HttpPost']。 */
function splitAttributes(line) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of line) {
    if (ch === '[') {
      depth += 1
      if (depth === 1) {
        cur = ''
        continue
      }
    } else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        out.push(cur.trim())
        continue
      }
    }
    cur += ch
  }
  return out.filter(Boolean)
}

/** 取特性名（去掉参数）：`RightAuthorize("x")` → `RightAuthorize`。 */
function attrName(attr) {
  const m = /^([A-Za-z_]\w*)/.exec(attr)
  return m ? m[1] : ''
}

/** 取特性的第一个字符串参数：`Area("Attendance")` → `Attendance`。 */
function attrStringArg(attr) {
  const m = /\(\s*"((?:[^"\\]|\\.)*)"/.exec(attr)
  return m ? m[1] : undefined
}

/** 按顶层分隔符切分（忽略 <> () [] 内部）。 */
function splitTopLevel(text, sep = ',') {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth -= 1
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim() !== '') out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** 解析参数列表字符串 → [{ name, type, optional, hasDefault }]。 */
function parseParameters(paramStr) {
  const params = []
  for (const raw of splitTopLevel(paramStr, ',')) {
    let decl = raw
    let hasDefault = false
    const eq = decl.indexOf('=')
    if (eq >= 0) {
      hasDefault = true
      decl = decl.slice(0, eq).trim()
    }
    // 去掉 params/ref/out/in/this 修饰
    decl = decl.replace(/^(?:params|ref|out|in|this)\s+/, '').trim()
    // 属性形式（C# 12 极少见）忽略
    const nameMatch = /([A-Za-z_]\w*)\s*$/.exec(decl)
    if (!nameMatch) continue
    const name = nameMatch[1]
    const type = decl.slice(0, nameMatch.index).trim()
    if (type === '') continue
    params.push({ name, type, optional: hasDefault || /\?$/.test(type), hasDefault })
  }
  return params
}

/** 从 XML 文档缓冲里取 <summary> 文本（压成一行）。 */
function extractSummary(docLines) {
  const text = docLines.join('\n')
  const m = /<summary>([\s\S]*?)<\/summary>/.exec(text)
  const raw = m ? m[1] : ''
  const cleaned = raw
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/\/?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  return cleaned
}

/** 从 XML 文档缓冲里取 <param name="x">说明</param> 映射。 */
function extractParamDocs(docLines) {
  const text = docLines.join('\n')
  const map = {}
  const re = /<param\s+name="([^"]+)"\s*>([\s\S]*?)<\/param>/g
  let m
  while ((m = re.exec(text)) !== null) {
    map[m[1]] = m[2].trim()
  }
  return map
}

/**
 * 解析单个控制器文件。
 * @param {string} file 文件绝对路径。
 * @param {string} [inheritedArea] 同目录 BaseController 上的 Area。
 * @returns {{ controller?: string, area?: string, abstract?: boolean, actions: object[], warnings: string[] }}
 */
function parseControllerFile(file, inheritedArea) {
  const text = stripBom(fs.readFileSync(file, 'utf8'))
  const lines = text.split(/\r?\n/)
  const warnings = []
  const actions = []

  let area = inheritedArea
  let controller
  let isAbstract = false

  let docBuf = []
  let attrBuf = []

  const flushReset = () => {
    docBuf = []
    attrBuf = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()

    if (t === '') continue

    // XML 文档注释
    if (t.startsWith('///')) {
      docBuf.push(t.slice(3).trim())
      continue
    }
    // 普通注释
    if (t.startsWith('//')) continue
    // 特性
    if (t.startsWith('[')) {
      attrBuf.push(...splitAttributes(t))
      continue
    }

    // 类声明
    const classMatch = /^(?:public|internal|protected|private)?\s*(static\s+|sealed\s+|partial\s+|abstract\s+)*class\s+([A-Za-z_]\w*)/.exec(t)
    if (classMatch) {
      isAbstract = /\babstract\b/.test(t)
      const areaAttr = attrBuf.find((a) => attrName(a) === 'Area')
      if (areaAttr) area = attrStringArg(areaAttr) || area
      controller = classMatch[2]
      flushReset()
      continue
    }

    // 方法签名：public/internal/protected 开头
    const modMatch = /^(public|internal|protected)\b/.exec(t)
    if (modMatch) {
      // 收集直到括号闭合
      let sig = t
      let j = i
      let guard = 0
      while (!/\)\s*(?:\{|;|=>|$)/.test(sig) && j + 1 < lines.length && guard < 40) {
        j += 1
        guard += 1
        sig += ' ' + lines[j].trim()
      }
      i = j

      const parenIdx = sig.indexOf('(')
      if (parenIdx > 0) {
        const head = sig.slice(0, parenIdx).trim()
        const nameMatch = /([A-Za-z_]\w*)\s*$/.exec(head)
        const methodName = nameMatch ? nameMatch[1] : ''
        const closeIdx = sig.lastIndexOf(')')
        const paramStr = closeIdx > parenIdx ? sig.slice(parenIdx + 1, closeIdx) : ''

        const isConstructor = methodName !== '' && methodName === controller
        const isPropertyOrField = !sig.includes('(') || paramStr === '' && !sig.includes(')')

        if (methodName !== '' && !isConstructor && !isPropertyOrField) {
          const httpAttrs = attrBuf.filter((a) => Object.prototype.hasOwnProperty.call(HTTP_ATTRS, attrName(a)))
          const verbs = [...new Set(httpAttrs.map((a) => HTTP_ATTRS[attrName(a)]))]

          if (verbs.length > 0) {
            const rightAttr = attrBuf.find((a) => attrName(a) === 'RightAuthorize')
            const paramDocs = extractParamDocs(docBuf)
            const params = parseParameters(paramStr).map((p) => ({
              ...p,
              description: paramDocs[p.name],
            }))
            actions.push({
              name: methodName,
              verbs,
              summary: extractSummary(docBuf),
              params,
              permission: rightAttr ? attrStringArg(rightAttr) : undefined,
              exportToFile: attrBuf.some((a) => attrName(a) === 'ExportToFile'),
              line: i + 1,
            })
          }
        }
      }
      flushReset()
      continue
    }

    // 其它行（#region、}、字段等）→ 清空缓冲，避免特性/文档串到别处
    flushReset()
  }

  return { controller, area, abstract: isAbstract, actions, warnings, file }
}

/**
 * 扫描目录，产出全部路由。
 * @param {string} rootDir 源码根目录。
 * @param {{ include?: RegExp, exclude?: RegExp }} [options] 可选的路径过滤。
 * @returns {{ routes: object[], stats: object, warnings: string[] }}
 */
function scanDirectory(rootDir, options = {}) {
  const abs = path.resolve(rootDir)
  if (!fs.existsSync(abs)) {
    throw new Error(`目录不存在：${abs}`)
  }

  const files = collectCsFiles(abs)
  const controllerFiles = files.filter((f) => /Controller\.cs$/i.test(path.basename(f)))

  const warnings = []
  const routes = []
  let parsedFiles = 0
  let abstractSkipped = 0

  // 先按目录收集 BaseController 的 Area，供同目录控制器继承
  const areaByDir = new Map()
  for (const f of controllerFiles) {
    if (!/BaseController\.cs$/i.test(path.basename(f))) continue
    try {
      const parsed = parseControllerFile(f)
      if (parsed.area) areaByDir.set(path.dirname(f), parsed.area)
    } catch (error) {
      warnings.push(`读取 ${f} 失败：${error && error.message}`)
    }
  }

  for (const file of controllerFiles) {
    if (options.include && !options.include.test(file)) continue
    if (options.exclude && options.exclude.test(file)) continue

    let parsed
    try {
      parsed = parseControllerFile(file, areaByDir.get(path.dirname(file)))
    } catch (error) {
      warnings.push(`解析 ${file} 失败：${error && error.message}`)
      continue
    }
    parsedFiles += 1

    if (parsed.abstract) {
      abstractSkipped += 1
      continue
    }
    if (!parsed.controller || parsed.controller === 'BaseController') continue
    if (parsed.actions.length === 0) continue

    const controllerName = parsed.controller.replace(/Controller$/, '')
    let area = parsed.area
    if (!area) {
      // 退回命名空间：App.<X>.Api.Controllers
      try {
        const text = stripBom(fs.readFileSync(file, 'utf8'))
        const ns = /namespace\s+([\w.]+)/.exec(text)
        if (ns) {
          const parts = ns[1].split('.')
          const idx = parts.indexOf('App')
          if (idx >= 0 && parts[idx + 1]) area = parts[idx + 1]
        }
      } catch {
        /* ignore */
      }
      if (!area) warnings.push(`${path.basename(file)}：拿不到 Area，已跳过`)
    }
    if (!area) continue

    for (const action of parsed.actions) {
      routes.push({
        area,
        controller: controllerName,
        action: action.name,
        path: `/api/${area}/${controllerName}/${action.name}`,
        verbs: action.verbs,
        summary: action.summary || '',
        params: action.params,
        permission: action.permission,
        exportToFile: action.exportToFile,
        file: path.relative(abs, file).split(path.sep).join('/'),
        line: action.line,
      })
    }
  }

  routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {
    routes,
    warnings,
    stats: {
      root: abs,
      csFiles: files.length,
      controllerFiles: controllerFiles.length,
      parsedFiles,
      abstractSkipped,
      areas: [...new Set(routes.map((r) => r.area))].sort(),
      routeCount: routes.length,
    },
  }
}

/** 把路由列表渲染成紧凑文本（给模型看）。 */
function renderRoutes(routes, limit = 200) {
  const lines = []
  for (const r of routes.slice(0, limit)) {
    const verbs = r.verbs.join('|')
    const perm = r.permission ? `  [${r.permission}]` : ''
    const exp = r.exportToFile ? '  [导出]' : ''
    lines.push(`  ${verbs.padEnd(12)} ${r.path}${perm}${exp}${r.summary ? `  — ${r.summary}` : ''}`)
  }
  if (routes.length > limit) lines.push(`  … 另有 ${routes.length - limit} 条`)
  return lines.join('\n')
}

/** 按 C# 类型给一个占位值，用于生成请求体骨架。 */
function sampleValueForType(type) {
  const t = String(type || '').trim()
  const bare = t.replace(/\?$/, '')
  if (/\[\]$/.test(bare) || /^(List|IList|IEnumerable|ICollection|Array|HashSet)</.test(bare)) return []
  if (/^(string|String)$/.test(bare)) return ''
  if (/^(int|long|short|byte|uint|ulong|ushort|sbyte)$/.test(bare)) return 0
  if (/^(decimal|double|float)$/.test(bare)) return 0
  if (/^(bool|Boolean)$/.test(bare)) return false
  if (/^(DateTime|DateTimeOffset)$/.test(bare)) return '2026-01-01 00:00:00'
  if (/^(Guid)$/.test(bare)) return '00000000-0000-0000-0000-000000000000'
  return {}
}

/**
 * 按参数列表生成 JSON 请求体骨架。
 * @param {Array<{name:string,type:string}>} params 路由参数。
 * @returns {string} 格式化后的 JSON 文本；无参数时返回 ''。
 */
function buildSampleBody(params) {
  const body = {}
  for (const p of params || []) body[p.name] = sampleValueForType(p.type)
  if (Object.keys(body).length === 0) return ''
  return JSON.stringify(body, null, 2)
}

module.exports = {
  HTTP_ATTRS,
  collectCsFiles,
  splitAttributes,
  attrName,
  attrStringArg,
  splitTopLevel,
  parseParameters,
  extractSummary,
  extractParamDocs,
  parseControllerFile,
  scanDirectory,
  renderRoutes,
  sampleValueForType,
  buildSampleBody,
}
