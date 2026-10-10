'use strict'

/**
 * route-scanner 单元测试：用内联 fixture 验证解析规则，不依赖任何本机代码路径。
 *
 * 运行：node test/scanner.js
 */

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const scanner = require('../src/route-scanner.js')

const FIXTURE_BASE = `using Microsoft.AspNetCore.Mvc;

namespace App.Attendance.Api.Controllers
{
    [Area("Attendance")]
    public abstract class BaseController : CoreController
    {
    }
}
`

const FIXTURE_CONTROLLER = `using Microsoft.AspNetCore.Mvc;

namespace App.Attendance.Api.Controllers
{
    public class UserVacationController : BaseController
    {
        public UserVacationController(IBusiness b) : base(b)
        {
        }

        /// <summary>
        /// 获取某个员工的各种假期的信息
        /// </summary>
        /// <param name="userId">用户Id</param>
        /// <param name="year">年份</param>
        [HttpPost]
        [RightAuthorize("attendance$administration#1")]
        public async Task<CoreActionResult<Dictionary<string, object>>> Get(long userId, int? year, long processId = 0)
        {
            return null;
        }

        /// <summary>下载Excel表模板</summary>
        [HttpGet]
        public IActionResult DownloadTemplate()
        {
            return null;
        }

        /// <summary>两种动词都接受</summary>
        [HttpGet]
        [HttpPost]
        public IActionResult ExportExcel(DataSourceRequest<User> request, int year)
        {
            return null;
        }

        /// <summary>导出</summary>
        [HttpPost]
        [ExportToFile]
        public Task<IActionResult> Stats(List<long> ids, DateTime startDate, bool flag)
        {
            return null;
        }

        // 没有 [Http*] 特性的公共方法不应被当成 action
        public void HelperMethod()
        {
        }

        private void PrivateMethod()
        {
        }
    }
}
`

function writeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-postman-scan-'))
  const controllers = path.join(dir, 'App.Attendance.Api', 'Controllers')
  fs.mkdirSync(controllers, { recursive: true })
  fs.writeFileSync(path.join(controllers, 'BaseController.cs'), FIXTURE_BASE, 'utf8')
  fs.writeFileSync(path.join(controllers, 'UserVacationController.cs'), FIXTURE_CONTROLLER, 'utf8')
  // 干扰项：obj 目录下的自动生成文件不应被扫到
  const obj = path.join(dir, 'App.Attendance.Api', 'obj', 'Debug')
  fs.mkdirSync(obj, { recursive: true })
  fs.writeFileSync(
    path.join(obj, 'App.Attendance.Api.AssemblyInfo.cs'),
    'namespace X { public class FakeController { [HttpPost] public void Nope() {} } }',
    'utf8'
  )
  return dir
}

console.log('1) 参数解析')
{
  const params = scanner.parseParameters('long userId, int? year, bool isMonitor, long processId = 0')
  assert.strictEqual(params.length, 4)
  assert.deepStrictEqual(
    params.map((p) => [p.name, p.type, p.optional]),
    [
      ['userId', 'long', false],
      ['year', 'int?', true],
      ['isMonitor', 'bool', false],
      ['processId', 'long', true],
    ]
  )
  console.log('   ✓', JSON.stringify(params))
}

console.log('\n2) 泛型参数里的逗号不被误切')
{
  const params = scanner.parseParameters('Dictionary<string, object> map, List<long> ids')
  assert.strictEqual(params.length, 2, `实际 ${JSON.stringify(params)}`)
  assert.strictEqual(params[0].name, 'map')
  assert.strictEqual(params[0].type, 'Dictionary<string, object>')
  assert.strictEqual(params[1].name, 'ids')
  assert.strictEqual(params[1].type, 'List<long>')
  console.log('   ✓', params.map((p) => `${p.type} ${p.name}`).join(' | '))
}

console.log('\n3) 特性拆分与取值')
{
  assert.deepStrictEqual(scanner.splitAttributes('[HttpGet][HttpPost]'), ['HttpGet', 'HttpPost'])
  assert.strictEqual(scanner.attrName('RightAuthorize("a$b#1")'), 'RightAuthorize')
  assert.strictEqual(scanner.attrStringArg('RightAuthorize("a$b#1")'), 'a$b#1')
  assert.strictEqual(scanner.attrStringArg('Area("Attendance")'), 'Attendance')
  console.log('   ✓')
}

console.log('\n4) 扫描 fixture 目录')
{
  const dir = writeFixture()
  const result = scanner.scanDirectory(dir)

  assert.strictEqual(result.warnings.length, 0, `不应有 warning：${result.warnings.join('; ')}`)
  assert.strictEqual(result.stats.routeCount, 4, `期望 4 条路由，实际 ${result.stats.routeCount}`)

  const byAction = Object.fromEntries(result.routes.map((r) => [r.action, r]))

  assert.ok(byAction.Get, '应有 Get')
  assert.strictEqual(byAction.Get.path, '/api/Attendance/UserVacation/Get')
  assert.deepStrictEqual(byAction.Get.verbs, ['POST'])
  assert.strictEqual(byAction.Get.summary, '获取某个员工的各种假期的信息')
  assert.strictEqual(byAction.Get.permission, 'attendance$administration#1')
  assert.strictEqual(byAction.Get.params.find((p) => p.name === 'userId').description, '用户Id')

  assert.deepStrictEqual(byAction.DownloadTemplate.verbs, ['GET'])
  assert.deepStrictEqual(byAction.ExportExcel.verbs, ['GET', 'POST'], '双动词应都保留')
  assert.strictEqual(byAction.Stats.exportToFile, true)

  assert.ok(!byAction.HelperMethod, '无 [Http*] 的公共方法不应被当成 action')
  assert.ok(!byAction.PrivateMethod, '私有方法不应被当成 action')
  assert.ok(!result.routes.some((r) => r.file.includes('obj/')), 'obj 目录应被跳过')

  console.log('   ✓ 4 条路由：', result.routes.map((r) => `${r.verbs.join('|')} ${r.path}`).join('  '))
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log('\n5) 请求体骨架生成')
{
  const body = scanner.buildSampleBody([
    { name: 'userId', type: 'long' },
    { name: 'year', type: 'int?' },
    { name: 'name', type: 'string' },
    { name: 'flag', type: 'bool' },
    { name: 'ids', type: 'List<long>' },
    { name: 'request', type: 'DataSourceRequest<User>' },
    { name: 'startDate', type: 'DateTime' },
  ])
  const parsed = JSON.parse(body)
  assert.strictEqual(parsed.userId, 0)
  assert.strictEqual(parsed.year, 0)
  assert.strictEqual(parsed.name, '')
  assert.strictEqual(parsed.flag, false)
  assert.deepStrictEqual(parsed.ids, [])
  assert.deepStrictEqual(parsed.request, {})
  assert.strictEqual(typeof parsed.startDate, 'string')
  assert.strictEqual(scanner.buildSampleBody([]), '')
  console.log('   ✓', body.replace(/\n\s*/g, ' '))
}

console.log('\n全部通过 ✅')
