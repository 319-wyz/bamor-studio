import test from "node:test";
import assert from "node:assert/strict";
import { assetsToCsv, csvEscape, matchesFilters, normalizeScore, splitList, validateBackup } from "../src/utils.js";

test("中文标签去重并兼容中英文逗号", () => {
  assert.deepEqual(splitList("竹构, 原型，竹构, 网壳"), ["竹构", "原型", "网壳"]);
});

test("CSV正确处理逗号、引号和换行", () => {
  assert.equal(csvEscape('竹构,"网壳"\n版本'), '"竹构,""网壳""\n版本"');
  const csv = assetsToCsv([{
    id: "x1", title: "中文,标题", tags: ["A", "B"], review_reason: "第一行\n第二行", review_scores: {},
  }]);
  assert.match(csv, /"中文,标题"/);
  assert.match(csv, /"第一行\n第二行"/);
});

test("组合筛选匹配标题或标签", () => {
  const asset = { title: "竹构原型", tags: ["网壳"], stage: "term2", source_kind: "project_page", content_type: "prototype", review_status: "unreviewed" };
  assert.equal(matchesFilters(asset, { search: "网壳", stage: "term2", source: "project_page", contentType: "prototype", status: "unreviewed", tag: "网壳" }), true);
  assert.equal(matchesFilters(asset, { search: "", stage: "", source: "", contentType: "", status: "", tag: "封面" }), false);
  assert.equal(matchesFilters(asset, { search: "网壳", stage: "term1", source: "", contentType: "", status: "" }), false);
});

test("评分保持空值且仅接受1至5整数", () => {
  assert.equal(normalizeScore(""), null);
  assert.equal(normalizeScore("3"), 3);
  assert.equal(normalizeScore("0"), null);
  assert.equal(normalizeScore("2.5"), null);
});

test("只接受约定格式的JSON备份", () => {
  assert.equal(validateBackup({ format: "bamor-m1-backup", version: 1, records: [{ asset: { id: "a", title: "素材" }, blob: null }], ai_tasks: [] }), true);
  assert.throws(() => validateBackup({ records: [] }), /受支持/);
  assert.throws(() => validateBackup({ format: "bamor-m1-backup", version: 1, records: [], ai_tasks: {} }), /AI任务/);
});
