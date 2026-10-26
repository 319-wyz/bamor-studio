import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeError,
  getAiConfiguration,
  getNetworkRuntime,
  redactSensitiveText,
  runAiSelection,
} from "../server/ai-service.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const environment = process.env;
const config = getAiConfiguration(environment);
const results = [];

function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

async function apiRequest(name, path, { method = "GET", body, timeoutMs = 30000 } = {}) {
  const startedAt = Date.now();
  const clientRequestId = `bamor-diagnostic-${Date.now()}-${crypto.randomUUID()}`;
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  try {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${environment.OPENAI_API_KEY}`,
        ...(serializedBody ? { "Content-Type": "application/json" } : {}),
        "X-Client-Request-Id": clientRequestId,
      },
      body: serializedBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseText = await response.text();
    let responseBody = {};
    try { responseBody = responseText ? JSON.parse(responseText) : {}; }
    catch { responseBody = {}; }
    const result = {
      step: name,
      ok: response.ok,
      stage: "http_response",
      duration_ms: Date.now() - startedAt,
      http_status: response.status,
      request_id: response.headers.get("x-request-id") || response.headers.get("openai-request-id") || null,
      client_request_id: clientRequestId,
      request_body_bytes: serializedBody ? byteLength(serializedBody) : 0,
      response_id: responseBody.id || null,
    };
    if (!response.ok) {
      result.error = {
        type: responseBody?.error?.type || null,
        code: responseBody?.error?.code || null,
        message: redactSensitiveText(responseBody?.error?.message || `HTTP ${response.status}`),
      };
    }
    results.push(result);
    return { result, body: responseBody };
  } catch (error) {
    const result = {
      step: name,
      ok: false,
      stage: "fetch",
      duration_ms: Date.now() - startedAt,
      client_request_id: clientRequestId,
      request_body_bytes: serializedBody ? byteLength(serializedBody) : 0,
      error: describeError(error),
    };
    results.push(result);
    return { result, body: {} };
  }
}

function printAndExit(exitCode) {
  console.log(JSON.stringify({
    configured: config.configured,
    model: config.model,
    network: getNetworkRuntime(environment),
    results,
  }, null, 2));
  process.exitCode = exitCode;
}

if (!config.configured) {
  results.push({ step: "configuration", ok: false, error: { code: "MODEL_NOT_CONFIGURED", message: "当前进程未读取到OPENAI_API_KEY" } });
  printAndExit(2);
} else {
  const connection = await apiRequest("connection_and_auth", "/models", { timeoutMs: 20000 });
  if (!connection.result.ok) {
    printAndExit(1);
  } else {
    const text = await apiRequest("minimal_text", "/responses", {
      method: "POST",
      timeoutMs: 60000,
      body: {
        model: config.model,
        store: false,
        max_output_tokens: 32,
        input: "连接诊断：请只回答 OK。",
      },
    });
    if (!text.result.ok) {
      printAndExit(1);
    } else {
      const imagePath = resolve(root, "sample-assets/a05_t2final_p018.png");
      const imageBytes = await readFile(imagePath);
      const image = await apiRequest("single_small_image", "/responses", {
        method: "POST",
        timeoutMs: 90000,
        body: {
          model: config.model,
          store: false,
          max_output_tokens: 80,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: "用一句中文描述这张图中可见的内容；无法确认的内容不要猜测。" },
              { type: "input_image", image_url: `data:image/png;base64,${imageBytes.toString("base64")}`, detail: "low" },
            ],
          }],
        },
      });
      image.result.image_file_bytes = imageBytes.length;
      if (!image.result.ok) {
        printAndExit(1);
      } else {
        const assets = JSON.parse(await readFile(resolve(root, "data/assets.json"), "utf8"));
        const candidates = await Promise.all(assets.map(async (asset) => {
          const bytes = await readFile(resolve(root, asset.file));
          return {
            id: asset.id,
            image_data_url: `data:image/png;base64,${bytes.toString("base64")}`,
            metadata: {
              title: asset.title,
              stage: asset.stage,
              materials: asset.materials,
              content_type: asset.content_type,
              source_kind: asset.source_kind,
              source_document: asset.source_document,
              source_page: asset.source_page,
            },
          };
        }));
        try {
          const task = await runAiSelection({
            task_id: `diagnostic-selection-${crypto.randomUUID()}`,
            purpose: "选择作品封面",
            requested_count: 1,
            emphasis: "第一眼能看出项目特色，构图完整，并有清楚的视觉焦点",
            constraints: "主体清楚；适合封面裁切；不得猜测重量、性能或作者贡献",
            candidates,
          }, environment);
          results.push({
            step: "packaged_eight_image_selection",
            ok: true,
            stage: "completed",
            duration_ms: task.model_call.duration_ms,
            request_id: task.model_call.request_id,
            client_request_id: task.model_call.client_request_id,
            response_id: task.model_call.response_id,
            request_body_bytes: task.model_call.request_body_bytes,
            image_payload_bytes: task.model_call.image_payload_bytes,
            recommended_asset_ids: task.ai_suggestion.recommendations.map((item) => item.asset_id),
          });
          printAndExit(0);
        } catch (error) {
          results.push({
            step: "packaged_eight_image_selection",
            ok: false,
            code: error.code || "AI_SELECTION_FAILED",
            message: redactSensitiveText(error.message),
            diagnostics: error.diagnostics || { error: describeError(error) },
          });
          printAndExit(1);
        }
      }
    }
  }
}
