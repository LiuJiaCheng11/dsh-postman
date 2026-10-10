'use strict'

/**
 * dsh-postman 配置页：一个自包含的 HTML（浅色主题），用于填写/验证/清除
 * Postman API Key。由插件在 webServer 上以 /dsh-postman 前缀提供。
 */

const CONFIG_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-postman · Postman 配置</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #ffffff; --border: #e3e6ea; --text: #1f2328;
    --muted: #6b7280; --accent: #ff6c37; --accent-dark: #e85c2a;
    --ok: #1a7f37; --err: #cf222e; --code-bg: #f2f4f7;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .logo {
    width: 34px; height: 34px; border-radius: 9px; flex: none;
    background: var(--accent); color: #fff; font-weight: 700; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  h1 { font-size: 20px; margin: 0; font-weight: 650; }
  .sub { color: var(--muted); margin: 2px 0 24px 46px; font-size: 13px; }
  .card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px; margin-bottom: 16px;
  }
  .card h2 { font-size: 15px; margin: 0 0 14px; font-weight: 620; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .hint { color: var(--muted); font-size: 12.5px; margin: 0 0 10px; }
  input[type=password], input[type=text] {
    width: 100%; padding: 10px 12px; border: 1px solid var(--border);
    border-radius: 8px; font: inherit; background: #fff; color: var(--text);
  }
  input:focus { outline: 2px solid rgba(255,108,55,.35); border-color: var(--accent); }
  .row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
  button {
    padding: 9px 16px; border-radius: 8px; border: 1px solid var(--border);
    background: #fff; color: var(--text); font: inherit; font-weight: 600; cursor: pointer;
  }
  button:hover { background: #f0f2f5; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { background: var(--accent-dark); }
  button.danger { color: var(--err); }
  .status { margin-top: 14px; font-size: 13px; padding: 10px 12px; border-radius: 8px; display: none; }
  .status.ok { display: block; background: #eaf7ee; color: var(--ok); }
  .status.err { display: block; background: #fdeceb; color: var(--err); }
  .meta { font-size: 13px; color: var(--muted); }
  .meta b { color: var(--text); font-weight: 600; }
  code {
    background: var(--code-bg); padding: 2px 6px; border-radius: 5px;
    font: 12.5px/1.4 ui-monospace, "Cascadia Code", Consolas, monospace;
  }
  ol { margin: 8px 0 0; padding-left: 20px; }
  li { margin-bottom: 6px; }
  a { color: var(--accent-dark); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">P</div>
    <h1>dsh-postman</h1>
  </header>
  <p class="sub">让 dsh 直接读写你的 Postman 云端集合</p>

  <div class="card">
    <h2>当前状态</h2>
    <div class="meta" id="state">读取中…</div>
  </div>

  <div class="card">
    <h2>Postman API Key</h2>
    <p class="hint">
      在 <a href="https://web.postman.co/settings/me/api-keys" target="_blank" rel="noreferrer">Postman 账号设置 → API Keys</a>
      生成一个 Key（<code>PMAK-</code> 开头），粘贴到下面。Key 只会保存在本机
      <code id="cfgpath">~/.dsh/dsh-postman/config.json</code>（权限 0600），不会上传到别处。
    </p>
    <label for="key">API Key</label>
    <input id="key" type="password" placeholder="PMAK-xxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx" autocomplete="off" spellcheck="false">
    <div class="row">
      <button class="primary" id="save">保存</button>
      <button id="verify">保存并验证</button>
      <button id="toggle" type="button">显示</button>
      <button class="danger" id="clear">清除</button>
    </div>
    <div class="status" id="status"></div>
  </div>

  <div class="card">
    <h2>怎么用</h2>
    <ol>
      <li>保存 Key 后回到 dsh 对话，直接说「列出我的 Postman 集合」。</li>
      <li>新增接口：「在 App 的『测试』目录下加一个 GET 接口 …」。</li>
      <li>也可以让我扫代码批量生成接口。</li>
    </ol>
    <p class="hint" style="margin-top:12px">
      提示：修改插件设置后无需重启 dsh；只有新增/升级插件本体时才需要重启。
    </p>
  </div>
</div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $('status');

  function show(kind, msg) {
    statusEl.className = 'status ' + kind;
    statusEl.textContent = msg;
  }

  function refresh() {
    fetch('api/config', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var lines = [];
        if (d.configured) {
          lines.push('已配置：<b>' + (d.masked || '') + '</b>');
          lines.push('来源：' + (d.source || ''));
          if (d.file) lines.push('文件：<code>' + d.file + '</code>');
        } else {
          lines.push('<b>尚未配置</b> API Key');
        }
        $('state').innerHTML = lines.join('<br>');
        if (d.configFile) $('cfgpath').textContent = d.configFile;
      })
      .catch(function (e) { $('state').textContent = '读取状态失败：' + e; });
  }

  function submit(verify) {
    var key = $('key').value.trim();
    if (!key) { show('err', '请先填写 API Key'); return; }
    var url = verify ? 'api/config?verify=1' : 'api/config';
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) { show('err', res.body.error || '保存失败'); return; }
        if (res.body.verified === false) {
          show('err', '已保存，但验证未通过：' + (res.body.verifyError || '未知错误'));
        } else {
          show('ok', verify ? '已保存并验证通过 ✓' : '已保存 ✓');
        }
        $('key').value = '';
        refresh();
      })
      .catch(function (e) { show('err', '请求失败：' + e); });
  }

  $('save').addEventListener('click', function () { submit(false); });
  $('verify').addEventListener('click', function () { submit(true); });
  $('toggle').addEventListener('click', function () {
    var el = $('key');
    el.type = el.type === 'password' ? 'text' : 'password';
    this.textContent = el.type === 'password' ? '显示' : '隐藏';
  });
  $('clear').addEventListener('click', function () {
    if (!confirm('确定清除已保存的 API Key？')) return;
    fetch('api/config', { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function () { show('ok', '已清除'); refresh(); })
      .catch(function (e) { show('err', '清除失败：' + e); });
  });

  refresh();
})();
</script>
</body>
</html>
`

module.exports = { CONFIG_PAGE }
