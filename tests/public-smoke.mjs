import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = (process.env.BAMOR_TEST_URL || "http://127.0.0.1:4174").replace(/\/$/, "");
const debuggerUrl = process.env.BAMOR_DEBUG_URL || "http://127.0.0.1:9226";
const targets = await fetch(`${debuggerUrl}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("没有找到公开静态版测试页面");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const browserErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") browserErrors.push(message.params.entry.text);
});
function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }));
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, label, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`等待超时：${label}`);
}
const checks = [];
const checked = (label, detail) => checks.push({ label, detail, passed: true });

await command("Runtime.enable");
await command("Page.enable");
await command("Log.enable");
await command("Network.enable");
await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
await command("Page.navigate", { url: `${baseUrl}/` });
await waitFor("document.readyState === 'complete' && document.querySelector('#landing')?.dataset.media === 'video'", "真实开场视频");
const landing = await evaluate(`({
  title: document.title,
  muted: document.querySelector('#landing-video').muted,
  loop: document.querySelector('#landing-video').loop,
  playsInline: document.querySelector('#landing-video').playsInline,
  readyState: document.querySelector('#landing-video').readyState,
  projectPath: new URL(document.querySelector('.entry-primary').href).pathname,
  studioPath: new URL(document.querySelector('.entry-secondary').href).pathname
})`);
if (!landing.muted || !landing.loop || !landing.playsInline || landing.readyState < 2 || landing.projectPath !== "/project" || landing.studioPath !== "/studio") throw new Error(`开场不完整：${JSON.stringify(landing)}`);
await evaluate("document.querySelector('#toggle-video').click()")
await waitFor("document.querySelector('#landing-video').paused && document.querySelector('#toggle-video').getAttribute('aria-pressed') === 'true'", "暂停视频");
checked("根路径双入口与真实视频", "静音、循环、playsinline、可暂停；项目与工作台入口清楚");

const landingDesktop = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("tests", "landing-preview.png"), Buffer.from(landingDesktop.data, "base64"));
await command("Emulation.setDeviceMetricsOverride", { width: 375, height: 760, deviceScaleFactor: 1, mobile: true });
await new Promise((resolveWait) => setTimeout(resolveWait, 250));
const mobileLanding = await evaluate(`({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, actions: [...document.querySelectorAll('.landing-actions a')].every(node => node.getBoundingClientRect().height > 40) })`);
if (mobileLanding.overflow || !mobileLanding.actions) throw new Error(`移动端双入口异常：${JSON.stringify(mobileLanding)}`);
const landingMobile = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("tests", "landing-preview-mobile.png"), Buffer.from(landingMobile.data, "base64"));
checked("移动端开场", "375px无横向溢出，两个入口均保持可点击");

await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
await command("Page.navigate", { url: `${baseUrl}/project` });
await waitFor("document.title.includes('响应式空间项目展示') && document.querySelector('#trail-image')", "项目深链接");
await evaluate(`(() => { const field = document.querySelector('#trail-field'); const rect = field.getBoundingClientRect(); field.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * .2, clientY: rect.top + 100, pointerType: 'mouse', bubbles: true })); })()`);
await waitFor("document.querySelector('[data-trail-stage=\"0\"]').getAttribute('aria-current') === 'step'", "边界归左");
await evaluate(`(() => { const field = document.querySelector('#trail-field'); const rect = field.getBoundingClientRect(); field.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * .201, clientY: rect.top + 100, pointerType: 'mouse', bubbles: true })); })()`);
await waitFor("document.querySelector('[data-trail-stage=\"1\"]').getAttribute('aria-current') === 'step'", "越界进入右区");
checked("项目深链接与五阶段边界", "直接访问不重播开场；20%边界归左，越界后进入下一阶段");

await command("Page.navigate", { url: `${baseUrl}/studio` });
await waitFor("document.querySelector('#storage-status')?.dataset.state === 'ready'", "静态工作台初始化");
await waitFor("document.querySelector('#ai-status')?.textContent.includes('在线展示版暂不可调用AI')", "静态AI状态");
const manifest = await evaluate(`fetch('data/assets.json', { cache: 'no-store' }).then(async response => ({ status: response.status, type: response.headers.get('content-type'), count: (await response.json()).length }))`);
if (manifest.status !== 200 || !manifest.type.includes("application/json") || manifest.count !== 8) throw new Error(`公开清单异常：${JSON.stringify(manifest)}`);
await evaluate("document.querySelector('#import-samples').click()")
await waitFor("document.querySelector('#result-count')?.textContent.includes('8 / 8')", "公开精选案例导入", 15000);
const loadedImages = await evaluate("[...document.querySelectorAll('.asset-image')].filter(image => image.complete && image.naturalWidth > 0).length");
if (loadedImages !== 8) throw new Error(`公开精选图片只加载${loadedImages}/8`);
await evaluate("document.querySelector('#import-samples').click()")
await waitFor("!document.querySelector('#import-samples').disabled && document.querySelectorAll('.asset-card').length === 8", "公开导入去重");
checked("公开工作台精选案例", "JSON为application/json；8张图全部加载；重复导入仍为8份");
checked("静态AI状态", "明确说明在线展示版不可调用AI，人工工作流保持可用");

if (browserErrors.length) throw new Error(`页面错误：${browserErrors.join("；")}`);
browserErrors.length = 0;
await command("Network.setBlockedURLs", { urls: ["*bamor-1024.mp4*"] });
await command("Page.navigate", { url: `${baseUrl}/` });
await waitFor("document.querySelector('#landing')?.dataset.media === 'fallback'", "无视频回退", 12000);
const fallback = await evaluate(`({ image: document.querySelector('#landing-poster').complete && document.querySelector('#landing-poster').naturalWidth > 0, links: document.querySelectorAll('.landing-actions a').length, note: document.querySelector('#media-note').textContent })`);
if (!fallback.image || fallback.links !== 2 || !fallback.note.includes("入口")) throw new Error(`无视频回退不完整：${JSON.stringify(fallback)}`);
checked("视频故障回退", "真实项目图与两个入口保持可用");

console.log(JSON.stringify({ checks, screenshots: ["tests/landing-preview.png", "tests/landing-preview-mobile.png"] }, null, 2));
await command("Browser.close");
socket.close();
