/**
 * 校验 marketplace/ 下的投稿条目是否符合 awesome-dsh-plugin 的收录规则。
 *
 * 规则来源是官方校验器本身（scripts/lib/entries.mjs 的 validateEntries），
 * 不是猜的：字段白名单、文件名 slug、name 与 url 必须同名、category 白名单、
 * description.en 必填且必须单行、不允许额外 locale。
 *
 * 需要 js-yaml（测试套件本身零依赖，所以它不挂在 `npm test` 里）：
 *   npm i -D js-yaml && npm run check:marketplace
 */
let yaml
try {
  yaml = require('js-yaml')
} catch {
  console.log('SKIP  需要 js-yaml 才能解析 YAML：npm i -D js-yaml 后再跑')
  process.exit(0)
}
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'marketplace', 'LiuJiaCheng11__dsh-postman.yml')
const raw = fs.readFileSync(file, 'utf8')

let doc
try {
  doc = yaml.load(raw)
} catch (e) {
  console.log('FAIL 解析失败:', e.message)
  process.exit(1)
}
console.log('OK   YAML 解析通过')
console.log('     doc =', JSON.stringify(doc, null, 2).replace(/\n/g, '\n     '))

const CATEGORIES = 'agi ui usage theme model identity session memory tools wsl browser vision voice docs skill notify dev security remote market fun'.split(' ')
const problems = []

// 文件名必须与 <owner>__<repo>.yml 一致
const base = path.basename(file)
if (base !== 'LiuJiaCheng11__dsh-postman.yml') problems.push('文件名不符：' + base)

// 必填
for (const k of ['url', 'name', 'category']) {
  if (typeof doc[k] !== 'string' || doc[k].trim() === '') problems.push('缺少或非字符串字段：' + k)
}
if (!doc.description || typeof doc.description.en !== 'string' || doc.description.en.trim() === '') {
  problems.push('description.en 必填，缺失或非字符串')
}

// url 与 name 必须一致（owner/repo）
const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(doc.url || '')
if (!m) problems.push('url 不是规范的 github 仓库地址：' + doc.url)
else {
  const want = m[1] + '/' + m[2]
  if (doc.name !== want) problems.push(`name 与 url 不一致：name=${doc.name} url 推出=${want}`)
  const wantFile = m[1] + '__' + m[2] + '.yml'
  if (base !== wantFile) problems.push(`文件名应为 ${wantFile}`)
}

// category 白名单
if (!CATEGORIES.includes(doc.category)) problems.push('category 不在白名单：' + doc.category)

// 不允许的字段
if ('npm' in doc) problems.push('yml 里不允许手写 npm: 字段')

// 描述不得含营销词 / 不得有 ": " 未加引号导致的问题（解析已通过，这里只做提示）
const MARKETING = ['best', 'greatest', 'amazing', 'powerful', 'ultimate', 'blazing', '最简单', '最好', '最强', '极致']
for (const [loc, s] of [['en', doc.description?.en], ['zh', doc.description?.zh]]) {
  if (typeof s !== 'string') continue
  for (const w of MARKETING) {
    if (s.toLowerCase().includes(w)) problems.push(`description.${loc} 含疑似营销词「${w}」`)
  }
  if (!/[.。]$/.test(s.trim())) problems.push(`description.${loc} 建议以句号结尾`)
  if (loc === 'en' && /: /.test(s)) problems.push('description.en 含 ": "，必须加引号')
}

// tarball 若存在必须是 https .tgz
if (doc.tarball !== undefined) {
  if (!/^https:\/\/[^\s]+\.tgz$/.test(doc.tarball)) problems.push('tarball 必须是 https 的 .tgz 链接')
}

// ── CI 第 2 关：仓库 package.json 必须声明 dsh.bundle ──────────────────────
// 官方 gate 会去 GitHub 上抓 package.json 读这个字段；只声明 dsh.client 会被拒。
const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
if (!pkg.dsh || !pkg.dsh.bundle || typeof pkg.dsh.bundle.patch !== 'string') {
  problems.push('package.json 缺少 dsh.bundle.patch —— 只声明 dsh.client 无法安装，会被 CI 拒')
} else {
  const patch = path.join(__dirname, '..', pkg.dsh.bundle.patch)
  if (!fs.existsSync(patch)) problems.push(`dsh.bundle.patch 指向的文件不存在：${pkg.dsh.bundle.patch}`)
}
// repository 必须指回被收录的那个仓库（npm 关联靠它；留占位符会在人工评审时很难看）
if (pkg.repository && /USERNAME|OWNER|<.*>/.test(pkg.repository.url || '')) {
  problems.push('package.json 的 repository.url 还是占位符：' + pkg.repository.url)
}

console.log('')
if (problems.length === 0) console.log('OK   所有本地可校验的规则通过')
else {
  console.log('FAIL ' + problems.length + ' 个问题：')
  for (const p of problems) console.log('     - ' + p)
  process.exitCode = 1
}
