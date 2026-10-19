import randomUUID from "./uuidv7.js";
import {
  formatLocalFileLink,
  sanitizeAgentResultTextForDelivery,
} from "./agentResultSanitize.js";
import { spawnUpdateCheck } from "./update-check.mjs";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, parse as parsePath, resolve as resolvePath, sep as pathSep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_API_URL = "https://mcp.wind.com.cn/skills/alice";
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url))); // .../alice-experts
const WIND_AIFINMARKET_PORTAL = "https://market.windalice.com/#/user/overview";
const WIND_AIFINMARKET_CREDITS = "https://market.windalice.com/#/user/credits";

// 服务端在 agentResult 中给出的 `/project/xxx` 是 Alice 工作区相对路径，需要拼成
// 完整下载 URL 才能由 CLI 自动拉取：
//   ${WIND_PROJECT_FILES_PREFIX}<contextId>/project/<filename>
// 其中 contextId 取自本次请求体里 `params.message.contextId`。
const DEFAULT_WIND_PROJECT_FILES_PREFIX = [
  "https://alice.wind.com.cn",
  "/weaver/files/",
  "alice-convo-",
  "1416751125",
  "/sessions/",
].join("");
const WIND_PROJECT_FILES_PREFIX =
  process.env.WIND_PROJECT_FILES_PREFIX ?? DEFAULT_WIND_PROJECT_FILES_PREFIX;

// 当前请求的 contextId，供下载阶段把 `/project/...` 相对路径补全为完整 URL；每次请求开始前重置。
let currentSessionContextId = null;

/**
 * 体验账户当日额度耗尽时，服务端会通过 status-update / UIState 里的
 * A2A.Markdown 投递这段中文提示；命中后直接停止后续处理。
 */
const WIND_TRIAL_DAY_QUOTA_SNIPPET =
  "很抱歉，今日已超出体验期任务限额，欢迎您明日再来尝试。";

let windTrialQuotaHandled = false;

// 记录整轮调用中是否实际接收到 agentResult 最终结果（防止流异常中断但退出码为 0 假成功）
let agentResultSeen = false;

export function __getAgentResultSeenForTesting() {
  return agentResultSeen;
}

export function __setAgentResultSeenForTesting(val) {
  agentResultSeen = !!val;
}

export class WindTrialQuotaExceeded extends Error {
  constructor() {
    super("WIND_TRIAL_DAY_QUOTA");
    this.name = "WindTrialQuotaExceeded";
  }
}

function logWindTrialQuotaIfPresent(events) {
  if (windTrialQuotaHandled || !Array.isArray(events) || events.length === 0) {
    return;
  }
  for (const ev of events) {
    let text;
    try {
      text = JSON.stringify(ev);
    } catch {
      continue;
    }
    if (text.includes(WIND_TRIAL_DAY_QUOTA_SNIPPET)) {
      windTrialQuotaHandled = true;
      throw new WindTrialQuotaExceeded();
    }
  }
}

// ============================================================================
// Alice 专家清单（共 6 位专家，集中维护于 alice-experts 单一包内）
// ============================================================================
// 与常规技能（Skills）不同，专家的 A2A 协议约定如下：
// 1. features.promptPrefix = false：正文 text 不拼接「使用「...」技能：」前缀，
//    用户提问原话直接透传给服务端，保持最原汁原味的研究意图；
// 2. 在 parts[1].data 中显式指定 `activeSubAgent: expert.activeSubAgent`，
//    服务端接收后直接路由给对应的专家 Agent 执行；
// 3. 同时支持 --expert 显式指定，以及结合提问关键词做智能自动识别。
// ============================================================================

export const KNOWN_EXPERTS = [
  {
    activeSubAgent: "economic-research",
    slug: "alice-economic-research-expert",
    alias: "aecr",
    nameZh: "经济研究专家",
    nameEn: "Economic Research Expert",
    descZh:
      "面向宏观经济与行业研究，围绕数据变化、政策信号与财经事件，梳理区域差异、关键驱动、传导路径与周期位置。识别预期差与共识变化，研判经济方向及行业影响，输出证据可追溯的研究报告、PPT或看板。",
    descEn:
      "An economic research expert for macro-economy and industry research. It organises regional differences, key drivers, transmission paths and cycle positioning around data changes, policy signals and financial events, identifies expectation gaps and shifts in institutional consensus, and delivers well-evidenced reports, PPT decks and economic dashboards.",
    promptExample: "帮我整理美国本周公布的主要经济数据和下周的公布日程",
    tags: ["经济数据解读", "央行政策分析", "区域经济比较"],
    keywords: [
      "经济研究",
      "宏观经济",
      "宏观数据",
      "经济数据",
      "央行政策",
      "货币政策",
      "财政政策",
      "加息",
      "降息",
      "美联储",
      "CPI",
      "PPI",
      "PMI",
      "GDP",
      "社融",
      "周期位置",
      "区域经济",
      "卖方共识",
      "预期差",
    ],
    aliases: [
      "经济研究",
      "宏观研究",
      "宏观经济专家",
      "经济专家",
      "宏观专家",
      "宏观分析",
      "economic research",
      "economic-research",
      "aecr",
      "alice-economic-research-expert",
    ],
  },
  {
    activeSubAgent: "equity-deep-research-agent",
    slug: "alice-equity-research-expert",
    alias: "aere",
    nameZh: "个股研究专家",
    nameEn: "Equity Research Expert",
    descZh:
      "面向二级市场的个股研究搭档，围绕公司基本面、财报与事件、估值位置及可证伪投资逻辑，形成有证据、有反方观点、可持续跟踪的研究判断，并交付带真实数据图表与来源的报告。",
    descEn:
      "An equity research partner for secondary-market investors. It builds evidence-backed, falsifiable investment views around company fundamentals, earnings and events, valuation positioning and counter-arguments, and delivers reports with real data charts and cited sources.",
    promptExample: "做一份英伟达（NVDA.O）的中报前瞻",
    tags: ["个股深研", "基本面分析", "商业模式"],
    keywords: [
      "个股研究",
      "个股深研",
      "基本面",
      "中报前瞻",
      "年报点评",
      "财报分析",
      "财报深研",
      "估值位置",
      "可证伪",
      "反方观点",
      "商业模式",
      "竞争壁垒",
      "业绩拆解",
      "个股投资逻辑",
      "股票研究",
    ],
    aliases: [
      "个股研究",
      "个股深研",
      "个股专家",
      "个股深度研究",
      "股票研究专家",
      "个股分析",
      "equity research",
      "equity-deep-research",
      "equity-deep-research-agent",
      "aere",
      "alice-equity-research-expert",
    ],
  },
  {
    activeSubAgent: "industry-research",
    slug: "alice-industry-research-expert",
    alias: "aeir",
    nameZh: "行业研究专家",
    nameEn: "Industry Research Expert",
    descZh:
      "面向股票投研团队的行业研究搭档，围绕行业、子行业、产业链环节、投资主题和突发事件，形成可验证的景气度判断、利润迁移、公司映射、风险校验与投委会级研究材料。",
    descEn:
      "An industry research partner for equity research and investment teams. It builds verifiable business cycle judgments, profit pool migrations, company mappings, risk validations, and IC-grade research materials around industries, sub-sectors, supply chain links, investment themes, and unexpected events.",
    promptExample: "从零研究低空经济行业并形成景气判断",
    tags: ["行业全景", "景气度与产业链", "公司映射"],
    keywords: [
      "行业研究",
      "产业链",
      "景气度",
      "利润池",
      "利润迁移",
      "公司映射",
      "投委会",
      "子行业",
      "供需格局",
      "行业壁垒",
      "产业周期",
      "主题投资",
      "低空经济",
      "行业格局",
    ],
    aliases: [
      "行业研究",
      "行研",
      "行业专家",
      "产业研究",
      "行业深度研究",
      "产业链研究",
      "industry research",
      "industry-research",
      "aeir",
      "alice-industry-research-expert",
    ],
  },
  {
    activeSubAgent: "market-monitoring",
    slug: "alice-market-monitoring-expert",
    alias: "amme",
    nameZh: "市场监测专家",
    nameEn: "Market Monitoring Expert",
    descZh:
      "面向金融市场与经济数据场景的智能监控预警专家，实时跟踪行情异动、债券估值偏离、公司公告、重大事件及宏观经济数据公布，提炼关键信息并分析潜在影响，及时发现风险与投资机会。",
    descEn:
      "A market monitoring and alerting expert for financial markets and economic data. It continuously tracks price moves, bond valuation deviations, company announcements, major events and macro-data releases, extracts the key changes and assesses their potential impact to surface risks and opportunities early.",
    promptExample:
      "帮我设置贵州茅台跌破20日均线提醒，并在触发后对该股进行市场调研与趋势评估分析。",
    tags: ["行情监控", "公告监控", "重大事件监控"],
    keywords: [
      "市场监测",
      "行情异动",
      "监控预警",
      "跌破",
      "突破",
      "均线提醒",
      "异动提醒",
      "公告监控",
      "重大事件监控",
      "债券估值偏离",
      "价格提醒",
      "行情监控",
      "异动预警",
    ],
    aliases: [
      "市场监测",
      "市场监控",
      "行情监控",
      "异动监控",
      "市场预警",
      "行情预警",
      "异动预警",
      "异动提醒",
      "监控预警",
      "市场监测专家",
      "market monitoring",
      "market-monitoring",
      "amme",
      "alice-market-monitoring-expert",
    ],
  },
  {
    activeSubAgent: "meeting",
    slug: "alice-meeting-expert",
    alias: "ame",
    nameZh: "会议专家",
    nameEn: "Meeting Expert",
    descZh:
      "作为你的会议专家，全程协助处理一场会议从会前到会后的关键工作，适合路演、业绩会、调研拜访等多个会议场景。",
    descEn:
      "Your meeting expert, assisting end to end with the key work of a meeting from preparation through follow-up. Suited to roadshows, earnings calls, research visits and similar settings.",
    promptExample: "未来一周有哪些上市公司业绩会召开？",
    tags: ["会前准备", "AI 参会", "会议复盘"],
    keywords: [
      "会议专家",
      "业绩会",
      "路演",
      "调研拜访",
      "AI参会",
      "会前准备",
      "会议纪要",
      "会议复盘",
      "电话会",
      "投资者交流会",
      "参会日程",
      "会议整理",
    ],
    aliases: [
      "会议专家",
      "会议助手",
      "业绩会助手",
      "路演助手",
      "参会助手",
      "会议纪要助手",
      "meeting expert",
      "meeting",
      "ame",
      "alice-meeting-expert",
    ],
  },
  {
    activeSubAgent: "advisor",
    slug: "alice-wealth-advisor",
    alias: "awa",
    nameZh: "财富管理顾问",
    nameEn: "Wealth Management Advisor",
    descZh:
      "面向投资顾问和理财师的财富管理助手，覆盖客户洞察、产品研究筛选、持仓诊断、资产配置、调仓再平衡、定投分析、保险保障与客户经营，按业务目标调用对应专业能力，在合规与客户授权边界内交付分析与方案。",
    descEn:
      "A wealth-management assistant for investment advisers and financial planners, covering client insight, product screening, portfolio diagnostics, asset allocation, rebalancing, systematic-investment analysis, insurance protection and client engagement. It invokes the right capability for the business goal and delivers analysis and plans within compliance and client-authorization boundaries.",
    promptExample: "帮我创建一个客户，持仓包含国金量化多因子A",
    tags: ["产品研究", "客户经营", "持仓诊断"],
    keywords: [
      "财富管理",
      "财富管理专家",
      "财富顾问",
      "理财师",
      "理财专家",
      "理财",
      "投资顾问",
      "客户",
      "创建客户",
      "持仓",
      "持仓包含",
      "持仓诊断",
      "客户洞察",
      "资产配置",
      "调仓",
      "再平衡",
      "定投",
      "保险保障",
      "客户经营",
      "理财方案",
      "理财建议",
      "国金量化",
    ],
    aliases: [
      "财富管理顾问",
      "财富管理专家",
      "财富顾问",
      "财富管理",
      "理财顾问",
      "理财专家",
      "投顾助手",
      "财富助手",
      "理财师助手",
      "wealth advisor",
      "wealth management advisor",
      "advisor",
      "awa",
      "alice-wealth-advisor",
    ],
  },
];

/** 归一化字符串（用于不区分大小写、空白、中划线等模糊匹配）。 */
export function normalizeExpertName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

// 建立别名到 activeSubAgent 的查找表
const EXPERT_ALIAS_MAP = new Map();
for (const expert of KNOWN_EXPERTS) {
  const targetId = expert.activeSubAgent;
  EXPERT_ALIAS_MAP.set(normalizeExpertName(expert.activeSubAgent), targetId);
  EXPERT_ALIAS_MAP.set(normalizeExpertName(expert.slug), targetId);
  EXPERT_ALIAS_MAP.set(normalizeExpertName(expert.alias), targetId);
  EXPERT_ALIAS_MAP.set(normalizeExpertName(expert.nameZh), targetId);
  EXPERT_ALIAS_MAP.set(normalizeExpertName(expert.nameEn), targetId);
  for (const a of expert.aliases || []) {
    EXPERT_ALIAS_MAP.set(normalizeExpertName(a), targetId);
  }
}

/**
 * 解析用户传入的 --expert / -e 值。
 * 匹配优先级：
 *   1) 字面匹配 activeSubAgent
 *   2) 字面匹配 slug / alias
 *   3) 字面匹配 nameZh / nameEn
 *   4) normalize 模糊匹配（忽略大小写、连字符、空格）
 *   5) 别名映射
 * 命中返回 { matched: true, expert, matchedBy, aliasFrom }
 * 未命中返回 { matched: false, raw: input, expert: null, matchedBy: null }
 */
export function resolveExpert(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // 1. 字面匹配 activeSubAgent
  const exactId = KNOWN_EXPERTS.find((e) => e.activeSubAgent === raw);
  if (exactId) return { matched: true, expert: exactId, matchedBy: "activeSubAgent" };

  // 2. 字面匹配 slug / alias
  const exactSlugOrAlias = KNOWN_EXPERTS.find((e) => e.slug === raw || e.alias === raw);
  if (exactSlugOrAlias) return { matched: true, expert: exactSlugOrAlias, matchedBy: "slug/alias" };

  // 3. 字面匹配 nameZh / nameEn
  const exactZh = KNOWN_EXPERTS.find((e) => e.nameZh === raw);
  if (exactZh) return { matched: true, expert: exactZh, matchedBy: "nameZh" };

  const exactEn = KNOWN_EXPERTS.find((e) => e.nameEn === raw);
  if (exactEn) return { matched: true, expert: exactEn, matchedBy: "nameEn" };

  // 4. normalize 模糊匹配
  const norm = normalizeExpertName(raw);
  const fuzzy = KNOWN_EXPERTS.find(
    (e) =>
      normalizeExpertName(e.activeSubAgent) === norm ||
      normalizeExpertName(e.slug) === norm ||
      normalizeExpertName(e.alias) === norm ||
      normalizeExpertName(e.nameZh) === norm ||
      normalizeExpertName(e.nameEn) === norm,
  );
  if (fuzzy) return { matched: true, expert: fuzzy, matchedBy: "fuzzy" };

  // 5. 别名表匹配
  const aliasTargetId = EXPERT_ALIAS_MAP.get(norm);
  if (aliasTargetId) {
    const aliasEntry = KNOWN_EXPERTS.find((e) => e.activeSubAgent === aliasTargetId);
    if (aliasEntry) {
      return {
        matched: true,
        expert: aliasEntry,
        matchedBy: "alias",
        aliasFrom: raw,
      };
    }
  }

  return { matched: false, raw, expert: null, matchedBy: null };
}

/**
 * 当用户未显式传入 --expert 时，根据提问 prompt 关键词智能自动识别最匹配的专家。
 * 计算命中关键词的综合得分（匹配长度优先）。
 * @param {string} prompt
 * @returns {typeof KNOWN_EXPERTS[number] | null}
 */
export function detectExpertFromPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return null;
  const text = prompt.toLowerCase();

  let bestExpert = null;
  let maxScore = 0;

  for (const expert of KNOWN_EXPERTS) {
    let score = 0;
    // 专家名称直接出现加最高权重
    if (text.includes(expert.nameZh.toLowerCase())) {
      score += 100;
    }
    if (text.includes(expert.nameEn.toLowerCase())) {
      score += 100;
    }
    // 别名出现
    for (const alias of expert.aliases || []) {
      if (text.includes(alias.toLowerCase())) {
        score += 50;
      }
    }
    // 关键词出现
    for (const kw of expert.keywords || []) {
      const kwLower = kw.toLowerCase();
      if (text.includes(kwLower)) {
        // 较长关键词权重更高
        score += kwLower.length * 3;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestExpert = expert;
    }
  }

  return maxScore >= 6 ? bestExpert : null;
}

/**
 * 构造调用 Alice 专家的请求体。
 * 核心注意点：
 * 1. 专家包 features.promptPrefix = false：用户原话直接透传，不加任何「使用「...」技能：」前缀；
 * 2. 在 parts[1].data 里注入 `activeSubAgent: expert.activeSubAgent`；
 * 3. 如未指定专家，则不注入 activeSubAgent，让服务端按 auto 路由。
 *
 * @param {string} prompt 用户原始提问
 * @param {typeof KNOWN_EXPERTS[number] | null} expert 专家对象
 * @param {{ reuseContextId?: string }} [opts]
 */
function buildBody(prompt, expert = null, { reuseContextId } = {}) {
  const text = String(prompt ?? "");
  const contextId =
    typeof reuseContextId === "string" && reuseContextId.length > 0
      ? reuseContextId
      : randomUUID();

  const data = {
    chatMode: "12",
    originalChatMode: "4",
    switchMode: "auto",
    timezone: "Asia/Shanghai",
  };
  if (expert?.activeSubAgent) {
    data.activeSubAgent = expert.activeSubAgent;
  }

  return {
    jsonrpc: "2.0",
    method: "message/stream",
    params: {
      message: {
        messageId: randomUUID(),
        role: "user",
        kind: "message",
        parts: [
          { kind: "text", text },
          {
            kind: "data",
            data,
            metadata: {
              key: "Wind.WindSearch.ChatService.A2A",
              version: "1.0.0",
            },
          },
        ],
        contextId,
        taskId: randomUUID(),
      },
    },
    id: randomUUID(),
  };
}

/** @internal 单测：暴露 buildBody 以便断言 Expert 行为。 */
export function __buildBodyForTesting(prompt, expert = null, opts) {
  return buildBody(prompt, expert, opts);
}

function parseDotenv(content) {
  const env = {};
  for (const rawLine of content.split("\n")) {
    let line = rawLine.replace(/^﻿/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(" #");
      if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    }
    env[key] = val;
  }
  return env;
}

function getApiUrl() {
  return process.env.WIND_ALICE_API_URL || DEFAULT_API_URL;
}

function die(code, message, { extraHint } = {}) {
  const payload = { code, message, ...(extraHint ? { hint: extraHint } : {}) };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
  throw new Error(message);
}

function getApiKey() {
  // 全局 Key 存储位置（与其它 wind 技能共用）
  const globalConfigEnv = join(homedir(), ".wind-aifinmarket", "config.env");
  const globalConfig = join(homedir(), ".wind-aifinmarket", "config");
  for (const cfgPath of [globalConfigEnv, globalConfig]) {
    if (existsSync(cfgPath)) {
      try {
        const env = parseDotenv(readFileSync(cfgPath, "utf8"));
        const key = env.WIND_API_KEY?.trim();
        if (key) return key;
      } catch {}
    }
  }

  const localConfig = join(SKILL_DIR, "config.json");
  if (existsSync(localConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(localConfig, "utf8"));
      const key =
        typeof cfg.wind_api_key === "string" ? cfg.wind_api_key.trim() : "";
      if (key) return key;
    } catch {}
  }

  const envKey = process.env.WIND_API_KEY?.trim();
  if (envKey) return envKey;

  die("KEY_MISSING", "WIND_API_KEY 未配置", {
    extraHint:
      `CLI 已完整检查：用户全局配置 > Skill 本地配置 > WIND_API_KEY 环境变量；不要再手动检查部分来源。\n` +
      `① 获取 Key：访问 ${WIND_AIFINMARKET_PORTAL}（或 https://aifinmarket.wind.com.cn/#/user/overview）（未登录通常会跳转登录页）。\n` +
      `② 选择 Key 存放位置：\n` +
      `   A. 全局共享【推荐 — 所有 wind skill 共用】：%USERPROFILE%\\.wind-aifinmarket\\config.env（或 config）\n` +
      `      内容：WIND_API_KEY=<KEY>\n` +
      `   B. 仅当前 skill：${join(SKILL_DIR, "config.json")}\n` +
      `      内容：{"wind_api_key":"<KEY>"}\n` +
      `   C. 临时会话：在终端 set / $env:WIND_API_KEY=<KEY>\n` +
      `③ 积分充值：${WIND_AIFINMARKET_CREDITS}\n` +
      `④ 重试原命令`,
  });
}

function buildHeaders(apiKey) {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function resubscribeBody({ taskId, contextId, params }) {
  return {
    jsonrpc: "2.0",
    method: "tasks/resubscribe",
    params: {
      id: taskId || params?.params?.message?.taskId,
      contextId: contextId || params?.params?.message?.contextId,
    },
    id: randomUUID(),
  };
}

function usage() {
  return [
    "alice-experts — 调用万得 Alice 专家 Agent，集中统一执行 6 大专业领域专家并流式输出分析结果",
    "",
    "Usage:",
    '  node scripts/alice-experts.mjs --prompt <QUESTION> [--expert <EXPERT_NAME>] [--context-id <ID>]',
    "  node scripts/alice-experts.mjs list-experts",
    "  node scripts/alice-experts.mjs --help",
    "  (或在系统 PATH 配置全局别名时直接使用: alice-experts --prompt ...)",
    "",
    "Options:",
    "  --prompt, -p <QUESTION>        用户提问（必填，list-experts 除外）",
    "  --expert, -e <EXPERT_NAME>     要执行的 Alice 专家，支持中英文名、ID 或别名：",
    "                                   · 经济研究专家 / economic-research / aecr",
    "                                   · 个股研究专家 / equity-deep-research-agent / aere",
    "                                   · 行业研究专家 / industry-research / aeir",
    "                                   · 市场监测专家 / market-monitoring / amme",
    "                                   · 会议专家     / meeting / ame",
    "                                   · 财富管理顾问 / advisor / awa",
    "                                 不传则根据问句关键词智能自动识别路由；若传错专家名将严格拦截报错以避免浪费积分。",
    "  --context-id, -c <CONTEXT_ID>  会话上下文 ID（可选，用于多轮追问或补充回答专家的澄清问题）",
    "  --list-experts                 列出全部 6 个专家的能力与触发信息（等同子命令 list-experts）",
    "  --help,   -h                   查看帮助",
    "",
    "Env:",
    "  WIND_ALICE_API_URL             可选；默认 " + DEFAULT_API_URL,
    "  WIND_API_KEY                   可选；配置文件均未提供时读取",
    "",
    "Config (按优先级):",
    `  ${join(homedir(), ".wind-aifinmarket", "config.env")} (dotenv: WIND_API_KEY=...)`,
    `  ${join(homedir(), ".wind-aifinmarket", "config")}     (dotenv: 历史兼容)`,
    `  ${join(SKILL_DIR, "config.json")}   (JSON: {"wind_api_key":"..."})`,
    "  WIND_API_KEY 环境变量",
  ].join("\n");
}

function printExpertsTable() {
  const total = KNOWN_EXPERTS.length;
  console.log(`万得 Alice 专家清单（共 ${total} 位专家，集中维护于 alice-experts 单一包内）：\n`);
  for (const e of KNOWN_EXPERTS) {
    console.log(`- 「${e.nameZh}」(${e.nameEn})`);
    console.log(`    专家标识 (activeSubAgent)：${e.activeSubAgent}`);
    console.log(`    内置短别名 (alias)：      ${e.alias} / ${e.slug}`);
    console.log(`    常用口语别名：            ${(e.aliases || []).join(", ")}`);
    console.log(`    功能定位：                ${e.descZh}`);
    console.log(`    典型示例提问：            ${e.promptExample}`);
    console.log("");
  }
  console.log('用法示例：node scripts/alice-experts.mjs --prompt "做一份英伟达（NVDA.O）的中报前瞻" --expert "个股研究专家"');
  console.log("提示：--expert 支持中文名、英文名、activeSubAgent ID 或口语别名；若不传 --expert，CLI 会自动根据提问关键词进行智能路由。");
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  let prompt;
  let expert;
  let contextId;
  let listExperts = false;
  let help = false;
  let command;
  const errors = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--list-experts" || arg === "list-experts") {
      listExperts = true;
    } else if (arg === "--prompt" || arg === "-p") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) {
        errors.push(`选项 "${arg}" 缺少提问内容参数（不能紧跟选项 "${next ?? ""}"）。`);
      } else {
        prompt = next;
        i++;
      }
    } else if (arg.startsWith("--prompt=")) {
      prompt = arg.slice("--prompt=".length);
      if (!prompt) errors.push(`选项 "--prompt" 的内容不能为空。`);
    } else if (arg.startsWith("-p=")) {
      prompt = arg.slice("-p=".length);
      if (!prompt) errors.push(`选项 "-p" 的内容不能为空。`);
    } else if (arg.startsWith("-p-") || arg.startsWith("-e-") || (/^-[a-zA-Z]{2,}/.test(arg) && arg.includes("p"))) {
      errors.push(`参数格式错误 "${arg}"：请在 -p 与问题内容、-e 与专家名称之间保留空格。`);
    } else if (arg === "--expert" || arg === "-e") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) {
        errors.push(`选项 "${arg}" 缺少专家名称参数（不能紧跟选项 "${next ?? ""}"）。`);
      } else {
        expert = next;
        i++;
      }
    } else if (arg.startsWith("--expert=")) {
      expert = arg.slice("--expert=".length);
      if (!expert) errors.push(`选项 "--expert" 的内容不能为空。`);
    } else if (arg.startsWith("-e=")) {
      expert = arg.slice("-e=".length);
      if (!expert) errors.push(`选项 "-e" 的内容不能为空。`);
    } else if (arg === "--context-id" || arg === "-c" || arg === "--session-id") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) {
        errors.push(`选项 "${arg}" 缺少上下文 ID 参数。`);
      } else {
        contextId = next;
        i++;
      }
    } else if (arg.startsWith("--context-id=")) {
      contextId = arg.slice("--context-id=".length);
    } else if (arg.startsWith("-c=")) {
      contextId = arg.slice("-c=".length);
    } else if (arg.startsWith("-")) {
      errors.push(`未知选项: "${arg}"`);
    } else if (!command) {
      command = arg;
    }
  }

  return {
    command,
    prompt,
    expert,
    contextId,
    listExperts: listExperts || command === "list-experts",
    help,
    errors,
  };
}

export function parseSsePayload(payload) {
  return payload
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!data) return [];

      try {
        return [JSON.parse(data)];
      } catch (error) {
        console.error("failed to parse SSE event:");
        console.error(block);
        console.error(error);
        return [];
      }
    });
}

export function extractAgentResultValues(events) {
  return events.flatMap((event) => {
    const artifact = event?.result?.artifact;
    if (
      event?.result?.kind !== "artifact-update" ||
      artifact?.name !== "agentResult"
    ) {
      return [];
    }

    return (artifact.parts ?? []).flatMap((part) => {
      if (part?.kind !== "data") return [];
      const value = part?.data?.data;
      return value === undefined ? [] : [value];
    });
  });
}

const EXIT_SERVER_BLOCKED = 75;

const RESULT_ERROR_CLASSIFIERS = [
  {
    kind: "concurrency",
    patterns: [
      /最大同步执行任务/,
      /同步执行任务数目/,
      /并发.*(限制|上限)/,
      /同时.*执行.*上限/,
      /请等待其他任务执行完成/,
      /Maximum concurrent tasks limit/i,
    ],
  },
  {
    kind: "points",
    patterns: [
      /积分不足/,
      /积分已用完/,
      /积分.*用尽/,
      /积分.*耗尽/,
      /积分余额.*不足/,
      /余额不足/,
      /请.*充值/,
      /Points not enough/i,
      /insufficient\s+points/i,
      /points?\s*(?:not\s*enough|exhausted|insufficient)/i,
    ],
  },
  {
    kind: "quota",
    patterns: [/体验期.*限额/, /超出体验期/, /额度耗尽/, /明日再来/, /当日.*额度/],
  },
  {
    kind: "busy",
    patterns: [/服务繁忙/, /系统繁忙/, /请稍后重试/],
  },
];

export function classifyResultError(text) {
  const s = String(text ?? "");
  for (const { kind, patterns } of RESULT_ERROR_CLASSIFIERS) {
    if (patterns.some((re) => re.test(s))) {
      return { kind, exitCode: EXIT_SERVER_BLOCKED };
    }
  }
  return { kind: "generic", exitCode: 1 };
}

export function isResultError(event) {
  const result = event?.result;
  return !!result && typeof result === "object" && result.isError === true;
}

export function extractResultErrorText(event) {
  const result = event?.result;
  if (!result || typeof result !== "object" || result.isError !== true) {
    return null;
  }
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts = parts
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean);
  return texts.length > 0 ? texts.join("\n") : null;
}

export function extractServerTaskIds(event) {
  const result = event?.result;
  if (!result || typeof result !== "object") return null;

  const taskId =
    (typeof result.taskId === "string" && result.taskId) ||
    (typeof result.id === "string" && result.id) ||
    null;
  const contextId =
    (typeof result.contextId === "string" && result.contextId) || null;

  if (!taskId || !contextId) return null;
  return { taskId, contextId };
}

function refreshSessionContextIdFromEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  for (const ev of events) {
    const ids = extractServerTaskIds(ev);
    if (ids?.contextId) {
      currentSessionContextId = ids.contextId;
      return;
    }
  }
}

export function __setSessionContextIdForTesting(ctxId) {
  currentSessionContextId = ctxId ?? null;
}

const FILE_EXT_WHITELIST = new Set([
  "md",
  "markdown",
  "xlsx",
  "xls",
  "csv",
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "txt",
  "zip",
  "rar",
  "7z",
  "png",
  "jpg",
  "jpeg",
  "svg",
  "html",
  "htm",
  "json",
]);

const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL_RE =
  /https?:\/\/alice(?:exp)?\.wind\.com\.cn\/weaver\/files\/[^\s)\]]+/g;
const PROJ_LINK_RE =
  /(?:\[([^\]]*)\]\((?:file:\/\/\/?)?(\/project\/[^\s)]+)\))|(?:`(\/project\/[^`]+)`)|(?:file:\/\/\/(\/project\/[^\s]+))|(?<![\w/`])(\/project\/[A-Za-z0-9_\u4e00-\u9fa5.\-]+\.[A-Za-z0-9]+)/g;

function sanitizeUrlTail(raw) {
  let url = raw;
  url = url.replace(/[),.;:!?"'\u3002\uff0c\uff1b]+$/, "");
  const unclosed = (url.match(/\[/g) || []).length - (url.match(/\]/g) || []).length;
  if (unclosed > 0) {
    const bracketIdx = url.lastIndexOf("[");
    if (bracketIdx !== -1) {
      url = url.slice(0, bracketIdx);
    }
  }
  return url;
}

function isWhitelistedFileUrl(url) {
  try {
    const { pathname } = new URL(url);
    const ext = pathname.split(".").pop()?.toLowerCase();
    return FILE_EXT_WHITELIST.has(ext);
  } catch {
    return false;
  }
}

function deriveFilenameFromUrl(url, fallback = "downloaded") {
  try {
    const { pathname } = new URL(url);
    const raw = pathname.split("/").filter(Boolean).pop();
    if (!raw) return fallback;
    return decodeURIComponent(raw);
  } catch {
    return fallback;
  }
}

function buildSessionProjectFileUrl(projectRelPath) {
  if (!currentSessionContextId) return null;
  const rel = projectRelPath.replace(/^\/+/, "");
  return `${WIND_PROJECT_FILES_PREFIX}${currentSessionContextId}/${rel}`;
}

const collectedDownloads = new Map();
const textScannedDownloads = new Map();

export function collectDownloadLinks(text) {
  if (!text || typeof text !== "string") return [];
  const found = [];
  const seenUrls = new Set();

  let m;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    const label = m[1]?.trim();
    const url = sanitizeUrlTail(m[2]);
    if (isWhitelistedFileUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      found.push({ url, filename: label || deriveFilenameFromUrl(url) });
    }
  }

  BARE_URL_RE.lastIndex = 0;
  while ((m = BARE_URL_RE.exec(text)) !== null) {
    const url = sanitizeUrlTail(m[0]);
    if (isWhitelistedFileUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      found.push({ url, filename: deriveFilenameFromUrl(url) });
    }
  }

  PROJ_LINK_RE.lastIndex = 0;
  while ((m = PROJ_LINK_RE.exec(text)) !== null) {
    const label = m[1]?.trim();
    const projPath = m[2] || m[3] || m[4] || m[5];
    if (!projPath) continue;

    const ext = projPath.split(".").pop()?.toLowerCase();
    if (!FILE_EXT_WHITELIST.has(ext)) continue;

    const fullUrl = buildSessionProjectFileUrl(projPath);
    if (!fullUrl || seenUrls.has(fullUrl)) continue;

    seenUrls.add(fullUrl);
    const rawName = projPath.split("/").filter(Boolean).pop();
    const filename =
      label && !label.startsWith("/project/") && !label.endsWith(rawName)
        ? label
        : rawName;
    found.push({ url: fullUrl, filename: filename || deriveFilenameFromUrl(fullUrl) });
  }

  return found;
}

function accumulateDownloadsFromText(text) {
  for (const { url, filename } of collectDownloadLinks(text)) {
    if (!textScannedDownloads.has(url)) textScannedDownloads.set(url, filename);
  }
}

const presentFilesDiagnostic = {
  componentsFound: 0,
  filesExtracted: [],
  rawComponents: [],
};

function collectPresentFileLeaves(node, out) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const child of node) collectPresentFileLeaves(child, out);
    return;
  }
  if (typeof node !== "object") return;

  const path = typeof node.path === "string" ? node.path : "";
  const name = typeof node.name === "string" ? node.name : "";
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  if (node.type === "file") {
    if (path || name) out.push({ path, name });
    return;
  }
  if (node.type === "dir" || hasChildren) {
    if (hasChildren) {
      for (const child of node.children) collectPresentFileLeaves(child, out);
    }
    return;
  }
  if (name && /\.[A-Za-z0-9]+$/.test(name)) out.push({ path, name });
}

function findPresentFilesComponents(node, out, depth = 0) {
  if (node == null || depth > 32) return;
  if (Array.isArray(node)) {
    for (const child of node) findPresentFilesComponents(child, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  if (node.componentName === "A2A.PresentFiles") out.push(node);
  for (const key of Object.keys(node)) {
    findPresentFilesComponents(node[key], out, depth + 1);
  }
}

export function extractPresentFilesDownloads(events) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const components = [];
  for (const ev of events) {
    const result = ev?.result;
    if (result != null) findPresentFilesComponents(result, components);
  }
  presentFilesDiagnostic.componentsFound += components.length;
  for (const c of components) {
    try {
      presentFilesDiagnostic.rawComponents.push(JSON.stringify(c).slice(0, 4000));
    } catch {}
  }
  if (components.length === 0) return [];

  const leaves = [];
  for (const c of components) {
    const presentFiles = c?.properties?.presentFiles;
    if (presentFiles != null) collectPresentFileLeaves(presentFiles, leaves);
  }
  if (leaves.length === 0) return [];

  const out = [];
  for (const { path, name } of leaves) {
    let url = null;
    if (path && /^https?:\/\//i.test(path)) url = path;
    else if (path) url = buildSessionProjectFileUrl(path);
    if (!url) continue;
    out.push({ url, filename: name || deriveFilenameFromUrl(url, "downloaded") });
  }

  for (const { filename } of out) {
    if (!presentFilesDiagnostic.filesExtracted.includes(filename)) {
      presentFilesDiagnostic.filesExtracted.push(filename);
    }
  }
  return out;
}

function accumulateDownloadsFromPresentFiles(events) {
  for (const { url, filename } of extractPresentFilesDownloads(events)) {
    if (!collectedDownloads.has(url)) collectedDownloads.set(url, filename);
  }
}

function reportPresentFilesDiagnostic(hasPendingItems) {
  const { componentsFound, filesExtracted, rawComponents } = presentFilesDiagnostic;

  if (componentsFound === 0) {
    if (hasPendingItems) {
      console.error(
        "[下载] A2A.PresentFiles 诊断：本次 SSE 未发现 PresentFiles 组件（服务端未声明附件）。",
      );
    }
    return;
  }
  if (filesExtracted.length > 0) {
    console.error(
      `[下载] A2A.PresentFiles 诊断：命中 ${componentsFound} 个组件，列出 ${filesExtracted.length} 个文件：${filesExtracted.join(", ")}`,
    );
    return;
  }
  console.error(
    `[下载] A2A.PresentFiles 诊断：命中 ${componentsFound} 个组件，但未解析出文件叶子。原始组件结构 dump（每条最多 4000 字符）：`,
  );
  for (const raw of rawComponents.slice(0, 3)) {
    console.error(`[下载] A2A.PresentFiles raw: ${raw}`);
  }
}

export function __resetPresentFilesStateForTesting() {
  presentFilesDiagnostic.componentsFound = 0;
  presentFilesDiagnostic.filesExtracted.length = 0;
  presentFilesDiagnostic.rawComponents.length = 0;
  collectedDownloads.clear();
  textScannedDownloads.clear();
}

export function __getCollectedDownloadsForTesting() {
  return {
    presentFiles: Array.from(collectedDownloads, ([url, filename]) => ({ url, filename })),
    textScanned: Array.from(textScannedDownloads, ([url, filename]) => ({ url, filename })),
    componentsFound: presentFilesDiagnostic.componentsFound,
  };
}

function sanitizeFilename(name) {
  let s = String(name || "").trim();
  s = s.replace(/[\x00-\x1f<>:"/\\|?*]+/g, "_");
  s = s.replace(/^[\s.]+|[\s.]+$/g, "");
  return s || "downloaded";
}

function resolveUniqueTargetPath(dir, filename) {
  const safe = sanitizeFilename(filename);
  let candidate = join(dir, safe);
  if (!existsSync(candidate)) return candidate;

  const { name, ext } = parsePath(safe);
  let idx = 1;
  while (true) {
    candidate = join(dir, `${name} (${idx})${ext}`);
    if (!existsSync(candidate)) return candidate;
    idx++;
  }
}

function resolveDownloadDir() {
  const homeAgents = join(homedir(), ".agents", "download");
  try {
    mkdirSync(homeAgents, { recursive: true });
    return homeAgents;
  } catch (err) {
    console.error(`[download] 无法创建用户目录 ${homeAgents}: ${err.message}`);
  }

  const fallback = join(SKILL_DIR, "downloads");
  try {
    mkdirSync(fallback, { recursive: true });
    return fallback;
  } catch (err) {
    console.error(`[download] 降级目录 ${fallback} 亦不可用: ${err.message}`);
    return null;
  }
}

async function downloadFileWithAuth(url, targetPath, apiKey) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error("响应体为空");
  }

  const fileStream = createWriteStream(targetPath);
  try {
    await pipeline(Readable.fromWeb(res.body), fileStream);
  } catch (err) {
    try {
      unlinkSync(targetPath);
    } catch {}
    throw err;
  }
}

async function downloadCollectedFiles(apiKey) {
  const presentFilesFound = presentFilesDiagnostic.componentsFound > 0;
  const downloadEntries = presentFilesFound
    ? Array.from(collectedDownloads.entries())
    : Array.from(textScannedDownloads.entries());

  reportPresentFilesDiagnostic(downloadEntries.length > 0);

  if (downloadEntries.length === 0) return;

  const downloadDir = resolveDownloadDir();
  if (!downloadDir) {
    console.error("[download] 没有可用的下载目录，跳过自动下载。");
    return;
  }

  console.log(
    `\n[download] 发现 ${downloadEntries.length} 个待下载文件，正在拉取到本地目录 ${downloadDir} ...`,
  );

  for (const [url, filename] of downloadEntries) {
    const targetPath = resolveUniqueTargetPath(downloadDir, filename);
    process.stdout.write(`  - 正在下载 "${filename}" ... `);
    try {
      await downloadFileWithAuth(url, targetPath, apiKey);
      const size = statSync(targetPath).size;
      const sizeKb = (size / 1024).toFixed(1);
      console.log(`完成 (${sizeKb} KB) -> ${targetPath}`);
      console.log(
        `    [本地预览] ${formatLocalFileLink(targetPath)}`,
      );
    } catch (err) {
      console.log(`失败: ${err.message}`);
      console.error(
        `    下载地址: ${url}\n    提示: 该链接需携带 Authorization: Bearer <WIND_API_KEY> 请求头方可访问。`,
      );
    }
  }
}

function formatResultErrorNotice(kind, rawText) {
  const rechargeNotice = `\n\n充值入口：${WIND_AIFINMARKET_CREDITS}（访问后登录账户即可充值积分）`;
  switch (kind) {
    case "points":
      return (
        `[服务端提示: 积分不足 (退出码=${EXIT_SERVER_BLOCKED})]\n` +
        `${rawText}\n` +
        `【重要】此任务无法通过重试恢复，请先充值积分再运行。${rechargeNotice}`
      );
    case "quota":
      return (
        `[服务端提示: 额度已达限额 (退出码=${EXIT_SERVER_BLOCKED})]\n` +
        `${rawText}\n` +
        `今日限额已满，若急需使用请前往充值或明日再试。${rechargeNotice}`
      );
    case "concurrency":
      return (
        `[服务端提示: 并发限制 (退出码=${EXIT_SERVER_BLOCKED})]\n` +
        `${rawText}\n` +
        `当前已有同类任务正在执行，请稍后等待前序任务完成后再试。`
      );
    case "busy":
      return (
        `[服务端提示: 服务繁忙 (退出码=${EXIT_SERVER_BLOCKED})]\n` +
        `${rawText}\n` +
        `服务端当前处理压力较大，请稍候重试。`
      );
    default:
      return `request failed (result.isError):\n${rawText}`;
  }
}

export function emitParsedEvents(events) {
  logWindTrialQuotaIfPresent(events);
  refreshSessionContextIdFromEvents(events);
  accumulateDownloadsFromPresentFiles(events);

  for (const ev of events) {
    if (ev?.error != null) {
      const err = ev.error;
      const msg =
        typeof err === "object"
          ? err.message || JSON.stringify(err)
          : String(err);
      console.error(`request failed (jsonrpc error): ${msg}`);
      process.exitCode = 1;
      return;
    }
    if (isResultError(ev)) {
      const errText = extractResultErrorText(ev) || JSON.stringify(ev.result);
      const { kind, exitCode } = classifyResultError(errText);
      console.error(formatResultErrorNotice(kind, errText));
      process.exitCode = exitCode;
      return;
    }
  }

  const values = extractAgentResultValues(events);
  if (values.length > 0) {
    agentResultSeen = true;
  }
  for (const text of values) {
    const downloadDir = resolveDownloadDir();
    accumulateDownloadsFromText(text);
    console.log(
      `agentResult.value: ${sanitizeAgentResultTextForDelivery(text, downloadDir)}`,
    );
  }
}

export function consumeNonStreamBody(bodyText) {
  try {
    const events = parseSsePayload(bodyText);
    if (events.length > 0) {
      emitParsedEvents(events);
      return;
    }

    try {
      const json = JSON.parse(bodyText);
      emitParsedEvents([json]);
      return;
    } catch {}

    console.log(bodyText);
  } catch (err) {
    if (
      err instanceof WindTrialQuotaExceeded ||
      err?.name === "WindTrialQuotaExceeded"
    ) {
      console.error(
        formatResultErrorNotice("quota", WIND_TRIAL_DAY_QUOTA_SNIPPET),
      );
      process.exitCode = EXIT_SERVER_BLOCKED;
      return;
    }
    throw err;
  }
}

async function drainSseStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        emitParsedEvents(parseSsePayload(trimmed));
      }
    }

    buffer += decoder.decode();
    const trimmed = buffer.trim();
    if (trimmed) {
      emitParsedEvents(parseSsePayload(trimmed));
    }
  } catch (err) {
    if (
      err instanceof WindTrialQuotaExceeded ||
      err?.name === "WindTrialQuotaExceeded"
    ) {
      await reader.cancel().catch(() => {});
      console.error(
        formatResultErrorNotice("quota", WIND_TRIAL_DAY_QUOTA_SNIPPET),
      );
      process.exitCode = EXIT_SERVER_BLOCKED;
      return;
    }
    throw err;
  }
}

export async function main() {
  const cli = parseArgs(process.argv);

  if (cli.help) {
    console.log(usage());
    return;
  }

  if (cli.listExperts || cli.command === "list-experts") {
    printExpertsTable();
    return;
  }

  if (cli.errors && cli.errors.length > 0) {
    for (const err of cli.errors) {
      console.error(`[error] ${err}`);
    }
    console.log(usage());
    process.exitCode = 2;
    return;
  }

  const prompt = cli.prompt;
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    console.error("[error] 必须提供提问内容（使用 --prompt 或 -p 指定）。");
    console.log(usage());
    process.exitCode = 2;
    return;
  }

  let selectedExpert = null;

  if (cli.expert) {
    const resolved = resolveExpert(cli.expert);
    if (!resolved.matched) {
      console.error(
        `[error] 未知专家名称 "${cli.expert}"。为避免浪费积分，已终止调用。\n` +
        `支持的专家：经济研究专家(aecr)、个股研究专家(aere)、行业研究专家(aeir)、市场监测专家(amme)、会议专家(ame)、财富管理顾问(awa)。\n` +
        `请执行 \`node scripts/alice-experts.mjs list-experts\` 查看全部 6 位专家详细信息与别名。`
      );
      process.exitCode = 2;
      return;
    }
    selectedExpert = resolved.expert;
    if (resolved.matchedBy === "alias") {
      console.error(
        `[info] --expert "${cli.expert}" 已解析为「${selectedExpert.nameZh}」(${selectedExpert.activeSubAgent})`,
      );
    } else {
      console.error(
        `[info] 正在调用万得 Alice「${selectedExpert.nameZh}」(${selectedExpert.activeSubAgent})`,
      );
    }
  } else {
    // 未显式指定 --expert，尝试智能自动识别
    const detected = detectExpertFromPrompt(prompt);
    if (detected) {
      selectedExpert = detected;
      console.error(
        `[info] 未显式指定 --expert，已根据提问内容自动识别专家为「${selectedExpert.nameZh}」(${selectedExpert.activeSubAgent})`,
      );
    } else {
      console.error(
        `[info] 未指定 --expert 且未匹配到专属专家关键词，将以通用 auto 模式调用万得 Alice。`,
      );
    }
  }

  const url = getApiUrl();
  const apiKey = getApiKey();
  const headers = buildHeaders(apiKey);
  const body = buildBody(prompt, selectedExpert, { reuseContextId: cli.contextId });

  currentSessionContextId = body?.params?.message?.contextId ?? null;
  console.error(`[info] 会话上下文 (contextId): ${currentSessionContextId}`);

  const MAX_RETRIES = 10;
  let taskCreatedOnServer = false;
  agentResultSeen = false;

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * attempt, 10000);
        console.error(
          `[reconnect] attempt ${attempt}/${MAX_RETRIES}, waiting ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // 仅当服务端已成功建立任务且中途断流时，才走 tasks/resubscribe；
      // 首请求遇到网络失败、DNS 异常或 502/500 网关错误时，服务端未创建任务，重试必须重发原始请求体。
      const requestBody =
        taskCreatedOnServer ? resubscribeBody({ params: body }) : body;

      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });
      } catch (e) {
        console.error(`[network error] ${e.message}`);
        if (attempt < MAX_RETRIES) continue;
        console.error("max retries exceeded");
        process.exitCode = 1;
        return;
      }

      console.log("status:", response.status, response.statusText);
      console.log(
        "headers:",
        Object.fromEntries(response.headers.entries()),
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("request failed:");
        console.error(errorText);
        if (response.status >= 500 && attempt < MAX_RETRIES) continue;
        process.exitCode = 1;
        return;
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const useSseReader =
        contentType.includes("text/event-stream") && response.body != null;

      if (useSseReader) {
        taskCreatedOnServer = true;
        let streamError = null;
        try {
          await drainSseStream(response);
        } catch (e) {
          streamError = e;
        }

        if (streamError) {
          if (
            streamError instanceof WindTrialQuotaExceeded ||
            streamError?.name === "WindTrialQuotaExceeded"
          ) {
            console.error(
              formatResultErrorNotice("quota", WIND_TRIAL_DAY_QUOTA_SNIPPET),
            );
            process.exitCode = EXIT_SERVER_BLOCKED;
            return;
          }
          console.error(`[stream error] ${streamError.message}`);
          if (attempt < MAX_RETRIES) continue;
          console.error("max retries exceeded");
          process.exitCode = 1;
          return;
        }

        // 若流内已触发明确错误（如积分不足/体验期限额 exitCode=75），直接退出，不重试
        if (process.exitCode && process.exitCode !== 0) {
          return;
        }

        // 流正常 EOF，但整轮未收到任何 agentResult 最终结果（防止空流退出码 0 假成功）
        if (!agentResultSeen) {
          console.error(
            `[stream error] SSE 流已结束，但未收到 agentResult 结果事件。`,
          );
          if (attempt < MAX_RETRIES) {
            console.error(
              `[reconnect] 尚未收到完整分析报告，将尝试重连该任务...`,
            );
            continue;
          }
          console.error(
            "[stream error] 已达最大重试次数，仍未收到 agentResult，任务执行失败。",
          );
          process.exitCode = 1;
          return;
        }

        await downloadCollectedFiles(apiKey);
        return;
      }

      let bodyText;
      try {
        bodyText = await response.text();
      } catch (e) {
        console.error(`[read body error] ${e.message}`);
        if (attempt < MAX_RETRIES) continue;
        console.error("max retries exceeded");
        process.exitCode = 1;
        return;
      }

      taskCreatedOnServer = true;
      consumeNonStreamBody(bodyText);

      if (process.exitCode && process.exitCode !== 0) {
        return;
      }

      if (!agentResultSeen) {
        console.error(
          "[stream error] 响应已结束，但未收到任何有效 agentResult 结果事件。",
        );
        process.exitCode = 1;
        return;
      }

      await downloadCollectedFiles(apiKey);
      return;
    }
  } finally {
    spawnUpdateCheck();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error("request error:");
    console.error(error);
    process.exitCode = 1;
  });
}
