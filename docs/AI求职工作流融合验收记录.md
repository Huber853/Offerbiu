# AI 求职工作流融合验收记录

日期：2026-10-23。对应 [开发文档 v1.0](AI求职工作流融合开发文档.md)，用户授权范围为 P0 M0—M4。实现位于本地 `codex/ai-job-workflow` 分支，基线 `d80ba02084a14781819104653d03b952f2011090`，本次没有提交或推送远程。

## 交付结果

已接入“真实经历底稿 → 选定岗位评估 → 材料草拟 → 独立复核 → 手工选择段落创建新简历 → 本人确认实际投递快照”。保留原有账号、官方岗位库、简历编辑器、版本历史、投递进展、待办与润色入口。无新增运行时 npm 依赖。

| 里程碑 | 已完成内容 | 核对结果 |
| --- | --- | --- |
| M0 | 停服状态下备份完整 storage、固定代码及岗位基线、四表增量迁移 | 备份和当前库 integrity_check 均为 ok |
| M1 | 草稿导入、逐项确认、来源核对、revision、20 岗正文及状态标注 | 导入不会自动确认，旧采集时间保持不变 |
| M2 | 官方具体岗位评估、三态条件、引用、覆盖率、服务端评分、缓存及取消 | 结构或原句不合格时拒绝保存有效结果 |
| M3 | 段落及网申字段、字数口径、独立复核、来源冲突、采纳新简历 V1 | 原简历内容与联系方式保留 |
| M4 | 最终预览、历史简历版本、独立留档、幂等、导出及删除 | 实际选择的文字和快照与后续来源解耦 |

主库已迁移到 `workflow_schema_version=1`。迁移前后均为 **2 个原账号、4 份原简历、1 份 AI 设置**，四张新表初始均为 0 条；验收用虚构资料没有写入主库。本地服务已启动在 [工作台](http://127.0.0.1:4174/workspace/#/profile)。当前活动目录 15,929 岗，原采集时间仍为 2026-09-27，明确截止日期过滤按北京时间执行。

## 自动化与审查

`node --test tests/*.test.mjs`：**93/93 通过，0 失败、0 跳过**。`server/`、`workspace/`、`shared/` 共 27 个 JS/MJS 文件语法检查通过；`git diff --check` 返回 0。自动化模型测试使用 fetch 模拟，独立临时 SQLite，不伪称真实模型调用。

覆盖账号与关联资源归属、CSRF、旧库迁移、确认及容量、引用原句、JD 单元完整覆盖、三态条件、60/40 权重与 80% 门槛、缓存失效、并发与预算、版本冲突、字数口径、幂等、历史版本、删除来源后的留档、导出密钥排除及异步编辑保护。既有段落润色还验证了共享调用后的报告字段兼容、原简历不变和版本冲突。

独立规格及代码评审发现的四项缺陷已修复，并加入先失败后通过的回归：省市层级误否决；最终预览后 JD 更新；迟到材料响应覆盖新编辑；已关闭岗位未更新历史 payload。评审再次核对前两项，相关 29 项检查通过；后两项修复后新增 3 项检查及完整套件通过。

## 真实 DeepSeek 验证

使用现有官方 DeepSeek 配置、`deepseek-flash`，在独立测试库中创建完全虚构的候选人，教育、项目及技能均为测试夹具。没有使用用户本人真实事实进行匹配，也没有把真实联系方式或图片发给模型。

第一轮 20 岗有 6 次结构/引用校验失败。复现确认模型曾将 education 元数据的文字挂到并不含该原句的 JD 单元；提示词补充逐单元返回清单、资格候选引用边界，并提升评估提示词版本到 2。第二轮 19/20 一次通过，剩余 1 岗因 not_shown 携带引用被拦截，主动重试后通过。**最终 20/20 均取得有效评估，不代表首次成功率为 100%。**

真实草拟触发了中文日期写法的误拒绝，现已按相同年月日和精度归一化；改变月份或补造日期仍拒绝。另补充禁止占位字段和无依据否定事实的提示。独立复核对角色、引用与“在读”推断提出修改，浏览器中按既有引用调整正文，保存为材料 V4 后复核通过，再手工采纳和留档。

本轮调试及验收共发生 **49 次实际模型请求**：43 次评估、2 次草拟、4 次复核，包含失败请求。失败没有后台自动重跑，未以模拟结果替代。模型返回用量保存在本机证据中；未核对账户实际扣费，不据此给出费用结论。

## 浏览器及 PDF

使用本机 Edge 无头浏览器及全新测试会话验证：登录；预览导入并保存未确认草稿；逐条确认后就绪；岗位质量和未知状态；最多选 10 岗；取消当前及后续批次；正文修改清除旧复核；真实模型重审；复制仅正文；创建独立简历 V1；最终预览勾选确认；只存选中字段；本人修改标记；打开独立归档；个人导出 v2。

批次取消采用拦截待处理浏览器请求的方式测试取消行为，该次不产生外部模型请求。其他真实模型结果来自前述 DeepSeek 调用，浏览器复核为真实请求。桌面 1440px 与手机 390px 均检查，窄屏无横向溢出，减少动态设置下侧栏不遮挡正文；成功路径无 pageerror。

通过现有“导出 PDF / 打印”操作取得 **1 页 A4 PDF**，Poppler 渲染后检查了中文姓名、段落、教育/项目及技能排版，没有乱码、方框或裁切；pypdf 提取确认中文姓名和 SQLite 正文存在，无替换字符。该文件为虚构资料验收样本，不是用户求职简历。

## 本机证据与回退

完整原库备份位于 `backups/workflow-20261023-191524/storage/`，包含数据库、WAL/SHM 及加密文件。该目录受 Git 忽略保护。回退前须先停服并另备当前 storage，不能覆盖本次实施之后新增的个人数据。

本机证据位于 `backups/workflow-20261023-191524/qa/`：`automated-tests.txt`、`real-model-round1.json`、`real-model-round2.json`、`real-model-results.json`、`browser-profile-results.json`、`browser-batch-results.json`、`browser-materials-results.json`、稳定桌面/手机截图及 `resume-verified.pdf/png/txt`。这些是本机调试材料，不随 Git 提交。临时 QA 服务和临时复制的 AI 凭据在验收后清理。

## 适用范围与限制

已完成功能和技术链路验收；用户本人的底稿尚需在界面逐项确认，虚构资料的分数不构成个人求职建议。20 个岗位审核的是现有采集快照，公开网页当前状态均缺乏明确同岗位在招证据，因此保持 unknown；不能宣称这 20 岗现在均可投。已关闭、受限页面和数据缺失情形另由自动化夹具覆盖。

模型仍可能产生不合规输出或过度保守的复核意见，系统明确拒绝、保留旧资料，需主动修订或重试；程序和第二次模型检查都不能证明全部语义真实。图片、联系方式不进入新增底稿工作流模型输入，但本地原简历和本人导出的留档仍保留其实际内容。

P1/P2 的面试准备、复盘、学习计划、通义专用适配、私人岗位导入、Word 导出、邮件日历联动及公网部署尚未实施，按批准文档留待后续评审。

## 20 岗样本记录

下表为虚构候选人的最终有效结果，供检查技术边界。正文质量与当前在招状态分开记录；partial 不提供可比较总分。

| 序号 | 官方岗位原文 | 正文审核 | 当前状态 | 虚构资料条件结果 | 有效评估 |
| --- | --- | --- | --- | --- | --- |
| 1 | [【2027届校招】大模型应用开发工程师](https://szkingdom.zhiye.com/campus/detail?jobAdId=da7cb700-c052-476e-bbde-6e36b896c04c) | 待复核 | unknown | needs_review | 通过 |
| 2 | [【2027届校招】软件产品设计师](https://szkingdom.zhiye.com/campus/detail?jobAdId=5e77ec20-e535-4230-af28-7c3d2c6345d0) | 完整快照 | unknown | needs_review | 通过 |
| 3 | [【2027届校招】销售经理](https://szkingdom.zhiye.com/campus/detail?jobAdId=f81a38a8-348f-4711-b074-cd3ccf67f982) | 完整快照 | unknown | needs_review | 通过 |
| 4 | [【2027届校招】软件测试工程师](https://szkingdom.zhiye.com/campus/detail?jobAdId=911afb6e-d9f3-4405-9c29-445837bc1fe6) | 完整快照 | unknown | needs_review | 通过 |
| 5 | [培训生](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=3817a8d8-8c08-33b5-7b17-ce069a843f5a) | 待复核 | unknown | needs_review | 通过 |
| 6 | [2027-UX设计师](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=d617cbdc-56b9-a02f-a8b9-b2540901cc6e) | 完整快照 | unknown | needs_review | 通过 |
| 7 | [2027-测评交付经理](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=e9a7f1e4-5fed-c98d-1612-850048e7bae5) | 完整快照 | unknown | fail | 通过 |
| 8 | [2027-安全工程师](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=327dd027-348f-bcea-bca5-ba07c24850c1) | 完整快照 | unknown | needs_review | 通过 |
| 9 | [2027-算法工程师](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=6638f94a-dc59-ffb7-47c5-2e46447665c0) | 完整快照 | unknown | fail | 通过 |
| 10 | [网络规划储备](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=3b9adc97-1af7-123c-2fa0-3adca075f1da) | 完整快照 | unknown | needs_review | 通过 |
| 11 | [财务管理储备](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=72d3c058-182c-4c3c-da82-ba2cac8ec804) | 完整快照 | unknown | needs_review | 通过 |
| 12 | [数理化英主讲教师](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=1e325b8d-4262-8118-0e60-8466bd53943e) | 待复核 | unknown | needs_review | 通过 |
| 13 | [期现研究](https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id=9b2b5000-7a03-572e-9ef9-f7035f948018) | 完整快照 | unknown | fail | 通过 |
| 14 | [中国核电-经营管理岗（2027届）(J30654)](https://cnnc.zhiye.com/campus/detail?jobAdId=491acf3f-e9ec-48b6-b93a-3f3773e8d2c9) | 完整快照 | unknown | fail | 通过 |
| 15 | [中核华泰-法律事务管理（2027届校招）(J30314)](https://cnnc.zhiye.com/campus/detail?jobAdId=8c9efc3c-3f1d-4f72-a962-a4be27f06b5c) | 完整快照 | unknown | needs_review | 通过 |
| 16 | [中核华泰-电气工程师（2027届校招）(J30311)](https://cnnc.zhiye.com/campus/detail?jobAdId=a82bd4e9-9169-4df8-813c-0194ccfe5480) | 完整快照 | unknown | needs_review | 通过 |
| 17 | [堆工所-氢同位素工艺技术研究岗2027(J30343)](https://cnnc.zhiye.com/campus/detail?jobAdId=1a6c643d-1de3-4662-8b7f-ec45da6ab3e5) | 完整快照 | unknown | fail | 主动重试后通过 |
| 18 | [中核华辉-战略运营专员（2027届校园招聘）(J29690)](https://cnnc.zhiye.com/campus/detail?jobAdId=6df63e6b-d3a6-4f5b-8ea6-9c606abf14da) | 完整快照 | unknown | needs_review | 通过 |
| 19 | [同方能源-硬件开发工程师(J30831)](https://cnnc.zhiye.com/campus/detail?jobAdId=92831eb6-b630-4046-bbcf-b4e172c903d7) | 完整快照 | unknown | fail | 通过 |
| 20 | [良率数据分析工程师-张江（2027届校招）(J13273)](https://smics.zhiye.com/campusxq?jobId=390852418) | 完整快照 | unknown | fail | 通过 |
