// Собирает демо в один HTML-файл: настоящий интерфейс (web/) + «сервер в браузере» (mock.js).
//   node web-demo/build-demo.mjs   → ../demo/index.html
import { readFileSync, writeFileSync } from 'node:fs';

const web = (f) => new URL(`../web/${f}`, import.meta.url);
const css = readFileSync(web('app.css'), 'utf8');
const app = readFileSync(web('app.js'), 'utf8');
const sheet = readFileSync(web('sheet.js'), 'utf8');
const mock = readFileSync(new URL('./mock.js', import.meta.url), 'utf8');
const logo = 'data:image/png;base64,' + readFileSync(web('logo.png')).toString('base64');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const html = `<title>SpaceKit Заявки</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${css.replaceAll('/logo.png', logo)}
body{min-height:100vh}
.demo-chip{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:max(12px,env(safe-area-inset-bottom,0px));z-index:65;display:flex;gap:6px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 8px;box-shadow:var(--shadow);font-size:12px;color:var(--mute)}
.demo-chip select{border:1px solid var(--line2);border-radius:9px;padding:4px 6px;background:#fff;font-size:12px;max-width:170px}
.demo-chip button{border:0;background:none;color:var(--acc2);cursor:pointer;font-size:12px;text-decoration:underline}
</style>
<div class="top"><div class="in" id="top"></div></div>
<div id="app"><div class="wrap loading"><div class="skel"></div><div class="skel"></div></div></div>
<div class="toast" id="toast"></div>
<div class="demo-chip" id="demoChip">Демо · <select id="demoRole" aria-label="Сменить роль"></select><button id="demoReset" type="button">сбросить</button></div>
<script>
${safe(mock)}
</script>
<script>
${safe(sheet)}
</script>
<script>
${safe(app.replaceAll("'/logo.png'", JSON.stringify(logo)).replaceAll('src="/logo.png"', `src="${logo}"`))}
</script>
<script>
// Переключатель роли: войти за другого человека, не выходя на экран входа.
(function () {
  var sel = document.getElementById('demoRole');
  sel.innerHTML = '<option value="">Сменить роль…</option>' + SK_DEMO.roles.map(function (r) { return '<option value="' + r[1] + '">' + r[0] + '</option>'; }).join('');
  sel.addEventListener('change', function () { var phone = sel.value; sel.value = ''; if (phone) SK_DEMO.login(phone); });
  document.getElementById('demoReset').addEventListener('click', function () { SK_DEMO.reset(); });
})();
</script>
`;
const out = new URL('../../demo/index.html', import.meta.url);
writeFileSync(out, html);
console.log('демо собрано:', out.pathname, Math.round(html.length / 1024), 'КБ');
