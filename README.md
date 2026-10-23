# Offerbiu

Offerbiu 是一个面向 2027 届秋招的个人求职工作台。它把官方岗位检索、投递跟踪、在线简历编辑、日程管理和 AI 简历润色放在同一个本地优先的 Web 应用中。

项目沿用 Offerbiu 的蓝白 Hero 和卡通人物视觉：主页负责品牌展示，工作台负责实际求职操作。默认只监听本机地址，适合个人使用、演示和继续开发。

## 功能概览

- **岗位库**：收录约 16,375 条具体岗位（快照 2026-09-27），覆盖约 214 家企业/集团、32 个行业；支持公司、行业、岗位方向、Base、来源和关键词筛选。已过截止日期的岗位会自动下架。
- **官方直达**：每条岗位保留企业官网或西北大学就业网的具体岗位详情链接，可直接进入投递页面。
- **投递管理**：收藏岗位，记录投递状态、跟进时间、备注和所使用的简历版本。列表内直接改状态即保存，支持多选批量改状态、批量安排待办与批量移出清单（一次最多 200 条，任一记录失效则整批拒绝）。
- **进展记录**：状态变更、备注修改、绑定简历、创建待办都会写入 `application_events`，只记录真正变化的字段，可查询单条投递的推进时间线。
- **简历工作室**：在浏览器沙箱中选择模板、编辑纸面内容、调整字号/颜色/行距/模块顺序，并支持撤销、重做和版本恢复。
- **简历模板**：内置 15 套模板，新增 Bill Ryan 中文学术、Stack Overflow 技术履历、Kendall 专业双栏、Macchiato 清爽分栏；另有 5 套 [ResumeCollection](https://github.com/mmmlllnnn/ResumeCollection) 可编辑适配版。均可在线编辑并导出中文 A4。
- **图片功能**：支持头像和最多 3 张作品图，可更换、排序、裁切显示，并随简历版本保存。
- **导出**：导出 JSON、独立 HTML，或通过浏览器打印为 PDF。
- **日程与待办**：管理笔试、面试、截止日期和投递跟进事项；时间可以留空，表示暂未排期。
- **DeepSeek 润色**：选择简历段落和目标岗位后生成润色建议，支持前后对比、手动采纳和历史记录。
- **真实经历底稿**：从已保存简历预览导入，逐项确认事实和求职偏好；带来源、版本及修改冲突提示。
- **岗位评估**：每批最多主动选择 10 岗顺序评估，展示三态条件、正文质量、事实引用和待核实项。只有正文完整且覆盖率达到 80% 才提供可比较分数；分数不代表录用概率。
- **定制材料**：生成段落建议和网申字段，检查字数及事实引用；独立复核后主动选择段落，创建新简历 V1，保留源简历。
- **实际投递留档**：预览并确认当次 JD、历史简历版本和实际使用文字，保存不可原地修改的独立快照，支持导出和删除。
- **动态界面**：滚动入场、卡片悬停、统计数字过渡和卡通人物动效；支持暂停动效并遵循系统的“减少动态”设置。

## 快速开始

环境要求：Node.js 24 或更高版本。项目运行不依赖外部 npm 包，也不需要构建步骤。

```powershell
node server/index.mjs
```

也可以双击项目根目录的 `启动工作台.cmd`，或运行：

```powershell
.\start.ps1
```

启动后访问：

| 页面 | 地址 |
| --- | --- |
| 品牌主页 | <http://127.0.0.1:4174/> |
| 工作台 | <http://127.0.0.1:4174/workspace/> |
| 岗位库 | <http://127.0.0.1:4174/workspace/#/jobs> |
| 简历模板 | <http://127.0.0.1:4174/workspace/#/templates> |
| 真实经历底稿 | <http://127.0.0.1:4174/workspace/#/profile> |
| 岗位评估 | <http://127.0.0.1:4174/workspace/#/evaluations> |

第一次使用时，在工作台注册账号。岗位浏览和访客简历草稿可以在浏览器会话中使用；登录后才能保存个人投递、简历版本和图片资料。

## DeepSeek 配置

复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

然后在 `.env` 中填写服务端默认配置：

```env
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_MODEL=deepseek-flash
```

也可以进入“个人设置”填写个人密钥。个人配置优先于服务端默认配置，密钥在服务端以 AES-256-GCM 加密后保存。没有密钥时，页面会提示配置，不会返回模拟的 AI 结果。

自定义兼容接口需要单独填写个人密钥；更换服务商或接口地址后需重新填写。服务器默认密钥仅用于 DeepSeek 官方地址。

润色、评估、草拟和复核共用每用户每小时 30 次实际调用额度，同一用户同时最多一项。缓存命中不消耗额度；上游失败仍计入实际调用。连接测试沿用独立额度。业务额度保存在当前服务进程内，重启会重置。

## 招聘数据边界

当前岗位库只接受两类来源：

1. **企业官网的具体校招岗位详情页**；
2. **西北大学就业网的具体岗位详情页**。

数据包含腾讯、阿里巴巴、字节跳动、滴滴、美团、拼多多、网易、快手、小红书、B站、米哈游、得物、小米、OPPO、华为、vivo、影石等企业，以及部分国企和其他官方渠道。岗位记录必须有明确的岗位名称、届别、Base、岗位编号或详情路径和投递链接。

以下内容不会直接进入当前岗位库：其他高校岗位页、企业总公告、只有岗位类别没有具体职位的入口、无法确认届别的旧岗位和实习岗位。岗位状态与企业官网实时变化有关，数据目录是带日期的采集快照，不承诺永久在招。

来源规则见 [`data/job-source-policy.json`](data/job-source-policy.json)，来源说明见 [`docs/数据来源.md`](docs/数据来源.md)。

## 数据维护

岗位采集脚本需要 Python 和 `beautifulsoup4`。常用流程如下：

```powershell
# 采集候选数据，写入 data/official-portal-candidates.json（不直接改在线岗位库）
python scripts/collect-jobs.py

# 读取企业官网和西北大学公开岗位 → data/sources/<日期>-official/accepted.json
python scripts/collect-direct-jobs.py

# 扩充已审核的企业官方渠道 → data/sources/<日期>-employers|brands/accepted.json
python scripts/collect-employer-expansion.py

# 按来源规则发布；缺少 official-portal-candidates.json 时会直接失败（勿与 portal-candidates.json 探测结果混淆）
python scripts/publish-direct-jobs.py
```

只合并新增企业/品牌快照、不重跑门户候选时可以使用：

```powershell
python scripts/publish-direct-jobs.py --merge-only
```

`data/portal-candidates.json` 是 `discover-employer-portals.py` 的探测结果，不是发布候选。采集脚本生成的是证据快照，重新运行不会自动保证岗位仍然实时开放；已过 `deadline` 的岗位在发布与服务端导入时都会下架。新增企业前，应先在 `data/job-source-policy.json` 中登记官方域名和单岗位路径规则。

默认发布为增量合并。某企业已完成全部岗位的刷新时，用完整快照替换该企业的活动目录；快照中缺失的岗位会下架，个人投递历史保留：

```powershell
python scripts/publish-direct-jobs.py --merge-only --replace-company "腾讯" --snapshot "data/sources/tencent-complete.json"
```

`--snapshot` 接受符合来源规则的岗位数组；空数组表示该企业没有当前岗位。发布后会记住该企业的刷新时间，后续增量发布不会重新带入更旧的快照。分页结果和采集失败的结果不能用作完整快照。服务运行时，每个北京时间日期的首次 API 请求也会检查截止日期，无需每日重启。

可用 `node scripts/check-job-evidence.mjs --limit 20` 检查 20 条现有官方岗位的公开页面证据，结果写入被忽略的 `data/sources/<日期>-workflow/`，不自动发布。HTTP 200、跳转到列表、登录页或动态空壳页都不能证明岗位在招；网络失败也不会直接下架。

`data/job-workflow-reviews.json` 保存首批 20 个岗位的快照正文审核及公开状态检查。标注仅在岗位文本哈希完全一致时生效；它不改变原采集日期。当前 17 条正文完整、3 条待复核，20 条当前在招状态均为未知。

## 项目结构

```text
index.html / styles.css / motion.css / app.js   品牌主页
workspace/                                       工作台、岗位页、简历编辑器
shared/                                          简历媒体、模板和共享状态
server/index.mjs                                服务入口与环境配置
server/routes.mjs                               同源 HTTP API 与静态文件服务
server/db.mjs                                   SQLite 数据库、导入和事务
server/security.mjs                             会话、校验、限流和密钥加密
server/ai.mjs                                   DeepSeek / 自定义兼容接口与润色报告
server/ai-client.mjs                            受限 JSON 调用、超时、配额与取消
server/candidate-profile.mjs                    本人确认事实及来源版本
server/job-evaluation.mjs                       三态条件、服务端评分及评估快照
server/application-materials.mjs                草拟、独立复核及新简历采纳
server/application-submissions.mjs              实际投递内容快照
server/migrations/                             增量数据库迁移
data/jobs-2027.json                             已发布岗位目录
data/sources/                                   带日期的来源快照（本地证据，默认不入库）
assets/resume-templates/                        简历模板和授权说明
scripts/                                        招聘数据采集与发布脚本
storage/                                        本机运行数据，已被 Git 忽略
```

## 数据与安全

- 默认服务地址为 `127.0.0.1:4174`，不会自动暴露到公网。
- 设置 `OFFERBIU_DB` 可让服务使用另一份数据库文件（便于在副本上验证，不影响正式数据）。
- 设置 `OFFERBIU_STORAGE` 可隔离整个数据目录（包括加密文件）；`OFFERBIU_JOB_SOURCE` 可指定隔离测试用岗位 JSON。测试脚本自动使用临时目录，不操作正式资料。
- `storage/`、`.env`、日志和本地数据库不会提交到 Git；`.env.example` 只包含配置格式，不包含密钥。
- 简历图片只保存在已登录账号的简历数据中，受会话和账号归属校验保护，不会发送给 DeepSeek。
- 正式部署时应启用 HTTPS，设置 `APP_ORIGIN` 和 `COOKIE_SECURE=true`，并为数据库和密钥目录配置持久化存储与备份。
- 岗位投递发生在企业或西北大学官方页面，Offerbiu 只保存岗位链接和个人投递记录，不代替用户提交申请。

## 当前边界

- PDF 导出使用浏览器打印，不提供 Word 导出和已有 Word/PDF 自动解析。
- 日程是站内记录，不发送短信、邮件或系统通知。
- DeepSeek 功能需要用户自己的有效密钥和额度。
- 当前仓库是本地优先版本，未宣称已经完成公网部署或生产环境验收。
- 岗位匹配仅表示已确认材料的支持程度；模型草稿和复核仍须本人审核。面试准备、复盘、学习计划、通义专用适配、私人岗位导入和 Word 导出保留在后续阶段。

## 验证

运行 `node --test tests/*.test.mjs`。自动化测试使用独立 SQLite 和模拟模型响应，覆盖权限、引用、并发、迁移、失效、归档及前端状态。2026-10-23 的真实 DeepSeek、20 岗样本、浏览器及中文 PDF 结果另见验收记录。

## 相关文档

- [实施方案](docs/实施方案.md)
- [操作指南](docs/操作指南.md)
- [数据来源](docs/数据来源.md)
- [简历工作室](docs/简历工作室.md)
- [UI 动效说明](docs/UI动效说明.md)
- [模板授权与来源](assets/resume-templates/NOTICE.md)
- [新增开源简历模板与验收](docs/新增开源简历模板.md)
- [AI 求职工作流开发文档](docs/AI求职工作流融合开发文档.md)
- [AI 求职工作流验收记录](docs/AI求职工作流融合验收记录.md)
- [第三方参考说明](docs/第三方参考说明.md)

## 致谢

简历模板适配参考了 [ResumeCollection](https://github.com/mmmlllnnn/ResumeCollection) 公开仓库。各模板的原始许可证、来源和适配范围记录在 `assets/resume-templates/` 对应目录及 NOTICE 文件中。
