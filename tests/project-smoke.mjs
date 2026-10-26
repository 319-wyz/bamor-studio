import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.BAMOR_TEST_URL || "http://127.0.0.1:4173";
const debuggerUrl = process.env.BAMOR_DEBUG_URL || "http://127.0.0.1:9224";
const targets = await fetch(`${debuggerUrl}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("没有找到可用于展示页测试的Edge页面");

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
  if (message.method === "Runtime.exceptionThrown") {
    const detail = message.params.exceptionDetails;
    browserErrors.push(detail.exception?.description || detail.text);
  }
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

async function waitFor(expression, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`等待超时：${label}`);
}

const checks = [];
function checked(label, detail) { checks.push({ label, detail, passed: true }); }

await command("Runtime.enable");
await command("Page.enable");
await command("Log.enable");
await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
const navigation = await command("Page.navigate", { url: `${baseUrl}/project` });
if (navigation.errorText) throw new Error(navigation.errorText);
await waitFor("document.readyState === 'complete' && document.querySelector('#parameter-grid div')", "展示页和参数加载");

const structure = await evaluate(`({
  title: document.title,
  chapters: document.querySelectorAll('[data-chapter]').length,
  workbenchHref: new URL(document.querySelector('.view-switch a[href="studio"]').href).pathname,
  processHref: document.querySelector('.hero-actions .primary-link').getAttribute('href'),
  fallbackImage: document.querySelector('#hero-media-frame img')?.getAttribute('src'),
  hasVideo: Boolean(document.querySelector('#hero-media-frame video')),
  fallbackCopy: document.querySelector('#hero-media figcaption').textContent,
  englishBlocks: document.querySelectorAll('[lang="en"]').length,
  background: getComputedStyle(document.body).backgroundColor,
  heroColor: getComputedStyle(document.documentElement).getPropertyValue('--sage').trim(),
  publicText: document.body.innerText
})`);
if (structure.title !== "BAMOR · 响应式空间项目展示" || structure.chapters !== 5 || structure.workbenchHref !== "/studio" || structure.processHref !== "#five-stage-preview") throw new Error(`展示页结构不完整：${JSON.stringify(structure)}`);
if (structure.hasVideo || !structure.fallbackImage?.includes("a07") || !structure.fallbackCopy.includes("研究原型")) throw new Error(`展示页首屏媒体不正确：${JSON.stringify(structure)}`);
if (/\.pdf|整页导出|待补|T2 p\d+|p18|p22/.test(structure.publicText)) throw new Error("公开叙事仍包含内部文件、页码或制作状态文案");
if (structure.englishBlocks < 15 || structure.background !== "rgb(242, 245, 242)" || structure.heroColor !== "#8da28c") throw new Error(`双语或主题不完整：${JSON.stringify(structure)}`);
checked("展示页结构、双语与返回工作台入口", `${structure.chapters}个章节，${structure.englishBlocks}处英文内容`);
checked("项目页不重复开场视频", "视频仅用于根路径；项目页显示完整构图的a07研究原型");

await evaluate("document.querySelector('[data-archive=\"bending\"]').click()")
await waitFor("document.querySelector('#archive-image').src.includes('a02')", "档案切换");
await evaluate(`(() => { const tab = document.querySelector('[data-archive="bending"]'); tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()`);
await waitFor("document.querySelector('#archive-image').src.includes('a03') && document.activeElement.dataset.archive === 'legs'", "档案键盘切换");
checked("实验档案切换", "点击与方向键均切换真实样例页");

const awakeCount = await evaluate("document.querySelectorAll('#parameter-grid div').length");
if (awakeCount !== 14) throw new Error(`Awake参数数目错误：${awakeCount}`);
await evaluate("document.querySelector('[data-state=\"Sleep\"]').click()")
await waitFor("document.querySelectorAll('#parameter-grid div').length === 14 && document.querySelector('#parameter-source').textContent.includes('Sleep')", "Sleep参数切换");
checked("几何记录呈现", "Awake与Sleep各14条，公开说明不暴露内部页码");

const trailInitial = await evaluate(`({ labels: [...document.querySelectorAll('[data-trail-stage]')].map(node => node.innerText.trim()), images: [...new Set(${JSON.stringify(["a03", "a02", "a04", "a08", "a07"])})] })`);
if (trailInitial.labels.length !== 5 || trailInitial.labels.some((label) => !label.includes("\n"))) throw new Error(`五阶段双语标签不完整：${JSON.stringify(trailInitial)}`);
await evaluate(`(() => { const button = document.querySelector('[data-trail-stage="0"]'); button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()`);
await waitFor("document.querySelector('#trail-image').src.includes('a02') && document.querySelector('[data-trail-stage=\"1\"]').getAttribute('aria-current') === 'step'", "键盘切换五阶段");
checked("五阶段证据导航", "五个中英标签固定可读，键盘切换到独立的材料试验图");

await evaluate("document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, document.querySelector('#five-stage-preview').offsetTop - 80)");
await new Promise((resolveWait) => setTimeout(resolveWait, 100));
const trailScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("tests", "project-trail-preview.png"), Buffer.from(trailScreenshot.data, "base64"));

await evaluate("document.querySelector('#motion-toggle').click()")
const motionOff = await evaluate("document.documentElement.dataset.motion === 'off' && document.querySelector('#motion-toggle').getAttribute('aria-pressed') === 'true'");
if (!motionOff) throw new Error("手动关闭动效失败");
checked("动效控制", "可手动关闭且暴露aria-pressed状态");

await evaluate("window.scrollTo(0, 0)");
const desktop = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("tests", "project-preview.png"), Buffer.from(desktop.data, "base64"));

await command("Emulation.setDeviceMetricsOverride", { width: 375, height: 760, deviceScaleFactor: 1, mobile: true });
await new Promise((resolveWait) => setTimeout(resolveWait, 250));
const mobileState = await evaluate(`({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  switchVisible: getComputedStyle(document.querySelector('.view-switch')).display !== 'none',
  cards: getComputedStyle(document.querySelector('.behaviour-visuals')).gridTemplateColumns
})`);
if (mobileState.overflow || !mobileState.switchVisible) throw new Error(`窄屏布局异常：${JSON.stringify(mobileState)}`);
const mobile = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("tests", "project-preview-mobile.png"), Buffer.from(mobile.data, "base64"));
checked("窄屏布局", "375px无横向溢出，页面切换入口保留");

await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await command("Page.reload", { ignoreCache: true });
await waitFor("document.readyState === 'complete' && document.documentElement.dataset.motion === 'off'", "系统减少动效模式");
checked("prefers-reduced-motion", "系统偏好会自动关闭非必要动效");

if (browserErrors.length) throw new Error(`浏览器错误：${browserErrors.join("；")}`);
console.log(JSON.stringify({ checks, screenshots: ["tests/project-preview.png", "tests/project-trail-preview.png", "tests/project-preview-mobile.png"] }, null, 2));
await command("Browser.close");
socket.close();
