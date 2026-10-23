# 模板来源与改编说明

本目录保存七套 MIT 开源主题的原始许可和来源快照，以及 `collection/` 下五套 ResumeCollection 素材。工作台使用中文 A4 适配版，并非未经修改的上游模板运行器。加上三套原创模板，共十五套。实际排版实现见 workspace/resume.css 与 workspace/resume-renderer.js。

- Even — Rafael Bardini — https://github.com/rbardini/jsonresume-theme-even
- Class — James Spencer / JSON Resume Contributors — https://github.com/jsonresume/jsonresume-theme-class
- Classy — Jared Cubilla — https://github.com/JaredCubilla/jsonresume-theme-classy
- Bill Ryan 中文分支 — Bill Ryan — https://github.com/billryan/resume/tree/zh_CN
- Stack Overflow — Francesco Esposito — https://github.com/phoinixi/jsonresume-theme-stackoverflow
- Kendall — M. Adam Kendall — https://github.com/LinuxBozo/jsonresume-theme-kendall
- Macchiato — Alessandro Biondi — https://github.com/biosan/jsonresume-theme-macchiato

保留并改编了各主题的抬头、章节层级、色彩及网格布局。已移除上游远程字体、图标和脚本依赖，使用本机中文字体与本项目结构化数据。原始文件仅留作出处，不在编辑页面执行。完整许可分别见各目录 LICENSE。来源树 SHA 与文件哈希见 sources.json。

2026-10-23 新增的四套模板均固定到来源提交；Bill Ryan 使用 `zh_CN` 分支，不复制仓库内另有授权的字体，也不把示例 TeX 的个人资料写入草稿。Stack Overflow 不依赖 Svelte 运行时；Kendall 不依赖 Bootstrap；Macchiato 不依赖 Font Awesome。Macchiato README 中的 Caffeine / JSON Resume Boilerplate 来源说明保留在原始快照中。

新增适配版的 MIT 许可与署名也随本地 `resume.css` 注释进入独立 HTML 导出。截图、字体和其他上游媒体未作为本轮模板资源引入。ResumeCollection 的独立素材记录仍见 `collection/NOTICE.md` 与 `collection/sources.json`。
