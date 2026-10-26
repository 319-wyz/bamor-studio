## 2026-10-22 本轮补充

- docs/RESUME_STAR_WORKING_DRAFT.md：完整STAR叙事、JD对应、待补工具与社区经历。
- data/data-audit-20261022.json：56条状态记录的本轮检查结果。
- data/usability-test-template.csv：3个参与者名额、2类任务、手动/工具共12次执行的空白记录模板，当前全部planned。
- 12组生成任务尚未实际生成；24个候选素材、72个三规格导出是计划验收规模。
- 这是开发启动包，网页应用还需要按照下文在Codex中开发。
- 2026-10-22优先级调整：M1之后先做“真实视觉模型按自然语言需求选图”；批量素材卡与对比板顺延。

# BAMOR Design Studio：从这里开始

本包是开发启动材料，尚未包含网页应用代码。2026-10-21根据真实项目资料准备，用于毕业后个人延伸开发。

第一个目标是完成能导入、筛选、比较、标注、保存和导出素材的网页。M1已于2026-10-22实现；下一阶段先验证真实视觉模型选图，再做批量排版和生成任务组织。

## 第一步：解压并打开
在Windows右键ZIP → 全部解压。可放到D:\ucl\work\intern\skill\codex-practice\bamor-studio。
用已安装的Codex添加/打开这个文件夹，选择能看到本文件和AGENTS.md的一层。
新建项目聊天，先复制prompts/01_inspect.md的正文。此步检查目录与运行环境，不生成网页。

## 第二步：开始制作
核对回复识别8份样例、56条观测和12个计划任务，再复制prompts/02_build_m1.md。
按Codex实际提供的本机地址打开网页。现在还没有可直接双击的index.html，首次开发会创建它。

## 第三步：验收和下一步
照docs/ACCEPTANCE.md实际操作。用CHANGELOG.md记录失败与修复。
原 `prompts/03_build_m2.md` 的PNG素材卡和对比板生产已顺延为后续阶段，文件保留作为历史计划，不代表当前优先级。
AI选图优先验证完成后，再安排批量排版和 `prompts/04_generation_tasks.md` 的生成任务组织。

## 包内材料
- AGENTS.md：给编码助手的项目工作说明，不代表已经运行多Agent。
- docs/PRD.md：产品目标、用户和M1/M2范围。
- docs/EVIDENCE.md：素材出处、版本和能否作为训练数据的说明。
- docs/ACCEPTANCE.md：可亲自操作的检查表。
- docs/REVIEW_RUBRIC.md：人工审美标签的尺度与取舍原因。
- docs/MEASUREMENT_PLAN.md：怎样真实测耗时和交付质量。
- data/assets.json：8张真实项目页图的元数据，全部待审核。
- data/measurements.csv：从T2期末22—25页提取的56条几何观测，单位m。
- data/generation-tasks.json：12个尚未执行的计划任务。
- sample-assets/：8张项目页面导出图，包含图解、表格、实物与界面。
- CHANGELOG.md：本次准备和后续开发记录。

这里和Windows Codex通过本包交接上下文。聊天同步不等于你的D盘文件自动可被另一环境读取；以实际打开的目录为准。
