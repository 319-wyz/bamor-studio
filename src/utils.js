export const SCORE_KEYS = ["structure_consistency", "material_expression", "scene_fit", "visual_clarity"];
export const REJECTION_REASONS = ["结构关系失真", "材料不一致", "场景尺度不符", "主体遮挡", "画面不清", "重复", "信息不足", "其他"];

export const STATUS_LABELS = {
  unreviewed: "待审核",
  approved: "通过",
  rejected: "淘汰",
};

export const STAGE_LABELS = { term1: "第一学期", term2: "第二学期", unspecified: "未指定" };
export const SOURCE_LABELS = { project_page: "BAMOR项目页", uploaded_image: "本地上传" };

export function splitList(value = "") {
  return [...new Set(String(value).split(/[，,]/).map((item) => item.trim()).filter(Boolean))];
}

export function normalizeScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
}

export function matchesFilters(asset, filters) {
  const query = filters.search.trim().toLocaleLowerCase("zh-CN");
  const searchable = [asset.title, ...(asset.tags ?? [])].join(" ").toLocaleLowerCase("zh-CN");
  return (!query || searchable.includes(query))
    && (!filters.stage || asset.stage === filters.stage)
    && (!filters.source || asset.source_kind === filters.source)
    && (!filters.contentType || asset.content_type === filters.contentType)
    && (!filters.status || asset.review_status === filters.status)
    && (!filters.tag || (asset.tags ?? []).includes(filters.tag));
}

export function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const string = String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function assetsToCsv(assets) {
  const columns = [
    "id", "title", "file_name", "library_origin", "stage", "materials", "tags", "content_type",
    "source_kind", "source_document", "source_page", "review_status", "structure_consistency",
    "material_expression", "scene_fit", "visual_clarity", "rejection_reasons", "review_reason",
    "reviewer", "reviewed_at", "rubric_version", "created_at", "updated_at",
  ];
  const rows = assets.map((asset) => columns.map((column) => {
    if (SCORE_KEYS.includes(column)) return asset.review_scores?.[column] ?? "";
    const value = asset[column];
    return Array.isArray(value) ? value.join(" | ") : value ?? "";
  }));
  return [columns, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export function sortAssets(assets) {
  return [...assets].sort((a, b) => {
    const originOrder = (a.library_origin === "sample" ? 0 : 1) - (b.library_origin === "sample" ? 0 : 1);
    return originOrder || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id);
  });
}

export function validateBackup(payload) {
  if (!payload || payload.format !== "bamor-m1-backup" || payload.version !== 1 || !Array.isArray(payload.records)) {
    throw new Error("这不是受支持的BAMOR M1 JSON备份");
  }
  for (const record of payload.records) {
    if (!record?.asset?.id || typeof record.asset.title !== "string") throw new Error("备份中存在缺少ID或标题的记录");
    if (record.blob && (!record.blob.data_url || !record.blob.type)) throw new Error(`素材 ${record.asset.id} 的图片数据不完整`);
  }
  if (payload.ai_tasks !== undefined && !Array.isArray(payload.ai_tasks)) throw new Error("备份中的AI任务格式无效");
  for (const task of payload.ai_tasks ?? []) {
    if (!task?.id || !task.requirements || !task.model_call || !task.ai_suggestion) throw new Error("备份中存在不完整的AI任务记录");
  }
  return true;
}

export function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("备份中的图片编码无效");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}
