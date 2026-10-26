import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(projectRoot, "dist");
const port = Number(process.env.BAMOR_PUBLIC_PORT || 4174);
const host = "127.0.0.1";
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".png": "image/png", ".mp4": "video/mp4", ".webm": "video/webm",
};

createServer((request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  const routeMap = { "/": "index.html", "/project": "project.html", "/studio": "studio.html" };
  const relative = routeMap[url.pathname] || decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
  let filePath = resolve(root, relative);
  if (!filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) filePath = resolve(root, "index.html");
  response.writeHead(200, { "Content-Type": mime[extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
}).listen(port, host, () => console.log(`BAMOR公开静态预览：http://${host}:${port}`));
