---
name: alice-experts
description: 调用万得 Alice Agent 6 大垂直领域专家（经济研究专家、个股研究专家、行业研究专家、市场监测专家、会议专家、财富管理顾问）的统一 CLI 工具。当用户提出需要深度的宏观经济分析、个股深度研判与中报/年报前瞻、行业景气度与产业链利润池分析、行情异动与公司公告监控预警、业绩会/路演会议全流程协助、财富管理客户诊断与资产配置方案时使用。
---

# alice-experts

> 一个统一 CLI：集中维护万得 Alice 平台的 **6 大专业领域专家**（经济研究、个股研究、行业研究、市场监测、会议、财富管理顾问）。
> 支持显式指定专家（`--expert`，支持中文名、英文名、专家 ID 或口语短别名），也支持根据提问内容做智能自动识别路由。

---

## 核心机制与协议规范

与常规 Alice 技能（Skills 通过 `使用「...」技能：` 文本前缀触发）不同，Alice 领域专家在 A2A 协议层面具有专有规范：

1. **原话原样透传（`features.promptPrefix = false`）**：
   - 专家的输入请求**严禁拼接**任何「使用「...」技能：」前缀；
   - 用户的原话提问原汁原味作为 `parts[0].text` 发送给服务端，确保专家 Agent 完整理解用户的自然语言上下文与投研诉求。
2. **专属子 Agent 路由（`activeSubAgent`）**：
   - 在 `parts[1].data` 中显式指定 `activeSubAgent: expert.activeSubAgent`（如 `"economic-research"`, `"equity-deep-research-agent"`, `"industry-research"`, `"market-monitoring"`, `"meeting"`, `"advisor"`）；
   - 服务端根据该字段直接唤醒对应的专属专家 Agent 执行。
3. **一个包集中维护**：
   - 6 个专家集中在单一 `alice-experts` 技能包内维护，无需为每个专家单独维护独立的安装包或 CLI，降低环境管理负担。
4. **智能路由兜底**：
   - 用户若未传入 `--expert` 参数，CLI 会提取问句关键词自动匹配最吻合的专家；若问句不属于特定专家，则以 auto 模式透传，由 Alice 服务端自主研判调度。

---

## 6 大专家清单与能力矩阵

| 序号 | 专家名称（`nameZh`） | 专家 ID（`activeSubAgent`） | 内置短别名（`alias`） | 英文名称（`nameEn`） | 核心职责与专业能力定位 | 典型示例提问 |
|:---:|---|---|---|---|---|---|
| 1 | **经济研究专家** | `economic-research` | `aecr` | Economic Research Expert | 面向宏观经济与行业研究，围绕数据变化、政策信号与财经事件，梳理区域差异、关键驱动、传导路径与周期位置。识别预期差与共识变化，输出证据可追溯的研究报告、PPT或看板。 | 帮我整理美国本周公布的主要经济数据和下周的公布日程 |
| 2 | **个股研究专家** | `equity-deep-research-agent` | `aere` | Equity Research Expert | 面向二级市场的个股研究搭档，围绕公司基本面、财报与事件、估值位置及可证伪投资逻辑，形成有证据、有反方观点、可持续跟踪的研究判断，交付带真实数据图表与来源的报告。 | 做一份英伟达（NVDA.O）的中报前瞻 |
| 3 | **行业研究专家** | `industry-research` | `aeir` | Industry Research Expert | 面向股票投研团队的行业研究搭档，围绕行业、子行业、产业链环节、投资主题和突发事件，形成可验证的景气度判断、利润迁移、公司映射、风险校验与投委会级研究材料。 | 从零研究低空经济行业并形成景气判断 |
| 4 | **市场监测专家** | `market-monitoring` | `amme` | Market Monitoring Expert | 面向金融市场与经济数据场景的智能监控预警专家，实时跟踪行情异动、债券估值偏离、公司公告、重大事件及宏观数据，提炼关键信息并分析潜在影响，及时发现风险与投资机会。 | 帮我设置贵州茅台跌破20日均线提醒，并在触发后对该股进行市场调研与趋势评估分析 |
| 5 | **会议专家** | `meeting` | `ame` | Meeting Expert | 全程协助处理一场会议从会前到会后的关键工作（包括路演、业绩会、调研拜访等），覆盖会前准备、AI参会纪要与会后复盘总结。 | 未来一周有哪些上市公司业绩会召开？ |
| 6 | **财富管理顾问** | `advisor` | `awa` | Wealth Management Advisor | 面向投资顾问和理财师的财富管理助手，覆盖客户洞察、产品筛选、持仓诊断、资产配置、调仓再平衡、定投分析、保险保障与客户经营，交付合规分析与配置方案。 | 帮我创建一个客户，持仓包含国金量化多因子A |

---

## 调用方式与 CLI 参数

### 命令语法

与 `wind-alice` 一致，Agent 在执行前先定位本 skill 目录（即 `SKILL.md` 所在目录），使用 Node.js 直接执行脚本入口：

```bash
node scripts/alice-experts.mjs --prompt "<QUESTION>" [--expert "<EXPERT_NAME>"] [--context-id "<CONTEXT_ID>"]
```

> **其他快捷调用方式**：
> - Windows PowerShell 终端支持执行脚本简写：`./scripts/ae.ps1 -p "<QUESTION>" [-e "<EXPERT_NAME>"]`
> - 若环境已通过 npm / bin 配置了全局命令，可直接运行 `alice-experts --prompt ...`。

### 参数说明

- `--prompt, -p <QUESTION>`（必填）：用户原始问题。**严禁改写或摘要用户问句**，原样传入即可。必须提供有效问题内容，严禁将选项参数粘连传递。
- `--expert, -e <EXPERT_NAME>`（可选）：指定调用的专家，支持多种命名风格：
  - 中文名：`经济研究专家`、`个股研究专家`、`行业研究专家`、`市场监测专家`、`会议专家`、`财富管理顾问`
  - 专家 ID：`economic-research`、`equity-deep-research-agent`、`industry-research`、`market-monitoring`、`meeting`、`advisor`
  - 短别名：`aecr`、`aere`、`aeir`、`amme`、`ame`、`awa`
  - 口语名称：`宏观专家`、`个股深研`、`行研`、`异动预警`、`业绩会助手`、`理财顾问`、`财富管理专家` 等
  - 英文名：`Economic Research Expert`、`Equity Research Expert` 等（忽略大小写与中划线模糊匹配）
  - **严格校验机制**：若用户指定了 `--expert` 但名称无法匹配到任何已知专家，CLI 会**严格拦截报错并立即退出**（退出码 2），坚决不发真实网络请求，防止在通用模式下白白浪费用户账户积分。
  - **若不指定 `--expert`**：CLI 会结合提问关键词自动智能识别匹配对应专家；若问句无明显垂直特征，则以通用 auto 模式调度。
- `--context-id, -c <CONTEXT_ID>`（可选）：会话上下文 ID。用于多轮对话或承接专家的澄清追问（详见下方 [澄清问题与多轮调用指引](#澄清问题与多轮调用指引)）。
- `--list-experts` / `list-experts`：列出全部 6 个专家的能力明细、支持的别名与示例提问。
- `--help, -h`：查看帮助文档。

---

## 澄清问题与多轮调用指引

专家 Agent 具备专业的投研审慎性，当提问存在信息缺失或时效歧义时，会在首轮主动向用户抛出**澄清追问**（例如：“NVDA中报已发布，请问您是要做Q3前瞻还是Q2回顾？”或“创建客户请提供客户姓名、金额与买入日期”）：

1. **避免触发澄清追问的最佳实践（推荐）**：
   - 宿主 Agent 组织问题时，尽量在 `--prompt` 中提供完整、确定的投研要素。
   - 例：`做一份英伟达（NVDA.O）最新的Q3业绩前瞻`（明确指定Q3前瞻而非模糊的中报）；
   - 例：`帮我创建客户【张三】，持仓包含10万元国金量化多因子A，买入日期2026-01-01`（一次性给齐建档要素）。
2. **多轮澄清追问承接**：
   - CLI 在每次发起请求时均会在控制台输出 `[info] 会话上下文 (contextId): <ID>`；
   - 若专家的首轮输出为追问提问，宿主 Agent 获取用户的补充答复后，可通过 `--context-id` 将答复注入同一会话：
     ```bash
     node scripts/alice-experts.mjs -p "确认要做Q3业绩前瞻" --context-id "<上轮输出的contextId>"
     ```

---

## Agent 使用工作流

1. **识别用户诉求与专家类型**：
   - 经济/政策/宏观数据/加息降息/美联储 → `经济研究专家` (`economic-research` / `aecr`)
   - 单只股票/基本面/财报深研/估值/多空分歧 → `个股研究专家` (`equity-deep-research-agent` / `aere`)
   - 产业链/景气度/子行业/利润池/低空经济等主题 → `行业研究专家` (`industry-research` / `aeir`)
   - 异动盯盘/均线突破/公告异动/重大事件监控 → `市场监测专家` (`market-monitoring` / `amme` / `异动预警`)
   - 业绩会/路演/调研访谈/会议纪要 → `会议专家` (`meeting` / `ame`)
   - 客户画像/基金持仓诊断/调仓建议/资产配置 → `财富管理顾问` (`advisor` / `awa` / `财富管理专家`)
2. **提示用户等待**：
   - 专家级分析是深度研报级别输出，包含数据提取、多维度推理与图表生成，耗时通常在 **2-5 分钟**；
   - 提示用户耐心等待，不要重复发起或中断进程。
3. **定位并执行 CLI**：
   - 优先通过 `--prompt` 传入原话，并通过 `-e` 指定专家。

### 示例命令

```bash
# 1. 经济研究
node scripts/alice-experts.mjs -p "帮我整理美国本周公布的主要经济数据和下周的公布日程" -e "经济研究专家"

# 2. 个股深度研究（提供明确期间）
node scripts/alice-experts.mjs -p "做一份英伟达（NVDA.O）最新的Q3业绩前瞻" -e "个股研究专家"

# 3. 行业研究与景气度
node scripts/alice-experts.mjs -p "从零研究低空经济行业并形成景气判断" -e "industry-research"

# 4. 市场异动与监控
node scripts/alice-experts.mjs -p "帮我设置贵州茅台跌破20日均线提醒，并在触发后对该股进行市场调研与趋势评估分析" -e "市场监测专家"

# 5. 会议与路演
node scripts/alice-experts.mjs -p "未来一周有哪些上市公司业绩会召开？" -e "会议专家"

# 6. 财富管理顾问（提供明确客户与持仓信息）
node scripts/alice-experts.mjs -p "帮我创建客户【张三】，持仓包含10万元国金量化多因子A" -e "财富管理顾问"

# 7. 智能自动路由（省略 -e，根据关键词自动分发）
node scripts/alice-experts.mjs -p "未来一周有哪些上市公司业绩会召开？"
```

---

## 鉴权与配置规范（Market 规范）

CLI 遵循 Market 标准的 Key 检索链（按优先级读取，无需重复检查）：

1. 全局配置（推荐）：`%USERPROFILE%\.wind-aifinmarket\config.env` 或 `config`（`WIND_API_KEY=<KEY>`）
2. 技能局部配置：`src/alice-experts/config.json`（`{"wind_api_key":"<KEY>"}`）
3. 临时环境变量：终端 `$env:WIND_API_KEY="<KEY>"`

### 充值与限额处理

- **Key 管理入口**：[Wind AIFinMarket 用户中心](https://market.windalice.com/#/user/overview)
- **积分充值入口**：[Wind AIFinMarket 积分充值](https://market.windalice.com/#/user/credits)
- 当服务端返回「积分不足」「账户积分余额不足」或「体验期任务限额」时：
  - CLI 会将退出码置为 **75**（受阻类拒绝，退出码 `EXIT_SERVER_BLOCKED = 75`）；
  - 宿主 Agent 识别后应立即向用户呈现充值链接，**严禁做无意义的原样重试**。

### 文件附件自动下载

当专家生成包含 Excel 模型、图表、Markdown 附件或 PPT 报告时：
- CLI 会自动解析服务端的 `A2A.PresentFiles` 清单以及正文链接；
- 携带用户的 Bearer Token 鉴权自动下载至本地 `%USERPROFILE%\.agents\download\` 目录；
- 输出本地绝对路径与可在 Markdown 中直接预览的超链接。
