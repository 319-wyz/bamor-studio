import { assetsToCsv } from "./utils.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

function dateStamp() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function exportCsv(assets) {
  const content = `\uFEFF${assetsToCsv(assets)}`;
  downloadBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), `bamor-assets-${dateStamp()}.csv`);
}

export async function exportJson(records, aiTasks = []) {
  const output = [];
  for (const { asset, blob } of records) {
    output.push({
      asset,
      blob: blob ? { type: blob.type, data_url: await blobToDataUrl(blob) } : null,
    });
  }
  const payload = {
    format: "bamor-m1-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    storage_scope: "当前浏览器与当前站点来源；JSON内含元数据、可用图片数据和已保存AI任务，可由恢复入口导入",
    records: output,
    ai_tasks: aiTasks,
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `bamor-backup-${dateStamp()}.json`);
}
