# Wind Alice 未上架技能详情（19 个）

> 本文收录 **已在 Wind Alice CLI 中可用、但尚未上架 Alice Market（https://aifinmarket.wind.com.cn，分类"万得官方"）** 的 19 个技能。
> 上架的 14 个技能见 [alice-cli-skill-catalog.md](alice-cli-skill-catalog.md)。
> 信息来源：CLI 技能包的 `skill.config.json` 与 `SKILL.md` frontmatter（见 [Alice-CLI-技能与专家清单.md](../skills/Alice-CLI-技能与专家清单.md)）。每个技能给出 CLI 元信息、简介、核心能力、示例问法与调用命令。

**调用方式**（在 `skills/wind-alice` 目录下执行，耗时通常 2-15 分钟，深度研究 / PPT 为 15-30 分钟）：

```bash
node scripts/wind-alice.mjs --prompt "<示例问法>" --skill "<技能中文名>"
```

**19 个技能总览**

| 方向 | 技能 | English | slug | 别名 | 版本 |
|------|------|---------|------|------|------|
| 权益 | 券商金股追踪 | Broker Top Picks Tracker | `alice-broker-top-picks-tracker` | `abtpt` | 1.0.8 |
| 权益 | 机构持仓透视 | Institutional Holdings Insight | `alice-institutional-holdings-insight` | `aihi` | 1.0.2 |
| 权益 | A股短线策略报告 | A-Share Short-Term Strategy Report | `alice-a-share-short-term-strategy-report` | `aassr` | 1.0.8 |
| 基金 | 基金涨跌解读 | Fund Performance Attribution Assistant | `alice-fund-performance-attribution` | `afpa` | 1.0.2 |
| 宏观配置 | 资产配置-行业轮动策略 | Asset Allocation - Sector Rotation Strategy | `alice-asset-allocation-sector-rotation-strategy` | `asrs` | 1.0.5 |
| 宏观配置 | 资产配置-战略基准组合 | Asset Allocation - Strategic Baseline Portfolio | `alice-asset-allocation-strategic-baseline-portfolio` | `aasbp` | 1.0.5 |
| 商品期货 | 商品智研助手 | Commodity Research Assistant | `alice-commodity-research-assistant` | `acra` | 1.0.8 |
| 商品期货 | AI商品策略师 | AI Commodity Strategist | `alice-ai-commodity-strategist` | `aacs` | 1.0.2 |
| 商品期货 | 期货研报观点 | Futures Research Opinion | `alice-futures-research-opinion` | `afro` | 1.0.10 |
| 商品期货 | 期货资金流向监测 | Futures Fund Flow Monitor | `alice-futures-fund-flow-monitor` | `affm` | 1.0.2 |
| 商品期货 | 期货主力行为分析 | Futures Leading Institution Analysis | `alice-futures-leading-institution-analysis` | `aflia` | 1.0.2 |
| 商品期货 | 期货盘中异动归因 | Intraday Futures Move Attribution | `alice-intraday-futures-move-attribution` | `aifma` | 1.0.2 |
| 期权衍生品 | 期权波动率洞察 | Option Volatility Insights | `alice-option-volatility-insights` | `aovi` | 1.0.2 |
| 期权衍生品 | 期权交易策略 | Options Trading Strategies | `alice-options-trading-strategies` | `aots` | 1.0.5 |
| 期权衍生品 | 期权定价计算器 | Option Pricing Calculator | `alice-option-pricing-calculator` | `aopc` | 1.0.2 |
| 监管政策 | 证券业监管政策简报 | Securities Regulatory Policy Briefing | `alice-securities-regulatory-policy-briefing` | `srpb` | 1.0.5 |
| 监管政策 | 金融监管局处罚月报 | NFRA Monthly Enforcement Report | `alice-nfra-monthly-enforcement-report` | `nmre` | 1.0.5 |
| 通用研究 | 深度研究 | Deep Research | `alice-deep-research` | `adr` | 1.0.6 |
| 通用研究 | 幻灯片 | PPT Generator | `alice-ppt-generator` | `apg` | 1.0.5 |

---

# 权益 · 个股研究

## 1. Broker Top Picks Tracker（券商金股追踪）

- **slug**：`alice-broker-top-picks-tracker`　**别名**：`abtpt`　**版本**：1.0.8　**事件前缀**：`ALICE_BROKER_TOP_PICKS_TRACKER`

**技能简介**

汇总各大券商的月度金股推荐，按推荐频次与热度打分排名，摘要每只金股的推荐理由，并给出行业分布拆解与趋势图表。适合月度策略会、行业轮动分析和前置选股筛查。

**核心能力**

1. **多券商推荐汇总** — 聚合各大券商月度金股名单，形成当月全市场金股池
2. **热度排名** — 按推荐频次与热度评分对金股排序，快速识别机构共识标的
3. **推荐理由摘要** — 提炼每只金股的核心投资逻辑，便于快速研判
4. **行业分布与趋势** — 输出行业分布拆解与近月变化趋势图表，观察机构偏好迁移

**适用问题示例**

- "2026年5月有哪些券商金股？"
- "医药生物有没有短线机会？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "2026年5月有哪些券商金股？" --skill "券商金股追踪"
```

**输出形式**：金股排行榜 + 推荐理由摘要 + 行业分布拆解与趋势图表

---

## 2. Institutional Holdings Insight（机构持仓透视）

- **slug**：`alice-institutional-holdings-insight`　**别名**：`aihi`　**版本**：1.0.2　**事件前缀**：`ALICE_INSTITUTIONAL_HOLDINGS_INSIGHT`

**技能简介**

看清全球顶级投资机构究竟买了什么、卖了什么。输入机构或基金名称，即得一页纸持仓简报：完整的新建仓与清仓名单、按估算交易金额排序的最大买入与卖出、板块间资金流向，以及重仓股、环比历史与图表。对持股数量、组合权重、市值变化逐项分析。数据来源覆盖美股 13F、中国基金定期报告与香港披露。

**核心能力**

1. **新建仓 / 清仓名单** — 完整列出本期新进与退出的标的
2. **增减持排序** — 按估算交易金额对最大买入与卖出排序
3. **板块资金流向** — 识别资金在板块之间的迁移方向
4. **重仓与调仓轨迹** — 重仓股名单、环比历史与图表呈现
5. **持仓变动精细拆解** — 逐项分析持股数量、组合权重与市值的变化

**适用问题示例**

- "桥水基金最新的 13F 持仓有什么变化？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "桥水基金最新的 13F 持仓有什么变化？" --skill "机构持仓透视"
```

**输出形式**：一页纸持仓简报（名单 + 排序 + 板块流向 + 图表）

---

## 3. A-Share Short-Term Strategy Report（A股短线策略报告）

- **slug**：`alice-a-share-short-term-strategy-report`　**别名**：`aassr`　**版本**：1.0.8　**事件前缀**：`ALICE_A_SHARE_SHORT_TERM_STRATEGY_REPORT`

**技能简介**

面向短线交易者的收盘复盘工具。每日收盘后自动拉取 Wind 涨停股、指数行情与板块表现，映射热点概念群，结合券商研报识别资金主线，输出含收盘综述、涨停板复盘与主线研判的结构化报告。

**核心能力**

1. **收盘数据自动拉取** — 涨停股、指数收盘、板块涨跌一次性取齐
2. **热点概念群梳理** — 映射当日热点概念集群
3. **资金主线识别** — 结合券商研报判断资金轮动方向
4. **收盘综述与涨停复盘** — 指数表现、成交额、板块拆解
5. **前瞻板块展望** — 给出后续板块研判

**适用问题示例**

- "生成今日 A 股短线策略报告"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "生成今日 A 股短线策略报告" --skill "A股短线策略报告"
```

**输出形式**：结构化收盘复盘报告（收盘综述 + 涨停板复盘 + AI 主线研判 + 板块展望）

---

# 基金

## 4. Fund Performance Attribution Assistant（基金涨跌解读）

- **slug**：`alice-fund-performance-attribution`　**别名**：`afpa`　**版本**：1.0.2　**事件前缀**：`ALICE_FUND_PERFORMANCE_ATTRIBUTION`

**技能简介**

帮投资者搞清楚一只基金或 ETF 在某段时间里为什么涨、为什么跌。把区间业绩拆解为重仓股贡献、行业影响、新闻事件、资金流向、基本面与宏观因素，并用图表呈现归因结果。**仅用于解释与观察，不提供交易建议，也不承诺收益。**

**核心能力**

1. **区间业绩拆解** — 按选定时间段拆解基金/ETF 涨跌
2. **持仓贡献归因** — 定位主要重仓股的贡献与拖累
3. **行业与事件影响** — 行业层面影响与新闻事件驱动
4. **资金流与基本面** — 申赎资金流向、基本面变化
5. **宏观因素** — 宏观环境对区间表现的影响
6. **可视化归因** — 图表呈现归因结果

**适用问题示例**

- "帮我分析一下易方达蓝筹精选最近一个月为什么跌了？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "帮我分析一下易方达蓝筹精选最近一个月为什么跌了？" --skill "基金涨跌解读"
```

**输出形式**：归因分析报告 + 可视化归因图表

---

# 宏观 · 资产配置

## 5. Asset Allocation - Sector Rotation Strategy（资产配置-行业轮动策略）

- **slug**：`alice-asset-allocation-sector-rotation-strategy`　**别名**：`asrs`　**版本**：1.0.5　**事件前缀**：`ALICE_ASSET_ALLOCATION_SECTOR_ROTATION_STRATEGY`

**技能简介**

用于研判未来 1-6 个月的行业轮动与行业层面权重倾斜。结合动量、资金面、估值与景气度四类因子，输出超配 / 中性 / 低配清单、行业评分、约束检查与可选的行业目标权重，**在保持权益总仓位不变的前提下**做结构调整。

**核心能力**

1. **四因子行业打分** — 动量、资金面、估值、景气度
2. **超配/中性/低配清单** — 给出明确的行业倾斜方向
3. **约束检查** — 校验配置方案是否满足约束条件
4. **行业目标权重** — 可选输出具体目标权重
5. **总仓位中性** — 只调结构，不改变权益总敞口

**适用问题示例**

- "未来3个月哪些行业值得超配"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "未来3个月哪些行业值得超配" --skill "资产配置-行业轮动策略"
```

**输出形式**：超配/中性/低配清单 + 行业评分 + 约束检查结果 + 可选行业目标权重

---

## 6. Asset Allocation - Strategic Baseline Portfolio（资产配置-战略基准组合）

- **slug**：`alice-asset-allocation-strategic-baseline-portfolio`　**别名**：`aasbp`　**版本**：1.0.5　**事件前缀**：`ALICE_ASSET_ALLOCATION_STRATEGIC_BASELINE_PORTFOLIO`

**技能简介**

从风险偏好、投资期限、投资约束与长期市场数据出发，构建 3-5 年期的战略资产配置基准组合，输出大类资产权重、区域目标、指数映射与预期风险收益，可作为后续行业轮动、战术配置、组合构建与再平衡的基准。

**核心能力**

1. **输入条件建模** — 风险偏好、投资期限、投资约束、长期市场数据
2. **大类资产权重** — 给出 3-5 年战略权重
3. **区域目标与指数映射** — 区域配置目标及对应指数
4. **预期风险收益** — 测算组合预期收益与风险
5. **下游衔接** — 作为行业轮动、战术配置、组合构建与再平衡的基准

**适用问题示例**

- "为养老金设计一个3-5年战略资产配置方案"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "为养老金设计一个3-5年战略资产配置方案" --skill "资产配置-战略基准组合"
```

**输出形式**：战略配置方案（大类资产权重 + 区域目标 + 指数映射 + 预期风险收益）

---

# 商品 · 期货

## 7. Commodity Research Assistant（商品智研助手）

- **slug**：`alice-commodity-research-assistant`　**别名**：`acra`　**版本**：1.0.8　**事件前缀**：`ALICE_COMMODITY_RESEARCH_ASSISTANT`

**技能简介**

输入期货品种名称或 Wind Code，自动生成商品智能日报或专项分析。提炼价格、结构、资金与基本面上的核心驱动，覆盖价格、基差、基本面、远期曲线、资金、仓单、宏观等多个维度，面向机构投资者与专业交易员输出带明确结论的研究报告。

**核心能力**

1. **多维度数据整合** — 价格、基差、基本面、远期曲线、资金、仓单、宏观
2. **核心驱动提炼** — 从价格、结构、资金流、基本面中提炼主导逻辑
3. **日报与专项分析** — 既可出品种日报，也可做专项深挖
4. **明确结论** — 报告落到清晰可用的结论

**适用问题示例**

- "沪铜日报？"
- "铁矿石有没有短线机会？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "沪铜日报" --skill "商品智研助手"
```

**输出形式**：商品智能日报 / 专项分析报告（含核心驱动逻辑与明确结论）

---

## 8. AI Commodity Strategist（AI商品策略师）

- **slug**：`alice-ai-commodity-strategist`　**别名**：`aacs`　**版本**：1.0.2　**事件前缀**：`ALICE_AI_COMMODITY_STRATEGIST`

**技能简介**

面向商品期货的机构级策略助手，服务交易员、研究员、组合经理与产业客户。覆盖能源、黑色、有色、化工、农产品、贵金属全板块，并按交易时段分三段运行：盘前（08:55 前 / 20:55 前）、盘中（日盘 / 夜盘连续交易）、盘后（15:00 后 / 02:30 后）。

**核心能力**

1. **全板块覆盖** — 能源、黑色、有色、化工、农产品、贵金属
2. **盘前策略** — 08:55 前 / 20:55 前输出开盘前策略
3. **盘中跟踪** — 日盘与夜盘连续交易时段的策略跟踪
4. **盘后复盘** — 15:00 后 / 02:30 后的收盘复盘
5. **多角色适配** — 交易员、研究员、组合经理、产业客户

**适用问题示例**

- "今天的期货盘前策略"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "今天的期货盘前策略" --skill "AI商品策略师"
```

**输出形式**：机构级商品策略输出（按盘前/盘中/盘后时段适配）

---

## 9. Futures Research Opinion（期货研报观点）

- **slug**：`alice-futures-research-opinion`　**别名**：`afro`　**版本**：1.0.10　**事件前缀**：`ALICE_FUTURES_RESEARCH_OPINION`

**技能简介**

聚合国内主要期货机构对商品期货的研报观点，按合约或品种归纳多头、空头与中性观点分布，并提取每篇研报背后的核心投资逻辑。输入品种与日期即可得到研报观点报告、机构观点分布、Wind 情绪评分、研报摘要与情绪走势图。

**核心能力**

1. **多机构研报聚合** — 汇总国内主要期货机构观点
2. **多空观点分布** — 按合约或品种统计多/空/中性分布
3. **投资逻辑提取** — 提炼每篇研报的核心逻辑
4. **Wind 情绪评分** — 量化机构情绪
5. **情绪走势追踪** — 情绪变化趋势图表

**适用问题示例**

- "铜最近机构怎么看？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "铜最近机构怎么看？" --skill "期货研报观点"
```

**输出形式**：研报观点报告（观点分布 + Wind 情绪评分 + 研报摘要 + 情绪走势图）

---

## 10. Futures Fund Flow Monitor（期货资金流向监测）

- **slug**：`alice-futures-fund-flow-monitor`　**别名**：`affm`　**版本**：1.0.2　**事件前缀**：`ALICE_FUTURES_FUND_FLOW_MONITOR`

**技能简介**

通过跟踪持仓额变化，监测国内商品期货在全市场、板块与单品种层面的资金流入流出。把当期资金变化与历史样本统计结合，评估同类资金异动后 T+1 与 T+5 的价格表现。输入品种、板块或日期，即得资金流入流出排名、资金变动指标、价格表现、中短线多空机会筛查与资金流日报。

**核心能力**

1. **三层级资金监测** — 全市场 / 板块 / 单品种
2. **持仓额变化追踪** — 以持仓额变化衡量资金流向
3. **历史统计对照** — 结合历史样本评估 T+1 / T+5 价格表现
4. **多空机会筛查** — 中短线多空机会扫描
5. **资金流日报** — 成稿的日度资金流报告

**适用问题示例**

- "今天商品期货资金整体是流入还是流出？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "今天商品期货资金整体是流入还是流出？" --skill "期货资金流向监测"
```

**输出形式**：资金流入流出排名 + 资金变动指标 + 价格表现 + 机会筛查 + 资金流日报

**适用场景**：商品研究员追踪资金轮动与写日报，交易员盘前筛查与盘后复盘

---

## 11. Futures Leading Institution Analysis（期货主力行为分析）

- **slug**：`alice-futures-leading-institution-analysis`　**别名**：`aflia`　**版本**：1.0.2　**事件前缀**：`ALICE_FUTURES_LEADING_INSTITUTION_ANALYSIS`

**技能简介**

基于公开披露的期货会员持仓数据，解读多空持仓、持仓变化、净持仓金额与跨品种敞口，并追踪某会员在指定合约上的历史持仓与估算浮动盈亏。通过排名表、趋势图与自选高亮支持盘后复盘与市场结构监控。**数据反映的是会员席位下的客户合计持仓，不代表机构自营观点，也不构成投资建议。**

**核心能力**

1. **多空持仓与增减仓** — 会员席位的多空持仓及其变化
2. **净持仓金额** — 净持仓规模测算
3. **成交量排名** — 席位成交量排序
4. **跨品种持仓** — 同一会员的跨品种敞口
5. **历史持仓与估算盈亏** — 指定合约上的历史持仓轨迹与浮动盈亏估算
6. **可视化与自选** — 排名表、趋势图、自选品种高亮

**适用问题示例**

- "今天螺纹钢的主力净多席位有哪些？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "今天螺纹钢的主力净多席位有哪些？" --skill "期货主力行为分析"
```

**输出形式**：排名表 + 趋势图 + 自选高亮

---

## 12. Intraday Futures Move Attribution（期货盘中异动归因）

- **slug**：`alice-intraday-futures-move-attribution`　**别名**：`aifma`　**版本**：1.0.2　**事件前缀**：`ALICE_INTRADAY_FUTURES_MOVE_ATTRIBUTION`

**技能简介**

分析商品期货的盘中或日内异动。既能解释某个品种或合约为什么拉升、跳水、突破或放量，也能扫描当日（或指定日期）全市场哪些品种出现异动、值得关注。核验过程覆盖行情走势、分钟线、日线截面、量仓变化、板块联动、内外盘传导与事件线索，最终产出结构化归因报告或异动榜单。

**核心能力**

1. **单品种归因** — 解释某品种/合约为何拉升、跳水、突破、放量
2. **全市场异动扫描** — 扫描当日或指定日期的异动品种
3. **多源线索核验** — 行情、分钟线、日线截面、量仓、板块联动、内外盘传导、事件信号
4. **结构化成稿** — 输出归因报告或异动榜单

**适用问题示例**

- "螺纹钢刚才为什么突然拉升？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "螺纹钢刚才为什么突然拉升？" --skill "期货盘中异动归因"
```

**输出形式**：结构化异动归因报告 / 全市场异动榜单

---

# 期权 · 衍生品

## 13. Option Volatility Insights（期权波动率洞察）

- **slug**：`alice-option-volatility-insights`　**别名**：`aovi`　**版本**：1.0.2　**事件前缀**：`ALICE_OPTION_VOLATILITY_INSIGHTS`

**技能简介**

分析期权波动率与市场状态，覆盖 IV 估值、期限结构、Skew、PCR、波动率曲面与市场异常，生成诊断、信号、市场扫描与报告，服务波动率交易与期权情绪分析。

**核心能力**

1. **IV 估值诊断** — 判断隐含波动率所处水平
2. **期限结构分析** — 不同到期的波动率结构
3. **Skew 与 PCR** — 偏斜与认沽认购比分析
4. **波动率曲面** — 曲面形态刻画
5. **市场异动识别** — 识别波动率层面的异常
6. **信号与扫描** — 输出交易信号与全市场扫描

**适用问题示例**

- "今天沪深 300 ETF 期权的波动率处于什么水平？"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "今天沪深 300 ETF 期权的波动率处于什么水平？" --skill "期权波动率洞察"
```

**输出形式**：波动率诊断报告、交易信号、市场扫描结果

---

## 14. Options Trading Strategies（期权交易策略）

- **slug**：`alice-options-trading-strategies`　**别名**：`aots`　**版本**：1.0.5　**事件前缀**：`ALICE_OPTIONS_TRADING_STRATEGIES`

**技能简介**

面向单标的场内期权的交易技能。融合波动率信号构建、异动打分、策略推荐与情景汇总，交付五段式期权交易方案。适用于个股期权交易、"期权该怎么做"这类操作指引，以及需要可落地推荐方案的场景。

**核心能力**

1. **波动率信号构建** — 从波动率维度构建交易信号
2. **异动打分** — 对异常活跃度打分
3. **策略推荐** — 给出具体期权策略
4. **情景汇总** — 汇总不同情景下的表现

**适用问题示例**

- "帮我分析茅台期权的波动率环境"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "帮我分析茅台期权的波动率环境" --skill "期权交易策略"
```

**输出形式**：五段式期权交易方案

---

## 15. Option Pricing Calculator（期权定价计算器）

- **slug**：`alice-option-pricing-calculator`　**别名**：`aopc`　**版本**：1.0.2　**事件前缀**：`ALICE_OPTION_PRICING_CALCULATOR`

**技能简介**

期权与结构化期权的理论定价工具。支持香草、二元、障碍、亚式、触碰、鲨鱼鳍、累计以及 Autocall / 雪球 / 三层区间等结构，自动补全波动率、利率等市场参数，输出理论价格（NPV）与希腊字母，并支持改参数后重新定价。

**核心能力**

1. **全品类期权定价** — 香草、二元、障碍、亚式、触碰、鲨鱼鳍、累计
2. **结构化产品定价** — Autocall / 雪球 / 三层区间
3. **市场参数自动补全** — 自动填入波动率、利率等参数
4. **NPV 与希腊字母** — 输出理论价格与风险敏感度
5. **参数调整重定价** — 改参数后可重新计算

**适用问题示例**

- "帮我算一下沪深 300 ETF 平值看涨期权的理论价格"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "帮我算一下沪深 300 ETF 平值看涨期权的理论价格" --skill "期权定价计算器"
```

**输出形式**：理论价格（NPV）+ 希腊字母

---

# 监管 · 政策

## 16. Securities Regulatory Policy Briefing（证券业监管政策简报）

- **slug**：`alice-securities-regulatory-policy-briefing`　**别名**：`srpb`　**版本**：1.0.5　**事件前缀**：`ALICE_SECURITIES_REGULATORY_POLICY_BRIEFING`

**技能简介**

检索指定时间范围内的证券行业监管政策，生成结构化的政策摘要与清单表格。基于 Wind 监管法规数据库，覆盖证监会、上交所、深交所、北交所、证券业协会 / 基金业协会 / 期货业协会以及全国股转系统，输出含政策详情、摘要、清单与发布机构分布统计的中英双语简报。

**核心能力**

1. **按时间范围检索** — 指定区间内的监管政策全量检索
2. **发布机构覆盖** — 证监会、上交所、深交所、北交所、三大行业协会、全国股转系统
3. **政策详情与摘要** — 逐条政策详情及摘要提炼
4. **清单表格** — 结构化政策清单
5. **机构分布统计** — 按发布机构统计分布

**适用问题示例**

- "查询近一周的证券监管政策"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "查询近一周的证券监管政策" --skill "证券业监管政策简报"
```

**输出形式**：结构化简报（政策详情 + 摘要 + 清单表格 + 机构分布统计），支持中英双语

---

## 17. NFRA Monthly Enforcement Report（金融监管局处罚月报）

- **slug**：`alice-nfra-monthly-enforcement-report`　**别名**：`nmre`　**版本**：1.0.5　**事件前缀**：`ALICE_NFRA_MONTHLY_ENFORCEMENT_REPORT`

**技能简介**

按指定月份生成国家金融监督管理总局（NFRA）处罚月报。基于 NFRA 及各地派出机构的公开处罚数据，汇总银行业、保险业、信托业及非银金融机构的行政处罚信息，交付含处罚概览、趋势分析与处罚明细三章的中英双语月报。

**核心能力**

1. **公开处罚数据汇总** — 基于 NFRA 及各地派出机构公开数据
2. **机构类型覆盖** — 银行业、保险业、信托业、非银金融机构
3. **处罚概览** — 当月处罚总体情况
4. **趋势分析** — 处罚趋势变化
5. **处罚明细清单** — 逐条处罚明细

**适用问题示例**

- "帮我生成 2026 年 7 月的金融监管处罚月报"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "帮我生成 2026 年 7 月的金融监管处罚月报" --skill "金融监管局处罚月报"
```

**输出形式**：三章式结构化月报（处罚概览 / 趋势分析 / 明细清单），支持中英双语

---

# 通用研究 · 文档产出

## 18. Deep Research（深度研究）

- **slug**：`alice-deep-research`　**别名**：`adr`　**版本**：1.0.6　**事件前缀**：`ALICE_DEEP_RESEARCH`　**预计耗时**：15-30 分钟

**技能简介**

对任意主题做结构化、多阶段的深度研究。先澄清问题、界定研究范围与维度并确认研究计划，再调度多个并行子代理分头调研，最终汇总成一份全面、详细的专业研究报告。适用于深度研究、深入分析、彻底调查、全面研究等需要广覆盖与细节的任务。

**核心能力**

1. **问题澄清** — 先把研究问题问清楚
2. **范围与维度界定** — 确定研究边界与分析维度
3. **研究计划确认** — 生成计划并与用户确认后再执行
4. **并行子代理调研** — 调度多个子代理分头推进
5. **汇总成稿** — 汇总成完整详实的研究报告

**适用问题示例**

- "深度研究固态电池技术的商业化进展"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "深度研究固态电池技术的商业化进展" --skill "深度研究"
```

**输出形式**：全面、详细的专业研究报告

---

## 19. PPT Generator（幻灯片）

- **slug**：`alice-ppt-generator`　**别名**：`apg`　**版本**：1.0.5　**事件前缀**：`ALICE_PPT_GENERATOR`　**预计耗时**：15-30 分钟

**技能简介**

根据主题与结构化内容自动生成专业 PPT 报告，支持标题页、目录、章节页、图文排版与结论总结。面向需要多阶段确认、结构化质量把关与可控增量修订的正式 PPT 交付流程（gated PPTX delivery），适用于投资与金融汇报、商业与管理汇报、产品与市场展示、培训与教育课件等场景。定位为正式 PPT 生成与交付流程，非轻量一次性 PPT 阅读。

**核心能力**

1. **完整版式生成** — 标题页、目录、章节页、图文排版、结论总结
2. **多阶段确认** — 生成过程分阶段与用户确认
3. **结构化质量把关** — 设置质量关卡，产物驱动的问题恢复
4. **可控增量修订** — 支持受控的逐步修改

**适用问题示例**

- "帮我做一份新能源汽车行业的投资研究 PPT，12 页"

**调用示例**

```bash
node scripts/wind-alice.mjs --prompt "帮我做一份新能源汽车行业的投资研究 PPT，12 页" --skill "幻灯片"
```

**输出形式**：PPTX 演示文稿

---

## 附：与主目录文档的关系

- 上架技能（14 个）详情：[alice-cli-skill-catalog.md](alice-cli-skill-catalog.md)
- 本文 19 个技能 + 上架 14 个的 CLI 元信息（slug / 别名 / 事件前缀 / 双语描述）：[Alice-CLI-技能与专家清单.md](../skills/Alice-CLI-技能与专家清单.md)
