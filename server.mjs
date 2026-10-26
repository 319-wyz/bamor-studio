import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describeError, getNetworkRuntime, publicAiStatus, runAiSelection } from "./server/ai-service.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.BAMOR_PORT || 4173);
const projectVideoCandidates = ["media/bamor-1024.mp4", "media/bamor-1024.webm"];
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, limit = 64 * 1024 * 1024) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("请求过大，请减少候选图片或先压缩图片");
        error.code = "REQUEST_BODY_TOO_LARGE";
        error.httpStatus = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (cause) {
        const error = new Error("请求JSON无法解析");
        error.code = "INVALID_JSON";
        error.httpStatus = 400;
        error.cause = cause;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
    if (url.pathname === "/api/project-media") {
      if (request.method !== "GET") return sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "仅支持GET" } });
      const videoUrl = projectVideoCandidates.find((candidate) => existsSync(resolve(root, candidate))) ?? null;
      return sendJson(response, 200, {
        video_available: Boolean(videoUrl),
        video_url: videoUrl,
        expected_paths: projectVideoCandidates,
      });
    }
    if (url.pathname === "/api/ai-status") {
      if (request.method !== "GET") return sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "仅支持GET" } });
      return sendJson(response, 200, publicAiStatus());
    }
    if (url.pathname === "/api/ai-select") {
      if (request.method !== "POST") return sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "仅支持POST" } });
      try {
        const task = await runAiSelection(await readJsonBody(request));
        console.log(JSON.stringify({
          event: "ai_selection_completed",
          task_id: task.id,
          model: task.model_call.model,
          image_count: task.model_call.actual_image_count,
          response_id: task.model_call.response_id,
          request_id: task.model_call.request_id,
          client_request_id: task.model_call.client_request_id,
          duration_ms: task.model_call.duration_ms,
          request_body_bytes: task.model_call.request_body_bytes,
          image_payload_bytes: task.model_call.image_payload_bytes,
        }));
        return sendJson(response, 200, { task });
      } catch (error) {
        const diagnostics = error.diagnostics ?? {
          stage: "local_request",
          error: describeError(error),
        };
        console.error(JSON.stringify({
          event: "ai_selection_failed",
          code: error.code || "AI_SELECTION_FAILED",
          message: error.message,
          diagnostics,
        }));
        return sendJson(response, error.httpStatus || 400, {
          error: {
            code: error.code || "AI_SELECTION_FAILED",
            message: error.message,
            diagnostics,
          },
        });
      }
    }
    const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^[/\\]+/, "");
    const candidates = extname(relativePath) ? [relativePath] : [relativePath, `${relativePath}.html`];
    const filePath = candidates.map((candidate) => resolve(root, candidate)).find((candidate) => (
      candidate.startsWith(resolve(root) + sep) && existsSync(candidate) && statSync(candidate).isFile()
    ));
    if (!filePath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("404 · 文件不存在");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`请求无效：${error.message}`);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`端口 ${port} 已被占用。请设置 BAMOR_PORT 后重试。`);
  else console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`BAMOR Design Studio 已启动：http://${host}:${port}`);
  console.log(JSON.stringify({ event: "ai_network_runtime", ...getNetworkRuntime() }));
  console.log("按 Ctrl+C 停止服务");
});
