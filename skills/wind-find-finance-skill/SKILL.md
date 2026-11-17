---
name: wind-find-finance-skill
description: 万得金融能力发现与安装。用户问有哪些金融能力、某类分析该用哪个 skill，或要做估值/DCF、个股研究、财报与公告解读、市场主线、选股、复盘、仓位、交易计划、回测等分析而本地没有合适的 skill 时使用：从万得 skill 清单里推荐，用户同意后安装。只查数据（行情、财务、基金、宏观、公告新闻等）直接用 wind-mcp-skill。
---

# 万得金融能力发现

## 核心能力

从万得 skill 清单里为用户的问题找到合适的 skill，没装的帮用户装上，再交给它处理。本 skill 不取数、不做分析，不需要 API Key。

## 第 1 步：检查更新

在本 SKILL.md 所在目录运行（需要 Node.js 18+）：

```bash
node scripts/update-check.mjs
```

脚本在后台检查本 skill 和清单有没有新版本，不输出内容，直接进行下一步。

## 第 2 步：从清单里选 skill

读 `references/skills-catalog.md`，按用户的问题选 1–3 个最匹配的 skill：

- 分析、决策类问题从「工作流类」里选；只查数据用「数据类」的 wind-mcp-skill。
- 用户点名人物（如芒格、巴菲特）或思维框架时，从「Avatar 思维框架索引」里选。
- 用户点名「Alice 子 Skill 索引」里的能力时用 wind-alice，并把子 Skill 名传给它；子 Skill 名不是可安装的 skill。
- 需要经济、个股、行业、市场监测、会议或财富管理方面的专家多轮深入分析时用 alice-experts。
- 用户问有哪些能力时，按清单里的分类各介绍一两个代表 skill。

## 第 3 步：交给 skill 处理

选中的 skill 已经装好（在当前可用的 skill 里，或 `.agents/skills/<name>/SKILL.md`、`~/.agents/skills/<name>/SKILL.md` 存在）时，按它的说明处理用户的问题。

没装时，告诉用户推荐哪个 skill、能做什么、装好后要不要配置 API Key，问用户装不装。用户同意后全局安装，`<name>` 换成清单里的名称：

```bash
# GitHub
npx skills add Wind-Alice/AliceMarket --skill <name> -g -y
# Gitee 镜像（GitHub 连不上时）
npx skills add https://gitee.com/WindAlice/AliceMarket.git --skill <name> -g -y
```

- `-g`：全局安装，所有项目和本机已识别的 agent（Claude Code、Cursor、OpenClaw、Hermes 等）都能用。
- `-y`：跳过交互菜单，必须带，不带会卡住。
- 用户要求只装到当前项目时，去掉 `-g`，在项目根目录运行。

装好后读新 skill 的 SKILL.md，按它的说明继续；需要 API Key 的按它的说明配置。客户端要重新加载才能识别新 skill 时，再告诉用户。

用户不装时，用已有的 skill 继续回答（如用 wind-mcp-skill 取数），并说明没有用到专门的 skill。

## 升级

用户要升级万得 skill 时运行，`<name>` 换成要升级的 skill，可以写多个：

```bash
npx skills update <name> -g -y
```

不写 skill 名会升级全局装的所有 skill，包括非万得的，只在用户要求全部升级时这样用。

## 注意事项

- **运行目录**：更新脚本在本 SKILL.md 所在目录运行。
- **清单**：`references/skills-catalog.md` 随本 skill 一起更新，推荐以清单为准。
