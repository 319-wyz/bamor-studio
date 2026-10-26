import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "src"), { recursive: true });
await mkdir(resolve(output, "data"), { recursive: true });

const files = [
  "index.html",
  "studio.html",
  "project.html",
  "landing.css",
  "styles.css",
  "project.css",
  "src/landing.js",
  "src/app.js",
  "src/export.js",
  "src/project.js",
  "src/storage.js",
  "src/utils.js",
  "data/assets.json",
  "data/measurements.csv",
];

for (const relativePath of files) {
  const target = resolve(output, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, relativePath), target);
}

await cp(resolve(root, "sample-assets"), resolve(output, "sample-assets"), { recursive: true });
await cp(resolve(root, "media"), resolve(output, "media"), { recursive: true });

await writeFile(resolve(output, "_redirects"), [
  "/project /project.html 200",
  "/studio /studio.html 200",
  "",
].join("\n"), "utf8");

await writeFile(resolve(output, "_headers"), [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "/media/*",
  "  Cache-Control: public, max-age=86400",
  "",
].join("\n"), "utf8");

const manifest = JSON.parse(await readFile(resolve(output, "data/assets.json"), "utf8"));
if (!Array.isArray(manifest) || manifest.length !== 8) throw new Error("公开精选案例清单必须恰好包含8条记录");

console.log(JSON.stringify({
  output,
  entrypoints: ["/", "/project", "/studio"],
  sample_count: manifest.length,
  includes_video: true,
  excludes: ["server.mjs", "server/", "tests/", "docs/", "prompts/", ".env", ".git"],
}, null, 2));
