import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.BAMOR_TEST_URL || "http://127.0.0.1:4173";
const debuggerUrl = process.env.BAMOR_DEBUG_URL || "http://127.0.0.1:9223";
const downloadPath = resolve("tests", "downloads");
await mkdir(downloadPath, { recursive: true });
for (const name of await readdir(downloadPath)) await unlink(resolve(downloadPath, name));

const targets = await fetch(`${debuggerUrl}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url === "about:blank") ?? targets.find((item) => item.type === "page");
if (!target) throw new Error("没有找到可用于测试的Edge页面");

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
    const { resolve: resolveCall, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolveCall(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") {
    const detail = message.params.exceptionDetails;
    browserErrors.push(detail.exception?.description || `${detail.text} @ ${detail.url || "unknown"}:${detail.lineNumber ?? "?"}`);
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

async function waitFor(expression, message, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`等待超时：${message}`);
}

const checks = [];
function checked(label, detail = "") { checks.push({ label, detail, passed: true }); }

await command("Runtime.enable");
await command("Page.enable");
await command("Log.enable");
await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath });
const navigation = await command("Page.navigate", { url: baseUrl });
if (navigation.errorText) throw new Error(`页面导航失败：${navigation.errorText}`);
await waitFor("document.readyState === 'complete' && document.querySelector('#result-count')", "应用初始化");
await evaluate(`new Promise((resolve, reject) => {
  const request = indexedDB.open('bamor-design-studio');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const storeNames = ['assets', 'blobs', 'ai_tasks'].filter(name => db.objectStoreNames.contains(name));
    const transaction = db.transaction(storeNames, 'readwrite');
    transaction.objectStore('assets').clear();
    transaction.objectStore('blobs').clear();
    if (storeNames.includes('ai_tasks')) transaction.objectStore('ai_tasks').clear();
    transaction.oncomplete = () => { db.close(); resolve(true); };
    transaction.onerror = () => reject(transaction.error);
  };
})`);
await evaluate("window.__bamorQaBeforeReload = true");
await command("Page.reload", { ignoreCache: true });
await waitFor("!window.__bamorQaBeforeReload && document.readyState === 'complete' && document.querySelector('#storage-status')?.dataset.state === 'ready' && document.querySelector('#result-count')?.textContent.includes('0 / 0')", "清理测试数据后的应用初始化");
browserErrors.length = 0;
await new Promise((resolveWait) => setTimeout(resolveWait, 250));

const title = await evaluate("document.title");
if (title !== "BAMOR Design Studio · M1") throw new Error(`标题不正确：${title}`);
checked("应用成功加载", title);

const theme = await evaluate(`({
  page: getComputedStyle(document.body).backgroundColor,
  primary: getComputedStyle(document.querySelector('#import-samples')).backgroundColor,
  primaryText: getComputedStyle(document.querySelector('#import-samples')).color,
  secondary: getComputedStyle(document.querySelector('.button-secondary')).backgroundColor,
  introBackground: getComputedStyle(document.querySelector('.intro-panel')).backgroundColor,
  disabled: document.querySelector('#import-samples').disabled,
  variables: ['--paper','--cream','--sage','--caramel','--brown','--surface'].map(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()),
  lede: document.querySelector('.lede').textContent.trim(),
  introTitle: document.querySelector('#start-title').textContent.trim(),
  storageClosed: !document.querySelector('.storage-note details').open
})`);
if (theme.page !== "rgb(242, 245, 242)" || theme.primary !== "rgb(58, 35, 10)" || theme.primaryText !== "rgb(255, 255, 255)" || theme.secondary !== "rgb(255, 255, 255)" || theme.introBackground !== "rgb(141, 162, 140)") {
  throw new Error(`主题颜色未正确应用：${JSON.stringify(theme)}`);
}
if (theme.lede !== "整理项目素材，比较不同方案，留下选择依据。" || theme.introTitle !== "先从8份项目样例开始" || !theme.storageClosed) throw new Error("开场文案或折叠保存说明不正确");
checked("浅灰绿、白色、鼠尾草绿、深棕与焦糖强调主题", JSON.stringify(theme));

await waitFor("document.querySelector('#ai-status')?.dataset.state === 'unconfigured'", "AI未配置状态");
const aiDisconnected = await evaluate(`({
  status: document.querySelector('#ai-status').textContent.trim(),
  help: document.querySelector('#ai-connection-help').textContent.trim(),
  disabled: document.querySelector('#run-ai-selection').disabled,
  taskCount: document.querySelector('#ai-task-count').textContent
})`);
if (!aiDisconnected.status.includes("未配置模型密钥") || !aiDisconnected.help.includes("OPENAI_API_KEY") || !aiDisconnected.disabled || aiDisconnected.taskCount !== "0") {
  throw new Error(`AI未连接状态不完整：${JSON.stringify(aiDisconnected)}`);
}
await evaluate("document.querySelector('[data-ai-preset=\"cover\"]').click()");
const coverPreset = await evaluate(`({ purpose: document.querySelector('#ai-purpose').value, count: document.querySelector('#ai-count').value, emphasis: document.querySelector('#ai-emphasis').value })`);
if (coverPreset.purpose !== "选择作品封面" || coverPreset.count !== "1" || !coverPreset.emphasis) throw new Error("封面测试任务快捷填写失败");
await evaluate("document.querySelector('[data-ai-preset=\"gridshell\"]').click()");
const gridPreset = await evaluate(`({ purpose: document.querySelector('#ai-purpose').value, count: document.querySelector('#ai-count').value, constraints: document.querySelector('#ai-constraints').value })`);
if (gridPreset.purpose !== "解释网格壳体构型" || gridPreset.count !== "2" || !gridPreset.constraints.includes("网格表皮")) throw new Error("网格壳体测试任务快捷填写失败");
checked("AI未连接状态与两项测试任务入口", "未配置时禁用真实调用，不生成模拟结果");

await evaluate("document.querySelector('#import-samples').click()");
await waitFor("document.querySelector('#result-count')?.textContent.includes('8 / 8')", "8份样例导入", 15000);
checked("样例导入", "8 / 8");

await evaluate("document.querySelector('#import-samples').click()");
await waitFor("!document.querySelector('#import-samples').disabled");
const repeatedCount = await evaluate("document.querySelectorAll('.asset-card').length");
if (repeatedCount !== 8) throw new Error(`重复导入后数量为${repeatedCount}`);
checked("重复导入去重", "仍为8份");

await evaluate(`(() => { const input = document.querySelector('#search-input'); input.value = '竹构'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await waitFor("document.querySelectorAll('.asset-card').length === 1", "搜索结果");
checked("标题/标签搜索", "竹构得到1项");
await evaluate("document.querySelector('#clear-filters').click()");
await waitFor("document.querySelectorAll('.asset-card').length === 8", "清除筛选");

await evaluate(`(() => { const input = document.querySelectorAll('[data-compare-id]')[0]; input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await waitFor("document.querySelectorAll('[data-compare-id]:checked').length === 1", "第一项比较选择");
await evaluate(`(() => { const input = document.querySelectorAll('[data-compare-id]')[1]; input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await waitFor("!document.querySelector('#open-compare').disabled", "两项比较可用");
await evaluate("document.querySelector('#open-compare').click()");
await waitFor("document.querySelector('#compare-dialog').open && document.querySelectorAll('.compare-item').length === 2", "比较板打开");
checked("2项并排比较", "比较板显示2份素材");
await evaluate("document.querySelector('#compare-dialog [data-close-dialog]').click()");

await evaluate("document.querySelector('[data-edit-id=\"a01\"]').click()");
await waitFor("document.querySelector('#editor-dialog').open", "编辑器打开");
await evaluate(`(() => {
  document.querySelector('#editor-tags').value = '图案, 中文标签';
  document.querySelector('#editor-status').value = 'rejected';
  document.querySelector('#editor-status').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('[data-score="structure_consistency"]').value = '4';
  document.querySelector('#editor-reason').value = '包含逗号, 引号"与\\n换行的取舍记录';
  document.querySelector('#rejection-reasons input[value="信息不足"]').checked = true;
  document.querySelector('#editor-form').requestSubmit();
})()`);
await waitFor("!document.querySelector('#editor-dialog').open && document.querySelector('[data-asset-id=\"a01\"] .status')?.textContent.includes('淘汰')", "标注保存");
checked("人工评分与取舍理由", "状态、评分、标签、原因已保存");

await evaluate("window.__bamorQaBeforeReload = true");
await command("Page.reload", { ignoreCache: true });
await waitFor("!window.__bamorQaBeforeReload && document.readyState === 'complete' && document.querySelector('#result-count')?.textContent.includes('8 / 8')", "刷新恢复", 15000);
await evaluate("document.querySelector('[data-edit-id=\"a01\"]').click()");
await waitFor("document.querySelector('#editor-dialog').open", "刷新后编辑器打开");
const persisted = await evaluate(`({
  score: document.querySelector('[data-score="structure_consistency"]').value,
  reason: document.querySelector('#editor-reason').value,
  status: document.querySelector('#editor-status').value,
  tag: document.querySelector('#editor-tags').value
})`);
if (persisted.score !== "4" || persisted.status !== "rejected" || !persisted.reason.includes("换行") || !persisted.tag.includes("中文标签")) {
  throw new Error(`刷新后标注不完整：${JSON.stringify(persisted)}`);
}
await evaluate("document.querySelector('#editor-dialog [data-close-dialog]').click()");
checked("刷新后恢复元数据与标注", JSON.stringify(persisted));

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
await evaluate(`(async () => {
  const binary = atob('${onePixelPng}');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const file = new File([bytes], '真实,上传.png', { type: 'image/png' });
  const transfer = new DataTransfer(); transfer.items.add(file);
  const input = document.querySelector('#image-upload');
  Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor("document.querySelector('#result-count')?.textContent.includes('9 / 9')", "真实图片上传", 15000);
checked("真实PNG上传", "素材总数9份");

await evaluate("window.__bamorQaBeforeReload = true");
await command("Page.reload", { ignoreCache: true });
await waitFor("!window.__bamorQaBeforeReload && document.readyState === 'complete' && document.querySelector('#result-count')?.textContent.includes('9 / 9')", "上传图片刷新恢复", 15000);
checked("刷新后恢复上传图片", "素材总数仍为9份");

await evaluate(`(() => { const select = document.querySelector('#source-filter'); select.value = 'uploaded_image'; select.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await waitFor("document.querySelectorAll('.asset-card').length === 1", "来源筛选");
checked("来源筛选", "本地上传得到1项");
await evaluate("document.querySelector('#clear-filters').click()");

await evaluate(`(() => {
  const file = new File(['not an image'], '错误.txt', { type: 'text/plain' });
  const transfer = new DataTransfer(); transfer.items.add(file);
  const input = document.querySelector('#image-upload');
  Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor("document.querySelector('#toast')?.textContent.includes('不支持该格式')", "错误格式提示");
checked("不支持格式错误状态", "显示具体原因");

await evaluate("document.querySelector('#export-csv').click()");
await evaluate("document.querySelector('#export-json').click()");
await waitFor("!document.querySelector('#export-json').disabled", "JSON导出完成", 15000);
let files = [];
for (let attempt = 0; attempt < 50; attempt += 1) {
  files = await readdir(downloadPath);
  if (files.some((name) => name.endsWith(".csv")) && files.some((name) => name.endsWith(".json")) && !files.some((name) => name.endsWith(".crdownload"))) break;
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
}
const csvName = files.find((name) => name.endsWith(".csv"));
const jsonName = files.find((name) => name.endsWith(".json"));
if (!csvName || !jsonName) throw new Error(`导出文件缺失：${files.join(", ")}`);
const csv = await readFile(resolve(downloadPath, csvName), "utf8");
if (csv.charCodeAt(0) !== 0xfeff || !csv.includes('"包含逗号, 引号""与\n换行的取舍记录"')) throw new Error("CSV的BOM或特殊字段转义不正确");
const backup = JSON.parse(await readFile(resolve(downloadPath, jsonName), "utf8"));
if (backup.records.length !== 9 || backup.records.some((record) => !record.blob?.data_url?.startsWith("data:image/")) || !Array.isArray(backup.ai_tasks)) throw new Error("JSON备份未完整包含9份素材、图片及AI任务容器");
checked("CSV导出", "中文BOM、逗号、引号和换行已核对");
checked("JSON完整备份", "9份元数据与图片数据已核对");

backup.records[0].asset.title = "JSON恢复验证";
const restoreText = JSON.stringify(backup);
await evaluate(`(() => {
  window.confirm = () => true;
  const file = new File([${JSON.stringify(restoreText)}], 'restore.json', { type: 'application/json' });
  const transfer = new DataTransfer(); transfer.items.add(file);
  const input = document.querySelector('#restore-json');
  Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor("[...document.querySelectorAll('.asset-title')].some(node => node.textContent === 'JSON恢复验证')", "JSON恢复", 15000);
checked("JSON恢复", "同ID记录和图片可恢复");

await evaluate("document.querySelector('#clear-filters').click()");
for (let index = 0; index < 4; index += 1) {
  await evaluate(`(() => { const input = document.querySelectorAll('[data-compare-id]')[${index}]; input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`document.querySelectorAll('[data-compare-id]:checked').length === ${index + 1}`, `选择第${index + 1}项`);
}
await evaluate(`(() => { const input = document.querySelectorAll('[data-compare-id]')[4]; input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await waitFor("document.querySelectorAll('[data-compare-id]:checked').length === 4 && document.querySelector('#toast').textContent.includes('最多选择4份')", "比较上限提示");
await evaluate("document.querySelector('#open-compare').click()");
await waitFor("document.querySelectorAll('.compare-item').length === 4", "4项比较");
checked("4项比较与上限", "4项可比较，第5项显示明确提示");
await evaluate("document.querySelector('.remove-compare').click()");
await waitFor("!document.querySelector('#compare-dialog').open && document.querySelectorAll('[data-compare-id]:checked').length === 3", "移除比较项");
await evaluate("document.querySelector('#open-compare').click()");
await waitFor("document.querySelectorAll('.compare-item').length === 3", "3项比较");
await evaluate("document.querySelector('#compare-dialog [data-close-dialog]').click()");
await evaluate(`(() => { const input = document.querySelector('[data-compare-id]:checked'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await waitFor("document.querySelectorAll('[data-compare-id]:checked').length === 2", "取消比较选择");
await evaluate(`(() => { const input = document.querySelector('[data-compare-id]:not(:checked)'); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await waitFor("document.querySelectorAll('[data-compare-id]:checked').length === 3", "替换比较选择");
checked("比较项移除、取消与替换", "4项移除为3项，并可取消和替换选择");

await evaluate(`(() => {
  const set = (selector, value) => { const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#stage-filter', 'term1'); set('#source-filter', 'project_page'); set('#type-filter', 'pattern_catalogue'); set('#status-filter', 'rejected');
})()`);
await waitFor("document.querySelectorAll('.asset-card').length === 1", "组合筛选");
checked("阶段/来源/类型/状态组合筛选", "组合结果1项");
await evaluate(`(() => { const input = document.querySelector('#search-input'); input.value = '绝对不存在的素材'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await waitFor("!document.querySelector('#empty-state').hidden && !document.querySelector('#empty-clear').hidden", "空结果状态");
checked("空结果状态", "显示说明与清除筛选入口");
await evaluate("document.querySelector('#empty-clear').click()");
await waitFor("document.querySelectorAll('.asset-card').length === 9", "空结果清除筛选");

await command("Page.addScriptToEvaluateOnNewDocument", { source: `
  const nativeFetch = window.fetch.bind(window);
  let delayFirstAiStatus = true;
  window.fetch = (input, options = {}) => {
    if (delayFirstAiStatus && String(input).includes('/api/ai-status')) {
      delayFirstAiStatus = false;
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }
    return nativeFetch(input, options);
  };
` });
await evaluate("window.__beforeAiTimeoutReload = true");
await command("Page.reload", { ignoreCache: true });
await waitFor("!window.__beforeAiTimeoutReload && document.querySelector('#storage-status')?.dataset.state === 'ready' && document.querySelector('#result-count')?.textContent.includes('9 / 9')", "模型检查期间素材库独立恢复", 15000);
await waitFor("document.querySelector('#ai-status')?.dataset.state === 'failed'", "模型检查超时结束", 8000);
const aiTimeoutState = await evaluate(`({
  label: document.querySelector('#ai-status').textContent.trim(),
  help: document.querySelector('#ai-connection-help').textContent.trim(),
  retryVisible: !document.querySelector('#retry-ai-status').hidden,
  assets: document.querySelectorAll('.asset-card').length
})`);
if (!aiTimeoutState.retryVisible || !aiTimeoutState.help.includes("超过5秒") || aiTimeoutState.assets !== 9) throw new Error(`AI超时状态不完整：${JSON.stringify(aiTimeoutState)}`);
await evaluate("document.querySelector('#retry-ai-status').click(); true");
await waitFor("document.querySelector('#ai-status')?.dataset.state === 'unconfigured'", "模型状态重试完成");
checked("模型检查超时、失败与重试", "5秒结束等待；素材库保持可用；重试后显示未配置");

await evaluate("window.scrollTo(0, 0)");
await evaluate("document.querySelector('#toast').hidden = true; true");
const desktopScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("tests", "m1-preview.png"), Buffer.from(desktopScreenshot.data, "base64"));
await command("Emulation.setDeviceMetricsOverride", { width: 360, height: 720, deviceScaleFactor: 1, mobile: true });
await new Promise((resolveWait) => setTimeout(resolveWait, 250));
const mobileScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("tests", "m1-preview-mobile.png"), Buffer.from(mobileScreenshot.data, "base64"));

if (browserErrors.length) throw new Error(`浏览器错误：${browserErrors.join("；")}`);
console.log(JSON.stringify({ checks, downloads: files, screenshots: ["tests/m1-preview.png", "tests/m1-preview-mobile.png"] }, null, 2));
socket.send(JSON.stringify({ id: ++sequence, method: "Browser.close" }));
await new Promise((resolveWait) => setTimeout(resolveWait, 250));
socket.close();
