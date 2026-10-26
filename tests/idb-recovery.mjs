const baseUrl = process.env.BAMOR_TEST_URL || "http://127.0.0.1:4173";
const debuggerUrl = process.env.BAMOR_DEBUG_URL || "http://127.0.0.1:9666";

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const pauses = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result);
    }
    if (message.method === "Debugger.paused") {
      pauses.push(message.params.data?.description || message.params.reason);
      command("Debugger.resume").catch(() => {});
    }
  });
  function command(method, params = {}) {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  return { socket, command, evaluate, pauses };
}

async function waitFor(client, expression, message, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await client.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`等待超时：${message}`);
}

const fixtureTarget = await fetch(`${debuggerUrl}/json/new?${encodeURIComponent(`${baseUrl}/tests/blank.html`)}`, { method: "PUT" }).then((response) => response.json());
const fixture = await connect(fixtureTarget);
await fixture.command("Runtime.enable");
await waitFor(fixture, `location.origin === '${new URL(baseUrl).origin}'`, "测试页打开");
await fixture.evaluate(`new Promise((resolve, reject) => {
  const deletion = indexedDB.deleteDatabase('bamor-design-studio');
  deletion.onerror = () => reject(deletion.error);
  deletion.onsuccess = () => {
    const request = indexedDB.open('bamor-design-studio', 1);
    request.onupgradeneeded = () => {
      const assets = request.result.createObjectStore('assets', { keyPath: 'id' });
      assets.createIndex('library_origin', 'library_origin', { unique: false });
      request.result.createObjectStore('blobs', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      window.__legacyDb = request.result;
      const tx = window.__legacyDb.transaction(['assets', 'blobs'], 'readwrite');
      tx.objectStore('assets').put({ id: 'legacy-asset', title: '升级前素材', library_origin: 'upload', review_status: 'unreviewed', tags: [], materials: [], review_scores: {} });
      tx.objectStore('blobs').put({ id: 'legacy-asset', blob: new Blob(['fixture'], { type: 'image/png' }) });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
  };
})`);

const appTarget = await fetch(`${debuggerUrl}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((response) => response.json());
const app = await connect(appTarget);
await app.command("Runtime.enable");
await app.command("Page.enable");
await app.command("Debugger.enable");
await app.command("Debugger.setPauseOnExceptions", { state: "uncaught" });
await app.command("Page.navigate", { url: baseUrl });
await waitFor(app, `document.querySelector('#storage-status')?.dataset.state === 'blocked' && !document.querySelector('#retry-storage').hidden`, "显示升级阻塞状态并允许重试");
await waitFor(app, `document.querySelector('#ai-status')?.dataset.state !== 'checking'`, "模型状态独立结束等待");

const blocked = await app.evaluate(`({
  text: document.querySelector('#storage-status-text').textContent,
  retryVisible: !document.querySelector('#retry-storage').hidden,
  importDisabled: document.querySelector('#import-samples').disabled,
  aiState: document.querySelector('#ai-status').dataset.state
})`);
if (!blocked.retryVisible || !blocked.importDisabled || !blocked.text.includes("另一个BAMOR页面") || blocked.aiState === "checking") {
  throw new Error(`阻塞状态不完整：${JSON.stringify(blocked)}`);
}

await app.evaluate(`(() => {
  window.__storageStates = [];
  const target = document.querySelector('#storage-status');
  new MutationObserver(() => window.__storageStates.push(target.dataset.state)).observe(target, { attributes: true, attributeFilter: ['data-state'] });
})()`);
await app.evaluate("document.querySelector('#retry-storage').click(); true");
await waitFor(app, `window.__storageStates.includes('opening') && ['blocked', 'timeout'].includes(document.querySelector('#storage-status')?.dataset.state) && !document.querySelector('#retry-storage').hidden`, "阻塞后重试会进入明确终态");
await fixture.evaluate("window.__legacyDb.close(); true");
await app.evaluate("document.querySelector('#retry-storage').click(); true");
await waitFor(app, `document.querySelector('#storage-status')?.dataset.state === 'ready' && document.querySelector('#result-count')?.textContent.includes('1 / 1')`, "关闭旧连接后兼容升级", 15000);

const migrated = await app.evaluate(`new Promise((resolve, reject) => {
  const request = indexedDB.open('bamor-design-studio');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const indexes = [...db.transaction('assets', 'readonly').objectStore('assets').indexNames];
    resolve({ version: db.version, stores: [...db.objectStoreNames], indexes, legacyVisible: Boolean(document.querySelector('[data-asset-id="legacy-asset"]')) });
    db.close();
  };
})`);
if (migrated.version !== 2 || !migrated.stores.includes("ai_tasks") || !migrated.indexes.includes("review_status") || !migrated.legacyVisible) throw new Error(`兼容迁移失败：${JSON.stringify(migrated)}`);
if (app.pauses.some((item) => item.includes("transaction") || item.includes("TypeError"))) throw new Error(`仍出现数据库空连接异常：${app.pauses.join("\n")}`);

console.log(JSON.stringify({ passed: true, blocked, retryStates: await app.evaluate('window.__storageStates'), migrated, uncaughtExceptions: app.pauses }, null, 2));
fixture.socket.close();
app.socket.close();
