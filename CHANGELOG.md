# Changelog

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。
`npm run release` 会收集自上个 tag 以来的 conventional commits 生成
对应版本的更新说明。

## [Unreleased]

## [1.1.0] - 2026-09-27

用户调研驱动的功能批（P0×4 + P1×2 + 索引扩展）：

### 新增

- **条目树「期刊指标」列**：文库列表内联显示 IF / JCR 分区 / 中科院分区 /
  顶刊 / 预警 / 掠夺性徽章（离线数据刊名匹配，免 key 零网络）
- **引文钻取**：结果卡被引计数可点（施引文献），新增「参考文献」入口；
  OpenAlex 双向钻取，子列表内可直接导入
- **导入自动挂 OA PDF**：卡片直链提示优先，OpenAlex `best_oa_location`
  兜底；失败静默降级纯元数据，设置可关
- **「已在库」标记**：DOI 与本地文库比对，防重复导入（批量导入同样生效）
- **OA 筛选**：只看开放获取（宿主侧过滤，上限作用于过滤后集合）
- **工具栏放大镜按钮 + Ctrl/Cmd+Shift+K 快捷键**（按钮设置可隐藏，切换即时生效）
- **中文核心期刊徽章**（北大核心/CSCD/CSSCI/科技核心）：填入免费
  easyScholar API key 后启用；防御式解析，未配置零请求
- **库内索引纳入 PDF 注释**：高亮文本与批注可被语义检索命中（对齐
  All Search 覆盖面）

### 修复与工程

- 插件沙箱实测记录：无 `Cc/Services` 全局（XPCOM 走 `Components.classes`）；
  运行时动态 `import()` 解析出第二模块实例（api 必须静态引用）；插件 pref
  真实地址在 `extensions.zotero.zsearch.*` 分支下
- 实机套件 28 用例（新增工具栏注册/显隐、easyScholar 解析 5 用例等）；
  OpenAlex 每日配额 429 时 discover 视觉用例为已知环境红（注释在案）

## [0.1.0] - 2026-09-24

首个内部版本：学术搜索 / 网络搜索 / 仓库搜索 / 向量搜索四合一 Zotero 插件。

[unreleased]: https://github.com/Liozhang/z-search/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Liozhang/z-search/releases/tag/v1.1.0
[0.1.0]: https://github.com/z-search/z-search/releases/tag/v0.1.0
