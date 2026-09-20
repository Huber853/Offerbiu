# Offerbiu

Offerbiu 是一个面向 2027 届秋招的个人求职工作台。它把官方岗位检索、投递跟踪、在线简历编辑、日程管理和 AI 简历润色放在同一个本地优先的 Web 应用中。

项目沿用 Offerbiu 的蓝白 Hero 和卡通人物视觉：主页负责品牌展示，工作台负责实际求职操作。默认只监听本机地址，适合个人使用、演示和继续开发。

## 功能概览

- **岗位库**：收录约 6,373 条具体岗位，覆盖约 40 家企业/集团；支持公司、行业、岗位方向、Base、来源和关键词筛选。
- **官方直达**：每条岗位保留企业官网或西北大学就业网的具体岗位详情链接，可直接进入投递页面。
- **投递管理**：收藏岗位，记录投递状态、跟进时间、备注和所使用的简历版本。
- **简历工作室**：在浏览器沙箱中选择模板、编辑纸面内容、调整字号/颜色/行距/模块顺序，并支持撤销、重做和版本恢复。
- **简历模板**：内置 11 套模板，其中 5 套为基于 [ResumeCollection](https://github.com/mmmlllnnn/ResumeCollection) 公开素材制作的可编辑适配版。
- **图片功能**：支持头像和最多 3 张作品图，可更换、排序、裁切显示，并随简历版本保存。
- **导出**：导出 JSON、独立 HTML，或通过浏览器打印为 PDF。
- **日程与待办**：管理笔试、面试、截止日期和投递跟进事项。
- **DeepSeek 润色**：选择简历段落和目标岗位后生成润色建议，支持前后对比、手动采纳和历史记录。
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
# 采集候选数据，不直接改动在线岗位库
python scripts/collect-jobs.py

# 读取企业官网和西北大学公开岗位
python scripts/collect-direct-jobs.py

# 扩充已审核的企业官方渠道
python scripts/collect-employer-expansion.py

# 发布前核对单岗位链接、届别、Base 和来源规则
python scripts/publish-direct-jobs.py
```

只合并新增企业快照时可以使用：

```powershell
python scripts/publish-direct-jobs.py --merge-only
```

采集脚本生成的是证据快照，重新运行不会自动保证岗位仍然实时开放。新增企业前，应先在 `data/job-source-policy.json` 中登记官方域名和单岗位路径规则。

## 项目结构

```text
index.html / styles.css / motion.css / app.js   品牌主页
workspace/                                       工作台、岗位页、简历编辑器
shared/                                          简历媒体、模板和共享状态
server/index.mjs                                服务入口与环境配置
server/routes.mjs                               同源 HTTP API 与静态文件服务
server/db.mjs                                   SQLite 数据库、导入和事务
server/security.mjs                             会话、校验、限流和密钥加密
server/deepseek.mjs                             DeepSeek API 调用与润色报告
data/jobs-2027.json                             已发布岗位目录
data/sources/                                   带日期的来源快照
assets/resume-templates/                        简历模板和授权说明
scripts/                                        招聘数据采集与发布脚本
storage/                                        本机运行数据，已被 Git 忽略
```

## 数据与安全

- 默认服务地址为 `127.0.0.1:4174`，不会自动暴露到公网。
- `storage/`、`.env`、日志和本地数据库不会提交到 Git；`.env.example` 只包含配置格式，不包含密钥。
- 简历图片只保存在已登录账号的简历数据中，受会话和账号归属校验保护，不会发送给 DeepSeek。
- 正式部署时应启用 HTTPS，设置 `APP_ORIGIN` 和 `COOKIE_SECURE=true`，并为数据库和密钥目录配置持久化存储与备份。
- 岗位投递发生在企业或西北大学官方页面，Offerbiu 只保存岗位链接和个人投递记录，不代替用户提交申请。

## 当前边界

- PDF 导出使用浏览器打印，不提供 Word 导出和已有 Word/PDF 自动解析。
- 日程是站内记录，不发送短信、邮件或系统通知。
- DeepSeek 功能需要用户自己的有效密钥和额度。
- 当前仓库是本地优先版本，未宣称已经完成公网部署或生产环境验收。

## 相关文档

- [实施方案](docs/实施方案.md)
- [操作指南](docs/操作指南.md)
- [数据来源](docs/数据来源.md)
- [简历工作室](docs/简历工作室.md)
- [UI 动效说明](docs/UI动效说明.md)
- [模板授权与来源](assets/resume-templates/NOTICE.md)

## 致谢

简历模板适配参考了 [ResumeCollection](https://github.com/mmmlllnnn/ResumeCollection) 公开仓库。各模板的原始许可证、来源和适配范围记录在 `assets/resume-templates/` 对应目录及 NOTICE 文件中。
