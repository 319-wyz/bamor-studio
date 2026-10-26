# AI选图模型配置

## 当前实现

AI选图通过本地 `server.mjs` 的服务端接口调用 OpenAI Responses API。浏览器只把当前候选图片、必要元数据和选图需求发送给本地服务；API密钥不会进入前端代码、IndexedDB或导出的任务记录。

默认模型是 `gpt-6.1-sol`。可通过服务端环境变量改为账号实际可用、支持图片输入和Structured Outputs的模型。

官方依据：

- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses)：Responses API支持Base64 Data URL及多张图片输入。
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)：使用JSON Schema约束模型结果。

## Windows PowerShell启动

只在准备启动服务的PowerShell窗口中设置凭证：

```powershell
cd D:\ucl\work\intern\skill\codex-practice\BAMOR_Codex_Starter\bamor-studio
$env:OPENAI_API_KEY = Read-Host "OpenAI API Key" -MaskInput
$env:OPENAI_MODEL="gpt-6.1-sol"
& "D:\Downloads\app\nodejs\node.exe" --use-env-proxy .\server.mjs
```

`OPENAI_MODEL`是可选项；不设置时使用 `gpt-6.1-sol`。如确实使用其他兼容服务，可选设置 `OPENAI_BASE_URL`，默认值为 `https://api.openai.com/v1`。

不要把真实密钥写入HTML、JavaScript、JSON备份、截图或项目文件。关闭该PowerShell窗口后，当前窗口中临时设置的环境变量随之失效。

若代理位于 `127.0.0.1:7890`，请在同一PowerShell进程中保留 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 与 `NODE_USE_ENV_PROXY=1`，并使用上面的 `--use-env-proxy` 启动参数。页面模型状态区会显示脱敏后的实际API端点，以及代理是否已配置、是否启用、是否被 `NO_PROXY` 绕过；不会显示密钥、代理凭据或完整环境变量。

## 分级诊断

在已经设置密钥和代理的同一PowerShell窗口中，可先停止服务，再运行：

```powershell
& "D:\Downloads\app\nodejs\node.exe" --use-env-proxy .\scripts\diagnose-ai.mjs
```

脚本会按顺序执行并在首个失败处停止：

1. `/v1/models` 连接与认证；
2. 保持当前 `OPENAI_MODEL` 的最小文本 Responses 请求；
3. 使用项目中最小的样例页执行单图请求；
4. 使用包内8份样例执行一次真实选图。

输出只包含阶段、耗时、HTTP状态、`x-request-id`、客户端请求ID、请求体大小和脱敏后的错误链。不会输出 Authorization、密钥、图片Base64或带凭据的代理地址。浏览器中额外上传的素材只存在IndexedDB，需在页面上用当前筛选范围再执行一次，才能验收实际的10份候选。

## 连接与记录语义

- 页面显示“未配置模型密钥”：服务端启动时没有读到 `OPENAI_API_KEY`，基础素材功能仍可使用。
- 页面显示“已配置，尚未验证”：只表示发现了服务端密钥；首次真实提交后才能确认账号权限、模型可用性和网络连通性。
- 页面显示“真实调用成功”：本次会话已经完成实际模型请求；认证、网络或模型调用失败会分别结束等待并提供重试入口。
- 成功结果会把模型、响应ID、实际图片数量、AI建议和时间保存为独立的IndexedDB任务记录。
- 人工确认保存在同一任务的独立字段中，不修改素材原有评分、审核状态或取舍理由。
- JSON备份包含已保存的AI任务；CSV仍只导出素材记录。

## 建议的真实验收任务

导入8份样例后，使用页面快捷填写并分别执行：

1. “选择作品封面”：检查推荐是否更重视视觉焦点、构图完整度和封面适配。
2. “解释网格壳体构型”：检查推荐是否转向能看清四支腿、竹构连接和网格表皮关系的页面。

两次返回应引用不同的可见依据。若模型只复述标题、声称看到了不存在的细节、编造重量或结构性能，应判定为失败并保留调用记录。
