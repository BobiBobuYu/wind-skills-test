# wind-find-finance-skill

> 万得金融能力发现与安装：从 skill 清单里为用户的问题推荐合适的 skill，用户同意后安装。

---

## 这是什么

不是数据 skill，是**能力发现 skill**：

- 用户问「有哪些金融能力」、某类分析该用哪个 skill，或要做估值、复盘、选股等分析而本地没有合适的 skill 时触发
- 读 `references/skills-catalog.md`，选出 1–3 个最匹配的 skill
- 已装的直接交给它处理；没装的问用户，同意后安装
- 只查数据（行情、财务、基金、宏观、公告新闻等）直接用 `wind-mcp-skill`，不经过本 skill

---

## 安装

```bash
# 全局（推荐 — 跨项目 + 跨 AI agent 共享）
# GitHub
npx skills add Wind-Alice/AliceMarket --skill wind-find-finance-skill -g -y
# Gitee 镜像（国内）
npx skills add https://gitee.com/WindAlice/AliceMarket.git --skill wind-find-finance-skill -g -y
```

> 想限制在当前项目内用，把命令的 `-g` 去掉即可。`-g` 会自动 symlink 到机器上所有已识别的 AI agent（Claude Code / Cursor / OpenClaw / Hermes 等）。

**不需要 API Key** —— 本 skill 不调任何服务，只读清单。

---

## 目录结构

```
wind-find-finance-skill/
├── SKILL.md                         # 发现流程（检查更新 → 选 skill → 交给 skill / 安装）
├── references/
│   └── skills-catalog.md            # 万得 skill 清单
├── scripts/
│   └── update-check.mjs             # 后台检查更新
└── README.md
```

---

## 工作流程

1. 运行 `node scripts/update-check.mjs`：后台检查本 skill 和清单有没有新版本，不输出内容
2. 读 `references/skills-catalog.md`，按问题选 1–3 个 skill
3. 已装的交给它处理；没装的问用户装不装、装到当前项目还是所有 agent，同意后安装；用户不装时用已有的 skill 继续回答

---

## 升级

```bash
# 全局安装的
npx skills update wind-find-finance-skill -g -y

# 装在当前项目的(不带 -g)
npx skills update wind-find-finance-skill -y
```

`references/skills-catalog.md` 随 skill 包一起更新。`scripts/update-check.mjs` 只写本 skill 的 `scripts/update-state.json` 和临时锁文件。
