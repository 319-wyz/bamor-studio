import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAiRequest, describeError, getNetworkRuntime, publicAiStatus, redactSensitiveText,
  runAiSelection, validateSelectionRequest,
} from "../server/ai-service.mjs";

const pixel = "data:image/png;base64,iVBORw0KGgo=";
const payload = {
  task_id: "task-test",
  purpose: "选择作品封面",
  requested_count: 1,
  emphasis: "视觉焦点和项目辨识度",
  constraints: "不要猜测重量",
  candidates: [
    { id: "a01", image_data_url: pixel, metadata: { title: "实验页", stage: "term1", materials: ["plywood"] } },
    { id: "a07", image_data_url: pixel, metadata: { title: "竹构原型", stage: "term2", materials: ["bamboo"] } },
  ],
};

test("未配置密钥时公开状态明确且不暴露凭证", () => {
  const status = publicAiStatus({});
  assert.equal(status.configured, false);
  assert.equal(status.configuration_state, "unconfigured");
  assert.equal(status.model, "gpt-6.1-sol");
  assert.deepEqual(status.required_server_config, ["OPENAI_API_KEY"]);
  assert.equal("apiKey" in status, false);
});

test("已配置密钥只标记为尚未验证", () => {
  const status = publicAiStatus({ OPENAI_API_KEY: "server-only", HTTPS_PROXY: "http://127.0.0.1:7890" });
  assert.equal(status.configured, true);
  assert.equal(status.configuration_state, "configured_unverified");
  assert.match(status.message, /尚未执行真实调用/);
  assert.equal(status.network.https_proxy_configured, true);
  assert.equal(status.network.api_endpoint, "https://api.openai.com/v1/responses");
});

test("公开网络诊断只报告安全状态，不暴露代理凭据", () => {
  const runtime = getNetworkRuntime({
    OPENAI_API_KEY: "secret",
    OPENAI_BASE_URL: "https://user:password@api.openai.com/v1",
    HTTPS_PROXY: "http://proxy-user:proxy-password@127.0.0.1:7890",
    NO_PROXY: "localhost,.example.com",
  }, ["--use-env-proxy"]);
  assert.equal(runtime.env_proxy_enabled, true);
  assert.equal(runtime.https_proxy_configured, true);
  assert.equal(runtime.https_proxy_url_valid, true);
  assert.equal(runtime.api_endpoint, "https://api.openai.com/v1/responses");
  assert.doesNotMatch(JSON.stringify(runtime), /password|proxy-user|secret/);
});

test("选图请求限制数量并要求实际图片数据", () => {
  const selection = validateSelectionRequest(payload);
  assert.equal(selection.candidates.length, 2);
  assert.throws(() => validateSelectionRequest({ ...payload, requested_count: 3 }), /不能超过候选/);
  assert.throws(() => validateSelectionRequest({ ...payload, candidates: [{ id: "a01", metadata: {} }] }), /图片数据/);
});

test("模型请求同时包含候选ID、实际图片和结构化输出约束", () => {
  const request = buildOpenAiRequest(validateSelectionRequest(payload), "gpt-6.1-sol");
  const images = request.input[0].content.filter((item) => item.type === "input_image");
  assert.equal(images.length, 2);
  assert.equal(images[0].image_url, pixel);
  assert.equal(request.text.format.type, "json_schema");
  assert.match(request.instructions, /不能只依据文件名/);
});

test("没有密钥时拒绝调用而不是生成模拟结果", async () => {
  await assert.rejects(() => runAiSelection(payload, {}), /未连接/);
});

test("真实调用路径记录模型、响应ID和图片数量", async () => {
  const modelResult = {
    task_summary: "封面需要明确视觉中心。",
    recommendations: [{ asset_id: "a07", rank: 1, role: "主视觉", visual_evidence: "可见竹构主体", relation_to_request: "主体明确", suggested_title: "竹构原型", uncertainty: "无法确认重量" }],
    not_recommended: [{ asset_id: "a01", reason: "版面信息密集，不适合本次封面" }],
    unknowns: ["无法从图片确认重量"],
  };
  const fakeFetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer test-key");
    return new Response(JSON.stringify({
      id: "resp_test",
      output: [{ content: [{ type: "output_text", text: JSON.stringify(modelResult) }] }],
    }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req_test" } });
  };
  const task = await runAiSelection(payload, { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-6.1-sol" }, fakeFetch);
  assert.equal(task.model_call.response_id, "resp_test");
  assert.equal(task.model_call.actual_image_count, 2);
  assert.equal(task.model_call.request_id, "req_test");
  assert.ok(task.model_call.request_body_bytes > 0);
  assert.equal(task.ai_suggestion.recommendations[0].asset_id, "a07");
});

test("网络失败与认证失败返回可区分状态", async () => {
  const aggregate = new AggregateError([
    Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:7890"), { code: "ECONNREFUSED" }),
    Object.assign(new Error("second route failed"), { code: "ENETUNREACH" }),
  ], "proxy connect failed");
  await assert.rejects(
    () => runAiSelection(payload, { OPENAI_API_KEY: "test-key" }, async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: aggregate });
    }),
    (error) => error.code === "MODEL_NETWORK_ERROR"
      && error.httpStatus === 502
      && error.diagnostics.stage === "api_fetch"
      && error.diagnostics.error.cause.errors[0].code === "ECONNREFUSED",
  );
  await assert.rejects(
    () => runAiSelection(payload, { OPENAI_API_KEY: "bad-key" }, async () => new Response(JSON.stringify({ error: { message: "Incorrect API key", code: "invalid_api_key" } }), { status: 401, headers: { "x-request-id": "req_auth" } })),
    (error) => error.code === "AUTHENTICATION_FAILED"
      && error.httpStatus === 401
      && error.diagnostics.request_id === "req_auth",
  );
});

test("错误描述保留cause和AggregateError子错误并脱敏", () => {
  const nested = Object.assign(new Error("connect to https://name:pass@proxy.test failed for sk-abcdefghijk"), { code: "ECONNRESET" });
  const detail = describeError(Object.assign(new TypeError("fetch failed"), { cause: new AggregateError([nested], "all failed") }));
  assert.equal(detail.cause.errors[0].code, "ECONNRESET");
  assert.doesNotMatch(JSON.stringify(detail), /name:pass|sk-abcdefghijk/);
  assert.match(redactSensitiveText("Bearer top-secret"), /已脱敏/);
});
