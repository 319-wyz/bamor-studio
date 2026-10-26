# BAMOR 公开静态部署说明

更新日期：2026-10-27

## 本轮核对结论

修改前的公开站点与本机 `30d68da` 基线不同步，且仍是旧信息架构：

- `https://bamorzz.pages.dev/` 返回旧素材工作台，而不是双入口视频首页。
- `https://bamorzz.pages.dev/project` 返回旧项目页。
- `https://bamorzz.pages.dev/data/assets.json` 返回 `text/html` 首页内容，而不是 JSON，因此新访客导入样例会出现 `Unexpected token '<'`。
- `https://bamorzz.pages.dev/api/ai-status` 也返回 `text/html` 首页内容；它是静态托管缺少服务端 API 的独立问题，不能与样例清单错误混为一个根因。

### 任务状态

| 状态 | 本轮开始时的核对结果 | 处理 |
| --- | --- | --- |
| 已完成且验收通过 | 工作台 IndexedDB 兼容保存、8份样例幂等导入、上传、筛选、2—4项比较、人工审核、CSV/JSON、真实 AI 服务端接口与错误诊断 | 保留实现和数据库名称、版本、素材 ID；只补公开入口和静态部署行为 |
| 部分完成 | 项目展示页、双向导航、真实视频组件、五阶段叙事、响应式与减少动效 | 保留原页面和样式，修正入口位置、阶段标签/命中规则、公开文案、排版和静态路径 |
| 未完成 | 根路径双入口、独立 `/studio` 路由、静态 AI 状态识别、恢复原始精选案例、可重复静态构建 | 本轮完成并加入自动化验收 |
| 当前缺素材 | 独立使用场景照片、最终覆膜结构清晰图、展览原始照片，以及可制作骨架/覆膜光标的授权透明素材 | 不使用占位图、不重复已有页面、不实现自定义光标 |

## 页面和数据路径

- `/`：真实 `media/bamor-1024.mp4` 双入口开场；视频失败时显示真实项目图。
- `/project`：招聘者项目展示。
- `/studio`：原素材工作台。仍使用同一 origin 下的 `bamor-design-studio` IndexedDB；路径变化不会重命名或迁移数据库。
- `/data/assets.json`：8份版本化精选案例清单。
- `/sample-assets/`：清单对应的8张项目页图。

公开版工作台采用“版本化精选案例 + 每台设备独立工作区”。访客上传、评分、审核理由和 AI 任务只保存在该浏览器；清除站点数据会丢失，需导出 JSON 备份。`恢复原始精选案例`只重写8个稳定样例 ID，不删除访客上传内容。

## 五阶段真实素材映射

以下页码只供内部追溯，不显示在公开叙事中：

| 阶段 | 当前素材 | 内部来源 | 边界 |
| --- | --- | --- | --- |
| 问题与目标 / Problem & Aim | `a03_t1final_p024.png` 两/三/四支腿早期构型 | T1 第24页 | 是最接近“把空间需求转成支撑问题”的现有证据，不是用户访谈或真实使用场景照片 |
| 材料试验 / Material Studies | `a02_t1final_p022.png` 切割图案形变比较 | T1 第22页 | PDF项目页，不是独立原始照片 |
| 结构取舍 / Structural Decisions | `a04_t1final_p028.png` 构型评价对照 | T1 第28页 | 只呈现原项目记录，不推导性能提升 |
| 交互行为 / Responsive Behaviour | `a08_t2final_p030.png` Unity交互界面 | T2 第30页 | 是界面/状态证据，不冒充实物传感器特写 |
| 原型证据 / Prototype Evidence | `a07_t2final_p027.png` 竹构与网格壳体研究原型 | T2 第27页 | 网格壳体是经验证并参与展览的分支，不替代最终作品主体 |

## 生成公开目录

在仓库根目录运行：

```powershell
D:\Downloads\app\nodejs\node.exe .\scripts\build-public.mjs
```

输出目录为 `dist/`。构建会复制公开页面、CSS、浏览器脚本、8份样例、几何记录和真实视频，并生成 `_redirects` 与 `_headers`。它不会复制 `server.mjs`、`server/`、`tests/`、`docs/`、`prompts/`、`.env` 或 Git 元数据。

本地静态预览：

```powershell
$env:BAMOR_PUBLIC_PORT = '4174'
D:\Downloads\app\nodejs\node.exe .\scripts\preview-public.mjs
```

访问 `http://127.0.0.1:4174/`、`/project` 和 `/studio`。这个预览会模拟静态托管缺少 `/api/ai-status` 的情况，用于确认页面显示“在线展示版暂不可调用 AI”，而不是原始 JSON 解析异常。

## Cloudflare Pages 设置

本轮没有推送或触发线上部署。确认本地提交后，在现有 `bamorzz` Pages 项目中：

1. 确认连接仓库为 `319-wyz/bamor-studio`，生产分支为 `main`。
2. 构建命令填写 `node scripts/build-public.mjs`。
3. 构建输出目录填写 `dist`；仓库根目录保持项目根目录。
4. 不在静态构建中配置 `OPENAI_API_KEY`，也不要把密钥写入前端环境变量。
5. 推送本轮提交到 `main`，等待部署成功后逐项打开 `/`、`/project`、`/studio`、`/data/assets.json` 和8个图片 URL。
6. 确认 `/data/assets.json` 的 `Content-Type` 为 JSON、`/api/ai-status` 不再在界面暴露解析错误、深链接刷新仍停留在对应页面。

Cloudflare Pages 的 Git 集成和 `_redirects` 规则分别见官方文档：

- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/configuration/redirects/

## 尚需人工或真实设备验证

- Safari 未在当前 Windows 环境中运行；当前自动化浏览器是 Microsoft Edge（Chromium）。
- 没有在中国大陆手机或第二台物理设备上测试。隔离浏览器配置只证明不同浏览器配置不会共享 IndexedDB。
- L1 默认浏览器中的12张个人上传图不由自动化测试读取或清理。本轮测试用隔离数据验证“恢复精选案例”不会删除额外上传素材。
- 线上站点只有在提交被推送且 Cloudflare 完成构建后才会更新。
