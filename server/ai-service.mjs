const DEFAULT_MODEL = "gpt-6.1-sol";
const MAX_CANDIDATES = 12;
const MAX_IMAGE_DATA_URL_LENGTH = 12 * 1024 * 1024;
const MODEL_TIMEOUT_MS = 120000;

function truncate(value, maxLength = 700) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function redactSensitiveText(value) {
  return truncate(value)
    .replace(/(authorization["':=\s]+bearer\s+)[^\s,"'}]+/gi, "$1[已脱敏]")
    .replace(/(bearer\s+)[^\s,"'}]+/gi, "$1[已脱敏]")
    .replace(/\b(sk|sess|key)-[A-Za-z0-9_-]{8,}\b/g, "$1-[已脱敏]")
    .replace(/(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi, "$1[凭据已脱敏]@")
    .replace(/data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/gi, "[图片Base64已脱敏]");
}

function safeErrorCode(value) {
  return typeof value === "string" || typeof value === "number" ? truncate(value, 120) : null;
}

export function describeError(error, depth = 0, seen = new Set()) {
  if (!error || depth > 4 || seen.has(error)) return null;
  if (typeof error !== "object") return { message: redactSensitiveText(error) };
  seen.add(error);
  const detail = {
    name: redactSensitiveText(error.name || error.constructor?.name || "Error"),
    message: redactSensitiveText(error.message || String(error)),
  };
  const code = safeErrorCode(error.code);
  if (code !== null) detail.code = code;
  if (error.cause) detail.cause = describeError(error.cause, depth + 1, seen);
  const nested = error instanceof AggregateError ? error.errors : error.errors;
  if (nested && Symbol.iterator in Object(nested)) {
    detail.errors = [...nested].slice(0, 8).map((item) => describeError(item, depth + 1, seen)).filter(Boolean);
  }
  return detail;
}

export function safeApiEndpoint(apiBaseUrl, path = "") {
  try {
    const url = new URL(`${String(apiBaseUrl).replace(/\/$/, "")}${path}`);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "无效的OPENAI_BASE_URL";
  }
}

function isProxyUrlValid(value) {
  if (!value) return null;
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function noProxyMatches(noProxy, targetUrl) {
  if (!noProxy) return false;
  let hostname;
  let port;
  try {
    const url = new URL(targetUrl);
    hostname = url.hostname.toLowerCase();
    port = url.port || (url.protocol === "https:" ? "443" : "80");
  } catch { return false; }
  return String(noProxy).split(",").some((entry) => {
    let rule = entry.trim().toLowerCase();
    if (!rule) return false;
    if (rule === "*") return true;
    if (rule.includes(":")) {
      const lastColon = rule.lastIndexOf(":");
      const rulePort = rule.slice(lastColon + 1);
      if (/^\d+$/.test(rulePort)) {
        if (rulePort !== port) return false;
        rule = rule.slice(0, lastColon);
      }
    }
    rule = rule.replace(/^\*\./, ".");
    if (rule.startsWith(".")) return hostname.endsWith(rule) || hostname === rule.slice(1);
    return hostname === rule;
  });
}

export function getNetworkRuntime(environment = process.env, execArgv = process.execArgv) {
  const config = getAiConfiguration(environment);
  const httpsProxy = environment.HTTPS_PROXY || environment.https_proxy || "";
  const httpProxy = environment.HTTP_PROXY || environment.http_proxy || "";
  const noProxy = environment.NO_PROXY || environment.no_proxy || "";
  return {
    node_version: process.version,
    api_endpoint: safeApiEndpoint(config.apiBaseUrl, "/responses"),
    env_proxy_enabled: execArgv.includes("--use-env-proxy") || environment.NODE_USE_ENV_PROXY === "1",
    https_proxy_configured: Boolean(httpsProxy),
    http_proxy_configured: Boolean(httpProxy),
    https_proxy_url_valid: isProxyUrlValid(httpsProxy),
    http_proxy_url_valid: isProxyUrlValid(httpProxy),
    no_proxy_configured: Boolean(noProxy),
    api_bypassed_by_no_proxy: noProxyMatches(noProxy, config.apiBaseUrl),
  };
}

function imageBytesFromDataUrl(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function serviceError(message, code, httpStatus, diagnostics, cause) {
  const error = new Error(redactSensitiveText(message));
  error.code = code;
  error.httpStatus = httpStatus;
  error.diagnostics = diagnostics;
  if (cause) error.cause = cause;
  return error;
}

export const AI_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["task_summary", "recommendations", "not_recommended", "unknowns"],
  properties: {
    task_summary: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["asset_id", "rank", "role", "visual_evidence", "relation_to_request", "suggested_title", "uncertainty"],
        properties: {
          asset_id: { type: "string" },
          rank: { type: "integer", minimum: 1, maximum: 4 },
          role: { type: "string" },
          visual_evidence: { type: "string" },
          relation_to_request: { type: "string" },
          suggested_title: { type: "string" },
          uncertainty: { type: "string" },
        },
      },
    },
    not_recommended: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["asset_id", "reason"],
        properties: {
          asset_id: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
  },
};

export function getAiConfiguration(environment = process.env) {
  return {
    configured: Boolean(environment.OPENAI_API_KEY?.trim()),
    provider: "OpenAI",
    model: environment.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
    apiBaseUrl: (environment.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

export function publicAiStatus(environment = process.env) {
  const config = getAiConfiguration(environment);
  const network = getNetworkRuntime(environment);
  return {
    configured: config.configured,
    configuration_state: config.configured ? "configured_unverified" : "unconfigured",
    provider: config.provider,
    model: config.model,
    api: "Responses API",
    max_candidates: MAX_CANDIDATES,
    required_server_config: ["OPENAI_API_KEY"],
    optional_server_config: ["OPENAI_MODEL", "OPENAI_BASE_URL"],
    network,
    message: config.configured
      ? "服务端已配置密钥，但尚未执行真实调用；首次成功提交后才能确认认证、网络与模型可用性。"
      : "尚未配置服务端密钥。请在启动服务的终端设置 OPENAI_API_KEY 后重启；基础素材功能不受影响。",
  };
}

function cleanText(value, name, maxLength, required = true) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new Error(`${name}不能为空`);
  if (text.length > maxLength) throw new Error(`${name}超过${maxLength}字限制`);
  return text;
}

export function validateSelectionRequest(payload) {
  if (!payload || typeof payload !== "object") throw new Error("请求内容无效");
  const requestedCount = Number(payload.requested_count);
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 4) throw new Error("需要张数必须为1—4");
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) throw new Error("没有候选素材");
  if (payload.candidates.length > MAX_CANDIDATES) throw new Error(`一次最多分析${MAX_CANDIDATES}份候选素材，请先筛选`);
  if (requestedCount > payload.candidates.length) throw new Error("需要张数不能超过候选素材数");

  const ids = new Set();
  const candidates = payload.candidates.map((candidate, index) => {
    const id = cleanText(candidate?.id, `第${index + 1}份素材ID`, 120);
    if (ids.has(id)) throw new Error(`候选素材ID重复：${id}`);
    ids.add(id);
    const imageDataUrl = candidate?.image_data_url;
    if (typeof imageDataUrl !== "string" || !/^data:image\/(png|jpeg|webp);base64,/i.test(imageDataUrl)) {
      throw new Error(`素材 ${id} 缺少可读取的PNG、JPEG或WebP图片数据`);
    }
    if (imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error(`素材 ${id} 图片数据过大`);
    const metadata = candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
    return {
      id,
      image_data_url: imageDataUrl,
      metadata: {
        title: cleanText(metadata.title, "标题", 160, false) || "未知",
        stage: cleanText(metadata.stage, "阶段", 80, false) || "未知",
        materials: Array.isArray(metadata.materials) ? metadata.materials.map(String).slice(0, 12) : [],
        content_type: cleanText(metadata.content_type, "内容类型", 100, false) || "未知",
        source_kind: cleanText(metadata.source_kind, "来源类型", 100, false) || "未知",
        source_document: cleanText(metadata.source_document, "来源文档", 240, false) || "未知",
        source_page: metadata.source_page ?? null,
      },
    };
  });

  return {
    task_id: typeof payload.task_id === "string" && payload.task_id ? payload.task_id.slice(0, 120) : `ai-task-${crypto.randomUUID()}`,
    purpose: cleanText(payload.purpose, "用途", 240),
    requested_count: requestedCount,
    emphasis: cleanText(payload.emphasis, "重点", 400),
    constraints: cleanText(payload.constraints, "必须条件", 800, false),
    candidates,
  };
}

export function buildOpenAiRequest(selection, model) {
  const content = [{
    type: "input_text",
    text: [
      `选图用途：${selection.purpose}`,
      `需要数量：${selection.requested_count}张`,
      `希望突出：${selection.emphasis}`,
      `必须满足：${selection.constraints || "未补充"}`,
      "请逐张查看后再比较。推荐不超过所需数量；若信息不足，可以少推荐并在unknowns说明。",
    ].join("\n"),
  }];
  for (const candidate of selection.candidates) {
    content.push({
      type: "input_text",
      text: `候选素材 asset_id=${candidate.id}\n仅可作为事实使用的元数据：${JSON.stringify(candidate.metadata)}\n下一项图片就是该asset_id对应的实际候选图。`,
    });
    content.push({ type: "input_image", image_url: candidate.image_data_url, detail: "high" });
  }

  return {
    model,
    store: false,
    max_output_tokens: 4000,
    instructions: [
      "你是设计素材选图助手。必须实际观察每张输入图片，不能只依据文件名、标题、标签或元数据排序。",
      "可见依据必须描述图片中确实可见的构图、主体、结构、材料、文字或界面信息，并解释它与本次用途的关系。",
      "标题只能作为描述性建议。学期、来源等事实只可引用元数据；重量、性能、作者贡献等无法确认的信息必须标为未知，不能从画面猜测。",
      "每个候选ID只能出现一次：进入recommendations或not_recommended。推荐按rank升序。不要将不推荐解释成永久淘汰。",
      "以中文回答。",
    ].join("\n"),
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: "bamor_ai_selection",
        strict: true,
        schema: AI_RESPONSE_SCHEMA,
      },
    },
  };
}

export function extractStructuredOutput(response) {
  const refusal = response?.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "refusal");
  if (refusal) throw new Error(`模型拒绝了请求：${refusal.refusal || "未提供原因"}`);
  const text = response?.output_text
    ?? response?.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
  if (!text) throw new Error("模型响应中没有可读取的结构化结果");
  try { return JSON.parse(text); }
  catch { throw new Error("模型返回内容不是有效JSON"); }
}

export function validateModelSelection(result, selection) {
  if (!result || !Array.isArray(result.recommendations) || !Array.isArray(result.not_recommended) || !Array.isArray(result.unknowns)) {
    throw new Error("模型结果缺少必要字段");
  }
  if (result.recommendations.length > selection.requested_count) throw new Error("模型推荐数量超过用户要求");
  const candidateIds = new Set(selection.candidates.map((candidate) => candidate.id));
  const returnedIds = [...result.recommendations, ...result.not_recommended].map((item) => item.asset_id);
  if (returnedIds.some((id) => !candidateIds.has(id))) throw new Error("模型结果包含不在候选范围内的素材ID");
  if (new Set(returnedIds).size !== returnedIds.length) throw new Error("模型结果包含重复素材ID");
  if (returnedIds.length !== candidateIds.size) throw new Error("模型没有逐项说明全部候选素材");
  return result;
}

export async function runAiSelection(payload, environment = process.env, fetchImpl = fetch) {
  const startedAt = Date.now();
  const config = getAiConfiguration(environment);
  const runtime = getNetworkRuntime(environment);
  if (!config.configured) {
    throw serviceError("模型服务未连接：请在服务端设置 OPENAI_API_KEY 并重启服务", "MODEL_NOT_CONFIGURED", 503, {
      stage: "configuration",
      duration_ms: Date.now() - startedAt,
      network: runtime,
    });
  }
  let selection;
  try { selection = validateSelectionRequest(payload); }
  catch (cause) {
    throw serviceError(cause.message, "INVALID_SELECTION_REQUEST", 400, {
      stage: "validation",
      duration_ms: Date.now() - startedAt,
      error: describeError(cause),
    }, cause);
  }
  const requestedAt = new Date().toISOString();
  const clientRequestId = `bamor-${Date.now()}-${crypto.randomUUID()}`;
  let requestBody;
  try { requestBody = JSON.stringify(buildOpenAiRequest(selection, config.model)); }
  catch (cause) {
    throw serviceError(`无法序列化模型请求：${cause.message}`, "MODEL_REQUEST_SERIALIZATION_FAILED", 500, {
      stage: "serialize_request",
      duration_ms: Date.now() - startedAt,
      error: describeError(cause),
    }, cause);
  }
  const requestMetrics = {
    client_request_id: clientRequestId,
    model: config.model,
    image_count: selection.candidates.length,
    image_payload_bytes: selection.candidates.reduce((sum, candidate) => sum + imageBytesFromDataUrl(candidate.image_data_url), 0),
    request_body_bytes: Buffer.byteLength(requestBody, "utf8"),
    timeout_ms: MODEL_TIMEOUT_MS,
  };
  let apiResponse;
  try {
    apiResponse = await fetchImpl(`${config.apiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "X-Client-Request-Id": clientRequestId,
      },
      body: requestBody,
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause?.name === "AbortError" || cause?.name === "TimeoutError";
    throw serviceError(
      timedOut ? "模型调用超过120秒，服务端已停止等待" : `无法连接模型服务：${cause?.message || "网络错误"}`,
      timedOut ? "MODEL_TIMEOUT" : "MODEL_NETWORK_ERROR",
      timedOut ? 504 : 502,
      {
        stage: "api_fetch",
        duration_ms: Date.now() - startedAt,
        network: runtime,
        request: requestMetrics,
        error: describeError(cause),
      },
      cause,
    );
  }
  const requestId = apiResponse.headers.get("x-request-id") || apiResponse.headers.get("openai-request-id") || null;
  const responseText = await apiResponse.text().catch(() => "");
  let responseBody = {};
  try { responseBody = responseText ? JSON.parse(responseText) : {}; }
  catch (cause) {
    throw serviceError("模型服务返回的内容不是有效JSON", "MODEL_RESPONSE_INVALID_JSON", 502, {
      stage: "read_response",
      duration_ms: Date.now() - startedAt,
      http_status: apiResponse.status,
      request_id: requestId,
      network: runtime,
      request: requestMetrics,
      error: describeError(cause),
    }, cause);
  }
  if (!apiResponse.ok) {
    const code = apiResponse.status === 401
      ? "AUTHENTICATION_FAILED"
      : responseBody?.error?.code || "MODEL_REQUEST_FAILED";
    throw serviceError(
      responseBody?.error?.message || `模型服务返回HTTP ${apiResponse.status}`,
      code,
      apiResponse.status >= 400 && apiResponse.status < 600 ? apiResponse.status : 502,
      {
        stage: "api_http_response",
        duration_ms: Date.now() - startedAt,
        http_status: apiResponse.status,
        request_id: requestId,
        network: runtime,
        request: requestMetrics,
        response_error: {
          type: safeErrorCode(responseBody?.error?.type),
          code: safeErrorCode(responseBody?.error?.code),
          param: safeErrorCode(responseBody?.error?.param),
          message: redactSensitiveText(responseBody?.error?.message || ""),
        },
      },
    );
  }
  let suggestion;
  try { suggestion = validateModelSelection(extractStructuredOutput(responseBody), selection); }
  catch (cause) {
    throw serviceError(cause.message, "MODEL_RESULT_VALIDATION_FAILED", 502, {
      stage: "validate_response",
      duration_ms: Date.now() - startedAt,
      http_status: apiResponse.status,
      request_id: requestId,
      network: runtime,
      request: requestMetrics,
      error: describeError(cause),
    }, cause);
  }
  return {
    id: selection.task_id,
    status: "completed",
    created_at: requestedAt,
    completed_at: new Date().toISOString(),
    requirements: {
      purpose: selection.purpose,
      requested_count: selection.requested_count,
      emphasis: selection.emphasis,
      constraints: selection.constraints,
    },
    candidate_asset_ids: selection.candidates.map((candidate) => candidate.id),
    model_call: {
      provider: config.provider,
      model: config.model,
      api: "Responses API",
      response_id: responseBody.id ?? null,
      actual_image_count: selection.candidates.length,
      request_id: requestId,
      client_request_id: clientRequestId,
      duration_ms: Date.now() - startedAt,
      request_body_bytes: requestMetrics.request_body_bytes,
      image_payload_bytes: requestMetrics.image_payload_bytes,
    },
    ai_suggestion: suggestion,
  };
}
