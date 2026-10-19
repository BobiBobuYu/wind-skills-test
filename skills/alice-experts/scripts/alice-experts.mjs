#!/usr/bin/env node
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// 稳定 CLI 入口：把参数转给 request.js（真正的请求 + SSE 解析在那边）。
// 必须 await 子进程退出，否则在某些 Windows / IDE 终端下父进程会先结束，
// 看到的只有 status/headers，后续流式正文被截断。

const requestEntrypoint = new URL("./request.js", import.meta.url);

const args = process.argv.slice(2);

const isHelp = args.length === 0 || args.includes("--help") || args.includes("-h");
if (isHelp) {
  console.log(
    [
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
      "  --expert, -e <EXPERT_NAME>     指定调用的专家，支持中英文名称、专家 ID 或口语别名：",
      '                                   · 经济研究专家 / economic-research / aecr',
      '                                   · 个股研究专家 / equity-deep-research-agent / aere',
      '                                   · 行业研究专家 / industry-research / aeir',
      '                                   · 市场监测专家 / market-monitoring / amme',
      '                                   · 会议专家     / meeting / ame',
      '                                   · 财富管理顾问 / advisor / awa',
      "                                 不传则由 CLI 结合提问关键词自动智能路由；传错专家名将严格报错拦截",
      "  --context-id, -c <CONTEXT_ID>  会话上下文 ID（可选，用于多轮对话或补充回答专家的澄清问题）",
      "  --list-experts                 列出全部 6 个专家的能力与触发信息",
      "  --help,   -h                   查看帮助",
      "",
      "Examples:",
      '  node scripts/alice-experts.mjs --prompt "帮我整理美国本周公布的主要经济数据和下周的公布日程" --expert "经济研究专家"',
      '  node scripts/alice-experts.mjs --prompt "做一份英伟达（NVDA.O）最新的Q3业绩前瞻" -e "个股研究专家"',
      '  node scripts/alice-experts.mjs --prompt "从零研究低空经济行业并形成景气判断" -e "industry-research"',
      '  node scripts/alice-experts.mjs -p "帮我设置贵州茅台跌破20日均线提醒" -e "市场监测专家"',
      '  node scripts/alice-experts.mjs -p "未来一周有哪些上市公司业绩会召开？" -e "会议专家"',
      '  node scripts/alice-experts.mjs -p "帮我创建一个客户【张三】，持仓包含10万元国金量化多因子A" -e "财富管理顾问"',
      '  node scripts/alice-experts.mjs -p "未来一周有哪些上市公司业绩会召开？"  # 自动智能路由至会议专家',
      "  node scripts/alice-experts.mjs list-experts",
      "",
      "Config:",
      "  优先读取 %USERPROFILE%\\.wind-aifinmarket\\config.env 或 config (dotenv: WIND_API_KEY=...),",
      "  再读取 skill 目录 config.json (wind_api_key),",
      "  最后读取 WIND_API_KEY 环境变量",
    ].join("\n"),
  );
  process.exitCode = args.length === 0 ? 2 : 0;
} else {
  const nodePath = process.execPath;
  const { spawn } = await import("node:child_process");
  const child = spawn(
    nodePath,
    [fileURLToPath(requestEntrypoint), ...args],
    { stdio: "inherit" },
  );
  child.once("error", (err) => {
    console.error("spawn failed:", err.message);
    process.exitCode = 1;
  });
  const [code, signal] = await once(child, "exit");
  process.exitCode = signal ? 1 : (code ?? 1);
}
