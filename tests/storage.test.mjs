import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/storage.js";

test("浏览器不提供IndexedDB时返回明确的不支持状态", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = undefined;
  try {
    await assert.rejects(
      () => openDatabase({ timeoutMs: 20 }),
      (error) => error.code === "DATABASE_UNSUPPORTED" && /不提供IndexedDB/.test(error.message),
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("浏览器安全策略拒绝存储时返回独立错误", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = { open: () => { throw new DOMException("denied", "SecurityError"); } };
  try {
    await assert.rejects(
      () => openDatabase({ timeoutMs: 20 }),
      (error) => error.code === "DATABASE_STORAGE_BLOCKED" && /安全策略/.test(error.message),
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("IndexedDB无事件返回时会超时结束而不是无限等待", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = { open: () => ({}) };
  try {
    await assert.rejects(
      () => openDatabase({ timeoutMs: 20 }),
      (error) => error.code === "DATABASE_OPEN_TIMEOUT" && /超过1秒/.test(error.message),
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("blocked事件会结束本次连接并返回可重试错误", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const request = {};
  globalThis.indexedDB = { open: () => request };
  try {
    const opening = openDatabase({ timeoutMs: 1000 });
    queueMicrotask(() => request.onblocked());
    await assert.rejects(
      () => opening,
      (error) => error.code === "DATABASE_OPEN_BLOCKED" && /另一个BAMOR页面/.test(error.message),
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});
