const DB_NAME = "bamor-design-studio";
const DB_VERSION = 2;
const ASSET_STORE = "assets";
const BLOB_STORE = "blobs";
const AI_TASK_STORE = "ai_tasks";
const DEFAULT_OPEN_TIMEOUT_MS = 8000;

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("数据库操作失败"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("数据库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("数据库事务已取消"));
  });
}

export class DatabaseUnavailableError extends Error {
  constructor(message = "本地素材库尚未连接，请等待连接完成或重试", code = "DATABASE_UNAVAILABLE") {
    super(message);
    this.name = "DatabaseUnavailableError";
    this.code = code;
  }
}

function databaseOpenError(error, prefix = "浏览器无法启动本地素材库") {
  const name = error?.name || "Error";
  if (name === "SecurityError") {
    return new DatabaseUnavailableError(
      "当前页面的浏览器安全策略禁止使用本地存储。请确认不是无痕/受限嵌入环境，并在允许站点存储的浏览器窗口中重试。",
      "DATABASE_STORAGE_BLOCKED",
    );
  }
  if (name === "InvalidStateError" || name === "UnknownError") {
    return new DatabaseUnavailableError(
      `${prefix}：浏览器存储当前不可用（${name}）。请关闭其他BAMOR页面后重试；不会清空现有数据。`,
      "DATABASE_STORAGE_UNAVAILABLE",
    );
  }
  return new DatabaseUnavailableError(`${prefix}：${error?.message || name}`, "DATABASE_OPEN_FAILED");
}

function requireDatabase(database) {
  if (!database || typeof database.transaction !== "function") throw new DatabaseUnavailableError();
  return database;
}

function startTransaction(database, stores, mode) {
  try {
    return requireDatabase(database).transaction(stores, mode);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    if (error?.name === "InvalidStateError") throw new DatabaseUnavailableError("本地素材库连接已关闭，请重试连接");
    throw error;
  }
}

export function openDatabase({ onBlocked, onVersionChange, timeoutMs = DEFAULT_OPEN_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    let upgradeError = null;
    let timeoutId = null;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    };

    if (!globalThis.indexedDB || typeof globalThis.indexedDB.open !== "function") {
      rejectOnce(new DatabaseUnavailableError(
        "当前浏览器环境不提供IndexedDB，本地素材库无法使用。请在允许站点存储的常规浏览器窗口中打开同一地址。",
        "DATABASE_UNSUPPORTED",
      ));
      return;
    }

    try {
      request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      rejectOnce(databaseOpenError(error));
      return;
    }

    timeoutId = setTimeout(() => {
      rejectOnce(new DatabaseUnavailableError(
        `打开本地素材库超过${Math.ceil(timeoutMs / 1000)}秒，浏览器没有返回成功、失败或阻塞事件。请关闭其他BAMOR页面后重试；若在内置浏览器中持续出现，表示该环境没有正常响应IndexedDB，请改用允许站点存储的系统浏览器打开同一地址。`,
        "DATABASE_OPEN_TIMEOUT",
      ));
    }, timeoutMs);

    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        let assetStore;
        if (!database.objectStoreNames.contains(ASSET_STORE)) {
          assetStore = database.createObjectStore(ASSET_STORE, { keyPath: "id" });
        } else assetStore = request.transaction.objectStore(ASSET_STORE);
        if (!assetStore.indexNames.contains("library_origin")) assetStore.createIndex("library_origin", "library_origin", { unique: false });
        if (!assetStore.indexNames.contains("review_status")) assetStore.createIndex("review_status", "review_status", { unique: false });
        if (!database.objectStoreNames.contains(BLOB_STORE)) {
          database.createObjectStore(BLOB_STORE, { keyPath: "id" });
        }
        let aiTaskStore;
        if (!database.objectStoreNames.contains(AI_TASK_STORE)) {
          aiTaskStore = database.createObjectStore(AI_TASK_STORE, { keyPath: "id" });
        } else aiTaskStore = request.transaction.objectStore(AI_TASK_STORE);
        if (!aiTaskStore.indexNames.contains("created_at")) aiTaskStore.createIndex("created_at", "created_at", { unique: false });
      } catch (error) {
        upgradeError = error;
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      database.onversionchange = () => {
        database.close();
        onVersionChange?.(database);
      };
      resolve(database);
    };
    request.onerror = () => {
      if (upgradeError) {
        rejectOnce(new DatabaseUnavailableError(
          `本地素材库兼容升级失败：${upgradeError.message || "未知错误"}`,
          "DATABASE_UPGRADE_FAILED",
        ));
        return;
      }
      rejectOnce(databaseOpenError(request.error, "无法打开本地素材库"));
    };
    request.onblocked = () => {
      if (settled) return;
      onBlocked?.();
      rejectOnce(new DatabaseUnavailableError(
        "数据库升级被另一个BAMOR页面阻止。请关闭其他BAMOR页面后重试。",
        "DATABASE_OPEN_BLOCKED",
      ));
    };
  });
}

export async function getAllAssets(database) {
  const transaction = startTransaction(database, ASSET_STORE, "readonly");
  return requestAsPromise(transaction.objectStore(ASSET_STORE).getAll());
}

export async function getAsset(database, id) {
  const transaction = startTransaction(database, ASSET_STORE, "readonly");
  return requestAsPromise(transaction.objectStore(ASSET_STORE).get(id));
}

export async function getBlob(database, id) {
  const transaction = startTransaction(database, BLOB_STORE, "readonly");
  const record = await requestAsPromise(transaction.objectStore(BLOB_STORE).get(id));
  return record?.blob ?? null;
}

export async function saveAsset(database, asset, blob = undefined) {
  const stores = blob === undefined ? [ASSET_STORE] : [ASSET_STORE, BLOB_STORE];
  const transaction = startTransaction(database, stores, "readwrite");
  transaction.objectStore(ASSET_STORE).put(asset);
  if (blob !== undefined) transaction.objectStore(BLOB_STORE).put({ id: asset.id, blob });
  await transactionDone(transaction);
}

export async function saveAssets(database, records) {
  const transaction = startTransaction(database, [ASSET_STORE, BLOB_STORE], "readwrite");
  const assets = transaction.objectStore(ASSET_STORE);
  const blobs = transaction.objectStore(BLOB_STORE);
  for (const record of records) {
    assets.put(record.asset);
    if (record.blob instanceof Blob) blobs.put({ id: record.asset.id, blob: record.blob });
  }
  await transactionDone(transaction);
}

export async function readCompleteLibrary(database) {
  const assets = await getAllAssets(database);
  return Promise.all(assets.map(async (asset) => ({ asset, blob: await getBlob(database, asset.id) })));
}

export async function getAllAiTasks(database) {
  const transaction = startTransaction(database, AI_TASK_STORE, "readonly");
  return requestAsPromise(transaction.objectStore(AI_TASK_STORE).getAll());
}

export async function getAiTask(database, id) {
  const transaction = startTransaction(database, AI_TASK_STORE, "readonly");
  return requestAsPromise(transaction.objectStore(AI_TASK_STORE).get(id));
}

export async function saveAiTask(database, task) {
  const transaction = startTransaction(database, AI_TASK_STORE, "readwrite");
  transaction.objectStore(AI_TASK_STORE).put(task);
  await transactionDone(transaction);
}

export async function saveAiTasks(database, tasks) {
  if (!tasks.length) return;
  const transaction = startTransaction(database, AI_TASK_STORE, "readwrite");
  const store = transaction.objectStore(AI_TASK_STORE);
  for (const task of tasks) store.put(task);
  await transactionDone(transaction);
}
