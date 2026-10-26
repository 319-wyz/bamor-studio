import {
  getAllAiTasks, getAllAssets, getAsset, getBlob, openDatabase, readCompleteLibrary,
  saveAiTask, saveAiTasks, saveAsset, saveAssets,
} from "./storage.js";
import { exportCsv, exportJson } from "./export.js";
import {
  REJECTION_REASONS, SCORE_KEYS, SOURCE_LABELS, STAGE_LABELS, STATUS_LABELS,
  dataUrlToBlob, matchesFilters, normalizeScore, sortAssets, splitList, validateBackup,
} from "./utils.js";

const elements = {
  library: document.querySelector("#library"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyCopy: document.querySelector("#empty-copy"),
  emptyClear: document.querySelector("#empty-clear"),
  resultCount: document.querySelector("#result-count"),
  importSamples: document.querySelector("#import-samples"),
  imageUpload: document.querySelector("#image-upload"),
  restoreJson: document.querySelector("#restore-json"),
  restoreSamples: document.querySelector("#restore-samples"),
  search: document.querySelector("#search-input"),
  stageFilter: document.querySelector("#stage-filter"),
  sourceFilter: document.querySelector("#source-filter"),
  typeFilter: document.querySelector("#type-filter"),
  statusFilter: document.querySelector("#status-filter"),
  tagFilter: document.querySelector("#tag-filter"),
  clearFilters: document.querySelector("#clear-filters"),
  compareStatus: document.querySelector("#compare-status"),
  openCompare: document.querySelector("#open-compare"),
  compareDialog: document.querySelector("#compare-dialog"),
  compareGrid: document.querySelector("#compare-grid"),
  editorDialog: document.querySelector("#editor-dialog"),
  editorForm: document.querySelector("#editor-form"),
  editorImage: document.querySelector("#editor-image"),
  editorId: document.querySelector("#editor-id"),
  editorTitle: document.querySelector("#editor-title"),
  editorStage: document.querySelector("#editor-stage"),
  editorMaterials: document.querySelector("#editor-materials"),
  editorTags: document.querySelector("#editor-tags"),
  editorStatus: document.querySelector("#editor-status"),
  editorReviewer: document.querySelector("#editor-reviewer"),
  editorReason: document.querySelector("#editor-reason"),
  editorOrigin: document.querySelector("#editor-origin"),
  rejectionFieldset: document.querySelector("#rejection-fieldset"),
  rejectionReasons: document.querySelector("#rejection-reasons"),
  exportCsv: document.querySelector("#export-csv"),
  exportJson: document.querySelector("#export-json"),
  toast: document.querySelector("#toast"),
  aiStatus: document.querySelector("#ai-status"),
  aiForm: document.querySelector("#ai-form"),
  aiPurpose: document.querySelector("#ai-purpose"),
  aiCount: document.querySelector("#ai-count"),
  aiEmphasis: document.querySelector("#ai-emphasis"),
  aiConstraints: document.querySelector("#ai-constraints"),
  aiCandidateSummary: document.querySelector("#ai-candidate-summary"),
  aiConnectionHelp: document.querySelector("#ai-connection-help"),
  runAiSelection: document.querySelector("#run-ai-selection"),
  aiOutput: document.querySelector("#ai-output"),
  aiHistory: document.querySelector("#ai-history"),
  aiTaskCount: document.querySelector("#ai-task-count"),
  retryAiStatus: document.querySelector("#retry-ai-status"),
  storageStatus: document.querySelector("#storage-status"),
  storageStatusText: document.querySelector("#storage-status-text"),
  retryStorage: document.querySelector("#retry-storage"),
};

const state = {
  database: null,
  databasePromise: null,
  assets: [],
  selected: new Set(),
  objectUrls: new Map(),
  toastTimer: null,
  aiStatus: null,
  aiTasks: [],
  aiBusy: false,
  aiStatusRequest: 0,
};

function setLibraryControls(ready) {
  elements.importSamples.disabled = !ready;
  elements.imageUpload.disabled = !ready;
  elements.restoreJson.disabled = !ready;
  elements.restoreSamples.disabled = !ready;
  elements.exportCsv.disabled = !ready;
  elements.exportJson.disabled = !ready;
}

function setStorageStatus(status, message, retry = false) {
  elements.storageStatus.dataset.state = status;
  elements.storageStatusText.textContent = message;
  elements.retryStorage.hidden = !retry;
}

function closeDatabaseConnection(message = "本地素材库连接已关闭，请重试") {
  state.database?.close();
  state.database = null;
  state.databasePromise = null;
  setLibraryControls(false);
  setStorageStatus("error", message, true);
}

async function ensureDatabase() {
  if (state.database) return state.database;
  if (state.databasePromise) return state.databasePromise;
  setLibraryControls(false);
  setStorageStatus("opening", "正在打开本地素材库…");
  const connectionPromise = openDatabase({
    onBlocked: () => setStorageStatus("blocked", "数据库升级正被另一个BAMOR页面阻止。正在结束本次连接…", false),
    onVersionChange: (database) => {
      if (state.database === database) closeDatabaseConnection("素材库版本已在其他页面更新，旧连接已安全释放。请重试连接以继续。");
    },
  });
  state.databasePromise = connectionPromise;
  try {
    state.database = await connectionPromise;
    setStorageStatus("ready", "本地素材库已连接，自动保存可用。");
    setLibraryControls(true);
    return state.database;
  } catch (error) {
    state.database = null;
    setLibraryControls(false);
    if (error.code === "DATABASE_OPEN_BLOCKED") {
      setStorageStatus("blocked", error.message, true);
    } else if (error.code === "DATABASE_OPEN_TIMEOUT") {
      setStorageStatus("timeout", error.message, true);
    } else {
      setStorageStatus("error", `本地素材库初始化失败：${error.message}`, true);
    }
    throw error;
  } finally {
    if (state.databasePromise === connectionPromise) state.databasePromise = null;
  }
}

async function requireDatabase() {
  try {
    return await ensureDatabase();
  } catch (error) {
    throw new Error(`本地素材库不可用。请使用“重试”重新连接。${error.message ? ` ${error.message}` : ""}`);
  }
}

function showToast(message, kind = "success") {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", kind === "error");
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4500);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.textContent = label;
  } else if (button.dataset.originalText) {
    button.innerHTML = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function displayValue(value, dictionary = null) {
  return dictionary?.[value] ?? value ?? "未指定";
}

function currentFilters() {
  return {
    search: elements.search.value,
    stage: elements.stageFilter.value,
    source: elements.sourceFilter.value,
    contentType: elements.typeFilter.value,
    status: elements.statusFilter.value,
    tag: elements.tagFilter.value,
  };
}

function filteredAssets() {
  return sortAssets(state.assets).filter((asset) => matchesFilters(asset, currentFilters()));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function aiRuntimeHelp(status) {
  const network = status?.network;
  if (!network) return status?.message || "";
  const proxy = network.env_proxy_enabled
    ? (network.https_proxy_configured ? "环境代理已启用且已配置" : "环境代理已启用，但未发现HTTPS_PROXY")
    : (network.https_proxy_configured ? "发现HTTPS_PROXY，但Node环境代理未启用" : "未启用环境代理");
  const bypass = network.api_bypassed_by_no_proxy ? "；当前API地址被NO_PROXY绕过" : "";
  return `${status.message} 请求端点：${network.api_endpoint}；${proxy}${bypass}。`;
}

function diagnosticSuffix(diagnostics) {
  if (!diagnostics) return "";
  const stages = {
    configuration: "读取配置",
    validation: "校验请求",
    serialize_request: "整理请求",
    api_fetch: "建立模型连接",
    api_http_response: "处理HTTP响应",
    read_response: "读取响应",
    validate_response: "校验模型结果",
    local_request: "读取本地请求",
  };
  const details = [];
  if (diagnostics.stage) details.push(`失败阶段：${stages[diagnostics.stage] || diagnostics.stage}`);
  if (Number.isFinite(diagnostics.duration_ms)) details.push(`耗时：${diagnostics.duration_ms}ms`);
  if (diagnostics.http_status) details.push(`HTTP ${diagnostics.http_status}`);
  if (diagnostics.request_id) details.push(`request ID：${diagnostics.request_id}`);
  const cause = diagnostics.error?.cause || diagnostics.error;
  if (cause?.code) details.push(`底层代码：${cause.code}`);
  if (cause?.message && cause.message !== "fetch failed") details.push(`底层原因：${cause.message}`);
  if (diagnostics.request?.request_body_bytes) details.push(`请求体：${formatBytes(diagnostics.request.request_body_bytes)}`);
  return details.length ? `（${details.join("；")}）` : "";
}

function updateAiControls() {
  const candidates = filteredAssets();
  const limit = state.aiStatus?.max_candidates ?? 12;
  const overLimit = candidates.length > limit;
  elements.aiCandidateSummary.textContent = overLimit
    ? `当前筛选范围：${candidates.length}份，超过一次最多${limit}份，请先筛选`
    : `当前筛选范围：${candidates.length}份候选素材（模型会读取实际图片）`;
  const connected = Boolean(state.aiStatus?.configured);
  elements.runAiSelection.disabled = state.aiBusy || !connected || candidates.length === 0 || overLimit;
  for (const input of elements.aiForm.querySelectorAll("input, select, textarea")) input.disabled = state.aiBusy;
}

function refreshFilterOptions() {
  const configs = [
    [elements.stageFilter, "全部阶段", "stage", STAGE_LABELS],
    [elements.sourceFilter, "全部来源", "source_kind", SOURCE_LABELS],
    [elements.typeFilter, "全部类型", "content_type", null],
  ];
  for (const [select, firstLabel, key, labels] of configs) {
    const selected = select.value;
    const values = [...new Set(state.assets.map((asset) => asset[key]).filter(Boolean))].sort();
    select.replaceChildren(new Option(firstLabel, ""), ...values.map((value) => new Option(displayValue(value, labels), value)));
    if (values.includes(selected)) select.value = selected;
  }
  const selectedTag = elements.tagFilter.value;
  const tags = [...new Set(state.assets.flatMap((asset) => asset.tags ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  elements.tagFilter.replaceChildren(new Option("全部用途标签", ""), ...tags.map((tag) => new Option(tag, tag)));
  if (tags.includes(selectedTag)) elements.tagFilter.value = selectedTag;
}

async function imageUrlFor(id) {
  if (state.objectUrls.has(id)) return state.objectUrls.get(id);
  const blob = await getBlob(await requireDatabase(), id);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  state.objectUrls.set(id, url);
  return url;
}

function releaseObjectUrls() {
  for (const url of state.objectUrls.values()) URL.revokeObjectURL(url);
  state.objectUrls.clear();
}

function cardMarkup(asset) {
  const selected = state.selected.has(asset.id);
  const selectionOrder = selected ? [...state.selected].indexOf(asset.id) + 1 : 0;
  const tags = (asset.tags ?? []).map((tag) => `<li class="tag">${escapeHtml(tag)}</li>`).join("");
  return `
    <article class="asset-card${selected ? " is-selected" : ""}" data-asset-id="${escapeHtml(asset.id)}">
      <div class="asset-image-wrap">
        <img class="asset-image" data-image-id="${escapeHtml(asset.id)}" alt="${escapeHtml(asset.title)}" />
        <span class="origin-badge">${asset.library_origin === "sample" ? "BAMOR整页样例" : "本地上传"}</span>
        ${selected ? `<span class="compare-order" aria-hidden="true">比较 ${selectionOrder}/4</span>` : ""}
      </div>
      <div class="asset-body">
        <h3 class="asset-title">${escapeHtml(asset.title)}</h3>
        <div class="asset-meta">
          <span>${escapeHtml(displayValue(asset.stage, STAGE_LABELS))}</span>
          <span>${escapeHtml(displayValue(asset.content_type))}</span>
        </div>
        ${tags ? `<ul class="tag-list">${tags}</ul>` : ""}
        <div class="asset-footer">
          <span class="status status-${escapeHtml(asset.review_status)}">${escapeHtml(displayValue(asset.review_status, STATUS_LABELS))}</span>
          <label class="compare-toggle"><input type="checkbox" data-compare-id="${escapeHtml(asset.id)}" aria-label="${selected ? `取消第${selectionOrder}份比较素材` : "加入比较"}" ${selected ? "checked" : ""}/> ${selected ? `第${selectionOrder}份` : "加入比较"}</label>
          <button type="button" data-edit-id="${escapeHtml(asset.id)}">标注</button>
        </div>
      </div>
    </article>`;
}

async function render() {
  const filtered = filteredAssets();
  elements.library.classList.add("is-updating");
  elements.resultCount.textContent = `${filtered.length} / ${state.assets.length}份素材`;
  elements.library.innerHTML = filtered.map(cardMarkup).join("");
  elements.emptyState.hidden = filtered.length > 0;
  if (state.assets.length === 0) {
    elements.emptyTitle.textContent = "还没有素材";
    elements.emptyCopy.textContent = "先导入8份BAMOR样例，或上传一张真实图片。";
    elements.emptyClear.hidden = true;
  } else if (filtered.length === 0) {
    elements.emptyTitle.textContent = "没有符合条件的素材";
    elements.emptyCopy.textContent = "当前搜索词与筛选组合没有结果。";
    elements.emptyClear.hidden = false;
  }
  await Promise.all([...elements.library.querySelectorAll("[data-image-id]")].map(async (image) => {
    const url = await imageUrlFor(image.dataset.imageId);
    if (url) image.src = url;
    else {
      image.alt = `${image.alt}（图片不可用）`;
      image.closest(".asset-image-wrap").classList.add("image-missing");
    }
  }));
  updateCompareControls();
  updateAiControls();
  requestAnimationFrame(() => elements.library.classList.remove("is-updating"));
}

async function reloadLibrary() {
  state.assets = await getAllAssets(await requireDatabase());
  const existingIds = new Set(state.assets.map((asset) => asset.id));
  for (const id of state.selected) if (!existingIds.has(id)) state.selected.delete(id);
  refreshFilterOptions();
  await render();
}

function setAiStatusView(status, label, help, retry = false) {
  elements.aiStatus.dataset.state = status;
  elements.aiStatus.querySelector("span:last-child").textContent = label;
  elements.aiConnectionHelp.textContent = help;
  elements.retryAiStatus.hidden = !retry;
}

async function loadAiStatus() {
  const requestId = ++state.aiStatusRequest;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  setAiStatusView("checking", "正在检查模型配置…", "模型状态检查与本地素材库分别运行。", false);
  try {
    const response = await fetch("/api/ai-status", { cache: "no-store", signal: controller.signal });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      if (requestId !== state.aiStatusRequest) return;
      state.aiStatus = { configured: false, max_candidates: 12, configuration_state: "static_demo" };
      setAiStatusView(
        "unconfigured",
        "在线展示版暂不可调用AI",
        "公开静态版不保存模型密钥；素材导入、筛选、比较、人工审核与导出仍可使用。本地服务端配置后可启用真实AI选图。",
      );
      updateAiControls();
      return;
    }
    if (!response.ok) throw new Error(`连接状态接口返回HTTP ${response.status}`);
    const status = await response.json();
    if (requestId !== state.aiStatusRequest) return;
    state.aiStatus = status;
    if (status.configuration_state === "configured_unverified") {
      setAiStatusView("unverified", `已配置，尚未验证 · ${status.model}`, aiRuntimeHelp(status));
    } else {
      setAiStatusView("unconfigured", "未配置模型密钥", aiRuntimeHelp(status));
    }
  } catch (error) {
    if (requestId !== state.aiStatusRequest) return;
    state.aiStatus = { configured: false, max_candidates: 12, configuration_state: "status_failed" };
    const detail = error.name === "AbortError" ? "检查超过5秒，已停止等待。" : `无法读取模型配置：${error.message}`;
    setAiStatusView("failed", "模型检查失败", `${detail} 本地素材功能不受影响。`, true);
  } finally {
    clearTimeout(timeout);
  }
  updateAiControls();
}

function renderAiHistory() {
  const tasks = [...state.aiTasks].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  elements.aiTaskCount.textContent = String(tasks.length);
  elements.aiHistory.innerHTML = tasks.length ? tasks.map((task) => `
    <article class="ai-history-item">
      <div>
        <h4>${escapeHtml(task.requirements?.purpose || "未命名选图任务")}</h4>
        <p>${escapeHtml(task.model_call?.model || "未知模型")} · ${escapeHtml(new Date(task.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }))} · 人工确认：${task.human_confirmation?.status === "confirmed" ? "已保存" : "待确认"}</p>
      </div>
      <button class="button button-quiet" type="button" data-view-ai-task="${escapeHtml(task.id)}">查看</button>
    </article>`).join("") : "<p>暂无已完成任务。</p>";
}

async function reloadAiTasks() {
  state.aiTasks = await getAllAiTasks(await requireDatabase());
  renderAiHistory();
}

async function renderAiTask(task) {
  if (!task?.ai_suggestion) return;
  const recommendations = [...task.ai_suggestion.recommendations].sort((a, b) => a.rank - b.rank);
  const confirmedIds = new Set(task.human_confirmation?.confirmed_asset_ids ?? []);
  const recommendationMarkup = recommendations.map((item) => {
    const asset = state.assets.find((candidate) => candidate.id === item.asset_id);
    const displayTitle = asset?.title || item.asset_id;
    return `
      <article class="ai-recommendation">
        <figure><img data-ai-image="${escapeHtml(item.asset_id)}" alt="${escapeHtml(displayTitle)}" /></figure>
        <div class="ai-recommendation-copy">
          <span class="ai-rank">推荐 ${escapeHtml(item.rank)}</span>
          <h4>${escapeHtml(displayTitle)}</h4>
          <p class="ai-role">${escapeHtml(item.role)}</p>
          <dl>
            <dt>可见依据</dt><dd>${escapeHtml(item.visual_evidence)}</dd>
            <dt>需求关系</dt><dd>${escapeHtml(item.relation_to_request)}</dd>
            <dt>建议标题</dt><dd>${escapeHtml(item.suggested_title || "不建议改标题")}</dd>
            <dt>不确定项</dt><dd>${escapeHtml(item.uncertainty || "无")}</dd>
          </dl>
        </div>
      </article>`;
  }).join("");
  const notRecommended = task.ai_suggestion.not_recommended.map((item) => {
    const asset = state.assets.find((candidate) => candidate.id === item.asset_id);
    return `<li><strong>${escapeHtml(asset?.title || item.asset_id)}</strong>：${escapeHtml(item.reason)}</li>`;
  }).join("") || "<li>没有其他候选。</li>";
  const unknowns = task.ai_suggestion.unknowns.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>模型未列出额外不确定项。</li>";
  const confirmationOptions = recommendations.map((item) => {
    const asset = state.assets.find((candidate) => candidate.id === item.asset_id);
    return `<label><input type="checkbox" name="confirmed_asset_ids" value="${escapeHtml(item.asset_id)}" ${confirmedIds.has(item.asset_id) ? "checked" : ""}/> ${escapeHtml(asset?.title || item.asset_id)}</label>`;
  }).join("");
  elements.aiOutput.innerHTML = `
    <div class="ai-result-header">
      <div>
        <p class="section-kicker">AI建议 · 任务独立记录</p>
        <h3>${escapeHtml(task.requirements.purpose)}</h3>
        <p>${escapeHtml(task.ai_suggestion.task_summary)}</p>
      </div>
      <p class="ai-model-meta">${escapeHtml(task.model_call.provider)} / ${escapeHtml(task.model_call.model)}<br>${escapeHtml(new Date(task.completed_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }))}<br>${escapeHtml(task.model_call.actual_image_count)}张实际图片</p>
    </div>
    <div class="ai-recommendations">${recommendationMarkup || '<div class="ai-error"><h3>没有推荐项</h3><p>模型认为现有图片不足以支持本次任务，请查看不确定项。</p></div>'}</div>
    <div class="ai-supporting">
      <section><h4>本次未推荐</h4><ul>${notRecommended}</ul></section>
      <section><h4>信息不足 / 无法确认</h4><ul>${unknowns}</ul></section>
    </div>
    <form class="human-confirmation" data-confirm-ai-task="${escapeHtml(task.id)}">
      <h4>人工确认</h4>
      ${task.human_confirmation?.status === "confirmed" ? '<p class="confirmation-saved">已保存人工确认，可继续修改</p>' : ""}
      <p>勾选你最终采用的素材。AI建议和人工确认分开保存，不改写素材原有评分、理由或审核状态。</p>
      <div class="confirmation-options">${confirmationOptions || "<span>当前没有可确认的推荐项。</span>"}</div>
      <div class="confirmation-actions">
        <label class="field"><span>人工确认说明（可选）</span><input name="confirmation_note" maxlength="500" value="${escapeHtml(task.human_confirmation?.note || "")}" placeholder="记录采用、调整或不采用AI建议的原因" /></label>
        <button class="button button-primary" type="submit">保存人工确认</button>
      </div>
      <p class="ai-separation-note">此操作只更新该选图任务的人工确认字段，不会将未选素材标记为淘汰。</p>
    </form>`;
  await Promise.all([...elements.aiOutput.querySelectorAll("[data-ai-image]")].map(async (image) => {
    image.src = await imageUrlFor(image.dataset.aiImage);
  }));
  elements.aiOutput.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runAiSelection(event) {
  event.preventDefault();
  if (!state.aiStatus?.configured) return showToast("模型密钥尚未配置；基础素材功能仍可使用", "error");
  const candidates = filteredAssets();
  const requestedCount = Number(elements.aiCount.value);
  if (requestedCount > candidates.length) return showToast("需要张数不能超过当前候选数量", "error");
  const limit = state.aiStatus.max_candidates ?? 12;
  if (candidates.length > limit) return showToast(`请先把候选筛选到${limit}份以内`, "error");

  state.aiBusy = true;
  updateAiControls();
  elements.aiOutput.innerHTML = '<div class="ai-loading">正在读取并比较实际图片，请保持页面开启…</div>';
  try {
    const database = await requireDatabase();
    const candidatePayload = await Promise.all(candidates.map(async (asset) => {
      const blob = await getBlob(database, asset.id);
      if (!blob) throw new Error(`${asset.title} 缺少可发送的图片数据`);
      return {
        id: asset.id,
        image_data_url: await blobToDataUrl(blob),
        metadata: {
          title: asset.title,
          stage: asset.stage,
          materials: asset.materials ?? [],
          content_type: asset.content_type,
          source_kind: asset.source_kind,
          source_document: asset.source_document,
          source_page: asset.source_page,
        },
      };
    }));
    const requestBody = JSON.stringify({
      task_id: `ai-task-${crypto.randomUUID()}`,
      purpose: elements.aiPurpose.value,
      requested_count: requestedCount,
      emphasis: elements.aiEmphasis.value,
      constraints: elements.aiConstraints.value,
      candidates: candidatePayload,
    });
    const requestBytes = new Blob([requestBody]).size;
    elements.aiOutput.innerHTML = `<div class="ai-loading">已读取${candidatePayload.length}张实际图片，正在发送并比较（请求体 ${escapeHtml(formatBytes(requestBytes))}）…</div>`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 130000);
    const response = await fetch("/api/ai-select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: requestBody,
    }).finally(() => clearTimeout(timeout));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `模型请求失败（HTTP ${response.status}）`);
      error.code = payload?.error?.code || "MODEL_REQUEST_FAILED";
      error.httpStatus = response.status;
      error.diagnostics = payload?.error?.diagnostics;
      throw error;
    }
    const task = {
      ...payload.task,
      human_confirmation: { status: "pending", confirmed_asset_ids: [], note: "", confirmed_at: null },
    };
    await saveAiTask(database, task);
    await reloadAiTasks();
    await renderAiTask(task);
    state.aiStatus = { ...state.aiStatus, configured: true, configuration_state: "verified" };
    setAiStatusView("verified", `真实调用成功 · ${task.model_call.model}`, `已完成真实视觉模型调用，响应ID：${task.model_call.response_id || "服务未返回"}`);
    showToast(`AI已读取${task.model_call.actual_image_count}张实际图片并保存建议`);
  } catch (error) {
    const baseMessage = error.name === "AbortError"
      ? "模型调用超过130秒，已停止等待。请检查网络后重试。"
      : error.message;
    const message = `${baseMessage}${diagnosticSuffix(error.diagnostics)}`;
    if (error.code === "MODEL_NOT_CONFIGURED") {
      state.aiStatus = { ...state.aiStatus, configured: false, configuration_state: "unconfigured" };
      setAiStatusView("unconfigured", "未配置模型密钥", message, true);
    } else if (error.httpStatus === 401 || error.code === "AUTHENTICATION_FAILED" || error.code === "invalid_api_key") {
      setAiStatusView("failed", "模型认证失败", `${message} 请检查服务端密钥后重试。`, true);
    } else {
      setAiStatusView("failed", "模型调用失败", message, true);
    }
    elements.aiOutput.innerHTML = `<div class="ai-error"><h3>本次AI选图未完成</h3><p>${escapeHtml(message)}</p><button class="button button-secondary" type="button" data-retry-ai-request>重试本次请求</button></div>`;
    showToast(`AI选图失败：${message}`, "error");
  } finally {
    state.aiBusy = false;
    updateAiControls();
  }
}

async function saveHumanConfirmation(form) {
  const task = state.aiTasks.find((item) => item.id === form.dataset.confirmAiTask);
  if (!task) return showToast("找不到该AI任务记录", "error");
  task.human_confirmation = {
    status: "confirmed",
    confirmed_asset_ids: [...form.querySelectorAll('[name="confirmed_asset_ids"]:checked')].map((input) => input.value),
    note: form.elements.confirmation_note.value.trim(),
    confirmed_at: new Date().toISOString(),
  };
  await saveAiTask(await requireDatabase(), task);
  await reloadAiTasks();
  await renderAiTask(task);
  showToast("人工确认已单独保存，素材审核记录未改变");
}

function updateCompareControls() {
  const count = state.selected.size;
  const messages = [
    "选择2—4份素材进行并排比较",
    "已选第1份，还差1份即可比较；最多还可选3份",
    "已选2份，可以比较；还可选2份",
    "已选3份，可以比较；还可选1份",
    "已选4份，已达上限",
  ];
  elements.compareStatus.textContent = messages[count] ?? messages[0];
  elements.openCompare.disabled = count < 2 || count > 4;
}

async function importSamples() {
  let database;
  try { database = await requireDatabase(); }
  catch (error) { return showToast(error.message, "error"); }
  setBusy(elements.importSamples, true, "正在导入…");
  try {
    const samples = await loadSampleManifest();
    if (!Array.isArray(samples) || samples.length !== 8) throw new Error("样例清单不是预期的8条记录");
    const existing = new Set(state.assets.map((asset) => asset.id));
    const pending = samples.filter((asset) => !existing.has(asset.id));
    const records = await loadSampleRecords(pending);
    if (records.length) await saveAssets(database, records);
    await reloadLibrary();
    showToast(records.length ? `已导入${records.length}份样例；现有样例不会重复` : "8份样例已在素材库中，没有创建副本");
  } catch (error) {
    showToast(error.message || "样例导入失败", "error");
  } finally {
    setBusy(elements.importSamples, false);
  }
}

async function loadSampleManifest() {
  const response = await fetch("data/assets.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`样例清单读取失败（HTTP ${response.status}）`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("样例清单地址返回了网页而不是JSON；公开部署缺少 data/assets.json，请更新静态文件后重试");
  }
  try { return await response.json(); }
  catch { throw new Error("样例清单JSON格式无法解析，请检查部署文件是否完整"); }
}

async function loadSampleRecords(samples) {
  const records = [];
  for (const source of samples) {
    const imageResponse = await fetch(source.file, { cache: "no-store" });
    const contentType = imageResponse.headers.get("content-type") || "";
    if (!imageResponse.ok || !contentType.startsWith("image/")) {
      throw new Error(`精选案例图片无法读取：${source.title || source.id}（HTTP ${imageResponse.status}，${contentType || "未知格式"}）`);
    }
    const blob = await imageResponse.blob();
    records.push({
      asset: {
        ...source,
        library_origin: "sample",
        file_name: source.file.split("/").pop(),
        rejection_reasons: [],
        rubric_version: "v0.1",
        created_at: source.prepared_on ? `${source.prepared_on}T00:00:00+08:00` : new Date().toISOString(),
        updated_at: null,
      },
      blob,
    });
  }
  return records;
}

async function restoreOriginalSamples() {
  if (!window.confirm("恢复8份原始精选案例会覆盖同ID样例的本地标注，但不会删除你上传的图片或其他AI任务。继续吗？")) return;
  let database;
  try { database = await requireDatabase(); }
  catch (error) { return showToast(error.message, "error"); }
  setBusy(elements.restoreSamples, true, "正在恢复…");
  try {
    const samples = await loadSampleManifest();
    if (!Array.isArray(samples) || samples.length !== 8) throw new Error("样例清单不是预期的8条记录");
    await saveAssets(database, await loadSampleRecords(samples));
    releaseObjectUrls();
    await reloadLibrary();
    showToast("已恢复8份原始精选案例；个人上传和其他记录未被清除");
  } catch (error) {
    showToast(`恢复精选案例失败：${error.message}`, "error");
  } finally {
    setBusy(elements.restoreSamples, false);
  }
}

function validateImageFile(file) {
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedTypes.has(file.type)) throw new Error(`${file.name}：不支持该格式，仅接受PNG、JPEG或WebP`);
  if (file.size === 0) throw new Error(`${file.name}：文件为空`);
  if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name}：超过30MB上限`);
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name}：浏览器无法读取这张图片`)); };
    image.src = url;
  });
}

async function uploadImages(files) {
  const database = await requireDatabase();
  const records = [];
  const errors = [];
  for (const file of files) {
    try {
      validateImageFile(file);
      const dimensions = await decodeImage(file);
      const id = `upload-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      records.push({
        asset: {
          id,
          title: file.name.replace(/\.[^.]+$/, ""),
          file_name: file.name,
          library_origin: "upload",
          stage: "unspecified",
          materials: [],
          tags: [],
          content_type: "uploaded_image",
          source_kind: "uploaded_image",
          source_document: file.name,
          source_page: null,
          attribution: "用户本地上传；权属与使用权限由用户确认",
          width: dimensions.width,
          height: dimensions.height,
          review_status: "unreviewed",
          review_scores: Object.fromEntries(SCORE_KEYS.map((key) => [key, null])),
          rejection_reasons: [],
          reviewer: null,
          reviewed_at: null,
          review_reason: "",
          rubric_version: "v0.1",
          created_at: now,
          updated_at: null,
        },
        blob: file,
      });
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (records.length) {
    await saveAssets(database, records);
    await reloadLibrary();
  }
  if (errors.length) showToast(errors.join("；"), "error");
  else if (records.length) showToast(`已保存${records.length}张图片到当前浏览器`);
}

async function openEditor(id) {
  const asset = await getAsset(await requireDatabase(), id);
  if (!asset) return showToast("找不到这份素材记录", "error");
  elements.editorId.value = asset.id;
  elements.editorTitle.value = asset.title ?? "";
  elements.editorStage.value = asset.stage ?? "";
  elements.editorMaterials.value = (asset.materials ?? []).join(", ");
  elements.editorTags.value = (asset.tags ?? []).join(", ");
  elements.editorStatus.value = asset.review_status ?? "unreviewed";
  elements.editorReviewer.value = asset.reviewer ?? "";
  elements.editorReason.value = asset.review_reason ?? "";
  for (const select of elements.editorForm.querySelectorAll("[data-score]")) {
    select.value = asset.review_scores?.[select.dataset.score] ?? "";
  }
  for (const checkbox of elements.rejectionReasons.querySelectorAll("input")) {
    checkbox.checked = (asset.rejection_reasons ?? []).includes(checkbox.value);
  }
  elements.rejectionFieldset.hidden = asset.review_status !== "rejected";
  elements.editorOrigin.textContent = asset.library_origin === "sample"
    ? "正在标注样例的页面表达；原始 data/assets.json 不会被改写。"
    : `本地上传：${asset.file_name}`;
  elements.editorImage.src = await imageUrlFor(id);
  elements.editorImage.alt = asset.title;
  elements.editorDialog.showModal();
}

async function saveEditor(event) {
  event.preventDefault();
  const database = await requireDatabase();
  const asset = await getAsset(database, elements.editorId.value);
  if (!asset) return showToast("保存失败：素材记录不存在", "error");
  const status = elements.editorStatus.value;
  const previousStatus = asset.review_status;
  asset.title = elements.editorTitle.value.trim();
  asset.stage = elements.editorStage.value.trim() || "unspecified";
  asset.materials = splitList(elements.editorMaterials.value);
  asset.tags = splitList(elements.editorTags.value);
  asset.review_status = status;
  asset.reviewer = elements.editorReviewer.value.trim() || null;
  asset.review_reason = elements.editorReason.value.trim();
  asset.review_scores = Object.fromEntries([...elements.editorForm.querySelectorAll("[data-score]")]
    .map((select) => [select.dataset.score, normalizeScore(select.value)]));
  asset.rejection_reasons = status === "rejected"
    ? [...elements.rejectionReasons.querySelectorAll("input:checked")].map((input) => input.value)
    : [];
  asset.reviewed_at = status === "unreviewed" ? null : (previousStatus === status && asset.reviewed_at ? asset.reviewed_at : new Date().toISOString());
  asset.rubric_version = "v0.1";
  asset.updated_at = new Date().toISOString();
  try {
    await saveAsset(database, asset);
    elements.editorDialog.close();
    await reloadLibrary();
    showToast("素材记录已保存");
  } catch (error) {
    showToast(`保存失败：${error.message}`, "error");
  }
}

async function openComparison() {
  const assets = [...state.selected].map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean);
  if (assets.length < 2 || assets.length > 4) return;
  elements.compareGrid.style.setProperty("--compare-count", assets.length);
  elements.compareGrid.innerHTML = assets.map((asset) => `
    <article class="compare-item">
      <img data-compare-image="${escapeHtml(asset.id)}" alt="${escapeHtml(asset.title)}" />
      <div class="compare-copy">
        <h3>${escapeHtml(asset.title)}</h3>
        <span class="status status-${escapeHtml(asset.review_status)}">${escapeHtml(displayValue(asset.review_status, STATUS_LABELS))}</span>
        <dl>
          <dt>阶段</dt><dd>${escapeHtml(displayValue(asset.stage, STAGE_LABELS))}</dd>
          <dt>材料</dt><dd>${escapeHtml((asset.materials ?? []).join("、") || "未标注")}</dd>
          <dt>标签</dt><dd>${escapeHtml((asset.tags ?? []).join("、") || "未标注")}</dd>
          <dt>构型 / 材料</dt><dd>${asset.review_scores?.structure_consistency ?? "—"} / ${asset.review_scores?.material_expression ?? "—"}</dd>
          <dt>场景 / 清晰</dt><dd>${asset.review_scores?.scene_fit ?? "—"} / ${asset.review_scores?.visual_clarity ?? "—"}</dd>
          <dt>取舍理由</dt><dd>${escapeHtml(asset.review_reason || "尚未填写")}</dd>
        </dl>
      </div>
      <button class="remove-compare" type="button" data-remove-compare="${escapeHtml(asset.id)}">从比较中移除</button>
    </article>`).join("");
  await Promise.all([...elements.compareGrid.querySelectorAll("[data-compare-image]")].map(async (image) => {
    image.src = await imageUrlFor(image.dataset.compareImage);
  }));
  elements.compareDialog.showModal();
}

async function restoreBackup(file) {
  const database = await requireDatabase();
  const raw = await file.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("JSON文件无法解析"); }
  validateBackup(payload);
  const records = payload.records.map((record) => ({
    asset: record.asset,
    blob: record.blob ? dataUrlToBlob(record.blob.data_url) : undefined,
  }));
  if (!window.confirm(`将导入或覆盖${records.length}份同ID素材记录及${(payload.ai_tasks ?? []).length}个AI任务。继续吗？`)) return false;
  await saveAssets(database, records);
  await saveAiTasks(database, payload.ai_tasks ?? []);
  releaseObjectUrls();
  await reloadLibrary();
  await reloadAiTasks();
  return true;
}

function clearFilters() {
  elements.search.value = "";
  elements.stageFilter.value = "";
  elements.sourceFilter.value = "";
  elements.typeFilter.value = "";
  elements.statusFilter.value = "";
  elements.tagFilter.value = "";
  render();
}

function buildEditorOptions() {
  for (const select of document.querySelectorAll("[data-score]")) {
    select.append(new Option("未评分", ""));
    for (let score = 1; score <= 5; score += 1) select.append(new Option(`${score}分`, String(score)));
  }
  for (const reason of REJECTION_REASONS) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = reason;
    label.append(input, document.createTextNode(reason));
    elements.rejectionReasons.append(label);
  }
}

function bindEvents() {
  elements.importSamples.addEventListener("click", importSamples);
  elements.imageUpload.addEventListener("change", async (event) => {
    try { await uploadImages([...event.target.files]); }
    catch (error) { showToast(`上传失败：${error.message}`, "error"); }
    finally { event.target.value = ""; }
  });
  elements.restoreJson.addEventListener("change", async (event) => {
    try {
      if (event.target.files[0] && await restoreBackup(event.target.files[0])) showToast("JSON备份已恢复");
    } catch (error) { showToast(`恢复失败：${error.message}`, "error"); }
    finally { event.target.value = ""; }
  });
  elements.restoreSamples.addEventListener("click", restoreOriginalSamples);
  for (const input of [elements.search, elements.stageFilter, elements.sourceFilter, elements.typeFilter, elements.statusFilter, elements.tagFilter]) {
    input.addEventListener("input", render);
  }
  elements.clearFilters.addEventListener("click", clearFilters);
  elements.emptyClear.addEventListener("click", clearFilters);
  elements.library.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-id]");
    if (editButton) openEditor(editButton.dataset.editId).catch((error) => showToast(`无法打开素材：${error.message}`, "error"));
  });
  elements.library.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-compare-id]");
    if (!checkbox) return;
    if (checkbox.checked && state.selected.size >= 4) {
      checkbox.checked = false;
      showToast("比较板最多选择4份素材", "error");
      return;
    }
    if (checkbox.checked) state.selected.add(checkbox.dataset.compareId);
    else state.selected.delete(checkbox.dataset.compareId);
    render();
  });
  elements.editorStatus.addEventListener("change", () => {
    elements.rejectionFieldset.hidden = elements.editorStatus.value !== "rejected";
  });
  elements.editorForm.addEventListener("submit", (event) => saveEditor(event).catch((error) => showToast(`保存失败：${error.message}`, "error")));
  elements.openCompare.addEventListener("click", openComparison);
  elements.compareGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-compare]");
    if (!button) return;
    state.selected.delete(button.dataset.removeCompare);
    elements.compareDialog.close();
    render();
  });
  elements.exportCsv.addEventListener("click", () => {
    if (!state.assets.length) return showToast("素材库为空，没有可导出的记录", "error");
    exportCsv(sortAssets(state.assets));
    showToast(`已导出${state.assets.length}条记录；CSV不包含图片`);
  });
  elements.exportJson.addEventListener("click", async () => {
    if (!state.assets.length) return showToast("素材库为空，没有可备份的内容", "error");
    setBusy(elements.exportJson, true, "正在整理图片…");
    try {
      await exportJson(await readCompleteLibrary(await requireDatabase()), state.aiTasks);
      showToast(`已备份${state.assets.length}份素材、可用图片及${state.aiTasks.length}个AI任务`);
    } catch (error) { showToast(`备份失败：${error.message}`, "error"); }
    finally { setBusy(elements.exportJson, false); }
  });
  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`).close());
  }
  elements.aiForm.addEventListener("submit", runAiSelection);
  elements.retryAiStatus.addEventListener("click", loadAiStatus);
  elements.retryStorage.addEventListener("click", initializeLibrary);
  for (const button of document.querySelectorAll("[data-ai-preset]")) {
    button.addEventListener("click", () => {
      if (button.dataset.aiPreset === "cover") {
        elements.aiPurpose.value = "选择作品封面";
        elements.aiCount.value = "1";
        elements.aiEmphasis.value = "第一眼能看出项目特色，构图完整，并有清楚的视觉焦点";
        elements.aiConstraints.value = "主体清楚；适合封面裁切；不能依据无法核实的性能或作者贡献作判断";
      } else {
        elements.aiPurpose.value = "解释网格壳体构型";
        elements.aiCount.value = "2";
        elements.aiEmphasis.value = "清楚展示四支腿主体、竹构连接与网格表皮之间的关系";
        elements.aiConstraints.value = "必须能从画面看到构型依据；不把T2网格表皮误写成最终弹性网布；无法确认的结构信息保留未知";
      }
      elements.aiForm.classList.remove("is-purpose-filled");
      requestAnimationFrame(() => elements.aiForm.classList.add("is-purpose-filled"));
      elements.aiPurpose.focus();
    });
  }
  elements.aiHistory.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-ai-task]");
    if (!button) return;
    const task = state.aiTasks.find((item) => item.id === button.dataset.viewAiTask);
    if (task) renderAiTask(task);
  });
  elements.aiOutput.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-confirm-ai-task]");
    if (!form) return;
    event.preventDefault();
    saveHumanConfirmation(form).catch((error) => showToast(`人工确认保存失败：${error.message}`, "error"));
  });
  elements.aiOutput.addEventListener("click", (event) => {
    if (event.target.closest("[data-retry-ai-request]")) elements.aiForm.requestSubmit();
  });
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  }
  window.addEventListener("beforeunload", releaseObjectUrls);
}

async function initializeLibrary() {
  try {
    await ensureDatabase();
    await Promise.all([reloadLibrary(), reloadAiTasks()]);
  } catch (error) {
    if (state.database) closeDatabaseConnection(`本地素材库读取失败：${error.message}`);
    showToast(`本地保存不可用：${error.message}`, "error");
  }
}

function initialize() {
  buildEditorOptions();
  bindEvents();
  loadAiStatus();
  initializeLibrary();
}

initialize();
