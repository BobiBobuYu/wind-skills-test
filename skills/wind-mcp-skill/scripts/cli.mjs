#!/usr/bin/env node
// ============================================================================
// cli.mjs —— wind-mcp-skill 命令行入口（个人版 4.0.0）
// ----------------------------------------------------------------------------
// 取数两步：search 找工具（market_search_tools）→ call 调用取数（market_call_tool）。
// 输出约定：
//   成功：退出码 0，stdout 是 Wind 返回的 content 文本原文，不解析、不改写，多长都整段输出。
//   失败：退出码 1，stdout 是一行 {"ok":false,"code","message",...}。message 写明原因和建议，
//         Wind 返回的错误原样照搬；code 是错误类别：
//           TOOL_ERROR         Wind 返回了错误，status 是 Wind 的 code（400、422、429、5xx…）
//           AUTH_ERROR         认证失败：API Key 未配置、含非法字符、无效或过期（401）
//           PERMISSION_DENIED  权限不足：Key 有效，但账号没有开通该能力（403）
//           SERVICE_ERROR      HTTP 层失败、返回无法解析     NETWORK_ERROR / TIMEOUT  连不上 / 超时
//           USAGE_ERROR        命令或参数写法有误            其余（SETUP_ERROR 等）只出现在对应命令里
// 分工：本文件管命令、参数、输出和触发自动更新；mcp.mjs 管凭证、传输和结果；
//       user-agent.mjs 识别调用方 agent；update-check.mjs 是后台更新脚本。不写日志。
// 环境变量（都可不设）：
//   WIND_API_KEY            API Key，优先级最低（全局配置 > Skill 本地 config.json > 本变量）
//   WIND_SKILL_AUTO_UPDATE  设 0 关闭自动更新（在代码仓库里直接运行时要设，否则会对仓库目录执行 npx skills）
//   WIND_SEARCH_TIMEOUT_MS、WIND_CALL_TIMEOUT_MS  search / call 超时（毫秒）
//   WIND_MCP_ENDPOINT       只用于测试或私有部署
// ============================================================================
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CALL_TOOL, CliError, SEARCH_TOOL, SKILL_DIR, SKILL_VERSION,
  callGatewayTool, credentialSummary, interpretResult, openDeveloperPortal, writeApiKey,
} from './mcp.mjs';
import { resolveUserAgent } from './user-agent.mjs';

// ------------------------------ 常量 ------------------------------

const MIN_NODE_MAJOR = 18;
const SEARCH_TIMEOUT_MS = Number(process.env.WIND_SEARCH_TIMEOUT_MS) || 60_000;
const CALL_TIMEOUT_MS = Number(process.env.WIND_CALL_TIMEOUT_MS) || 180_000;
const DATA_COMMANDS = new Set(['search', 'discover', 'call']);

// 2.x / 3.0.0 按 server_type 调用时用过的名字。旧会话里的 agent 可能还按旧方式调用，给出改用 search + call 的提示。
const LEGACY_SERVER_TYPES = new Set([
  'global_securities', 'stock_data', 'fund_data', 'index_data', 'bond_data', 'financial_docs',
  'economic_data', 'analytics_data', 'stock_research', 'fund_research', 'options_data',
  'futures_data', 'company_data', 'general_data', 'edb_data', 'wind_tools', 'wind-tools',
]);
const LEGACY_HINT = `wind-mcp-skill 已更新到 ${SKILL_VERSION}：不再按 server_type 调用，也不再提供 list-tools / list-servers。` +
  '请重新读取本 Skill 的 SKILL.md，改用两步：node scripts/cli.mjs search "<要查的数据>" 找到工具，' +
  "再 node scripts/cli.mjs call <toolName> '<参数JSON>' 取数。";

// ------------------------------ 输出 ------------------------------

function writeLine(text) {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

// search / call 的结果是 Wind 返回的原文，照原样输出；其他命令的结果是对象，转成一行 JSON。
// 不截断、不转存：超长输出交给 agent 宿主处理（如 Claude Code 会自己存成文件，给模型路径和开头一段）。
function printResult(data) {
  writeLine(typeof data === 'string' ? data : JSON.stringify(data));
}

function fail(err) {
  const known = err instanceof CliError;
  const code = known ? err.code : 'LOCAL_ERROR';
  const out = { ok: false, code, message: known ? err.message : String(err?.message ?? err), ...(known ? err.extra : {}) };
  // 认证失败时带上当前生效的 Key 来源：过期的全局 Key 会盖住环境变量里的新 Key，用户自己看不出来。
  if (code === 'AUTH_ERROR') out.api_key = credentialSummary();
  writeLine(JSON.stringify(out));
  process.exitCode = 1;
}

// ------------------------------ 输入 ------------------------------
// 参数和问题都直接写在命令行上，不读文件、不读 stdin。

// 参数写法的提示：bash / zsh 用单引号包标准 JSON；PowerShell、cmd 会吃掉 JSON 里的双引号，
// 改成外层双引号、里面的字符串用单引号。值里要带单引号时，任何 shell 都用外层双引号、单引号写成 \'。
// 不推荐 \u0027 这类转义：agent 的工具调用参数是 JSON，\uXXXX 常在到达 shell 之前就被还原成原字符（11-10 第四轮实测）。
const PARAMS_HINT = `参数是一个 JSON 对象，用单引号包起来写在工具名后面：'{"windCodes":["600519.SH"]}'。` +
  `在 Windows 的 PowerShell 或 cmd 里双引号会被吃掉，改成外层双引号、里面的字符串用单引号："{'windCodes':['600519.SH']}"。` +
  `值里要带单引号时，任何 shell 都用外层双引号的写法，单引号写成 \\'。`;

// 把单引号字符串（'…'）转成标准 JSON 的双引号字符串；双引号字符串原样保留。\uXXXX 原样保留给 JSON.parse；\' 仍按单引号处理。
// 只在按标准 JSON 解析失败后才用，标准 JSON 不受影响。
function singleQuotedToJson(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (ch === "'") {
      let body = '';
      for (i++; i < text.length && text[i] !== "'"; i++) {
        if (text[i] === '\\' && text[i + 1] === "'") { body += "'"; i++; }
        else if (text[i] === '\\') { body += text[i] + (text[i + 1] ?? ''); i++; }
        else if (text[i] === '"') body += '\\"';
        else body += text[i];
      }
      out += `"${body}"`;
    } else {
      out += ch;
    }
  }
  return out;
}

function parseParams(text) {
  let params;
  try {
    params = JSON.parse(text);
  } catch (err) {
    try {
      params = JSON.parse(singleQuotedToJson(text));
    } catch {
      throw new CliError('USAGE_ERROR', `参数不是合法 JSON（${err.message}），收到：${text.slice(0, 200)}。${PARAMS_HINT}`);
    }
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new CliError('USAGE_ERROR', '参数必须是 JSON 对象（花括号包起来的 键:值），工具没有参数时写 {}。');
  }
  return params;
}

function parseSearchArgs(args) {
  const words = [];
  let topK;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const m = arg.match(/^--top[-_]?k(?:=(.*))?$/i);
    if (m) {
      if (topK !== undefined) throw new CliError('USAGE_ERROR', '--top-k 只能传一次。');
      const value = m[1] !== undefined ? m[1] : args[++i];
      if (!/^\d+$/.test(value || '') || Number(value) < 1 || Number(value) > 10) {
        throw new CliError('USAGE_ERROR', '--top-k 必须是 1–10 的整数。');
      }
      topK = Number(value);
    } else if (arg.startsWith('--')) {
      throw new CliError('USAGE_ERROR', `search 不支持选项 ${arg}。用法：search "<要查的数据>" [--top-k N]`);
    } else {
      words.push(arg);
    }
  }
  if (words.length === 0) throw new CliError('USAGE_ERROR', '用法：search "<要查的数据>" [--top-k N]');
  // 多个词按空格拼成一句。个别执行器会改写命令的编码，SKILL 让 agent 这时把中文写成 \uXXXX，这里还原；
  // 单引号写成 \' 的也还原，和 call 参数的写法一致。
  const question = words.join(' ').trim()
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\'/g, "'");
  if (!question) throw new CliError('USAGE_ERROR', '要查的数据不能为空。');
  return topK === undefined ? { question } : { question, topK };
}

// ------------------------------ 取数 ------------------------------

// 所有失败（含限流、超时、服务异常）都不在 CLI 里重试，Wind 的报错原样交给 agent 处理。

// search 的业务错误（如问题为空）放在成功结果里：{ errorCode, errorMessage, retryable, suggestedAction }。
// 转成和其他 Wind 报错一样的格式，建议并进 message。只为检查这几个字段解析，输出的仍是原文。
function searchFailure(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object' || !data.errorCode) return null;
  const reason = data.errorMessage || String(data.errorCode);
  const message = data.suggestedAction ? `${reason}。建议：${data.suggestedAction}` : reason;
  return new CliError('TOOL_ERROR', message, { search_code: data.errorCode });
}

async function cmdSearch(args, { userAgent }) {
  const toolArgs = parseSearchArgs(args);
  const text = interpretResult(await callGatewayTool(SEARCH_TOOL, toolArgs, { userAgent, timeoutMs: SEARCH_TIMEOUT_MS }));
  const failure = searchFailure(text);
  if (failure) throw failure;
  return text;
}

async function cmdCall(args, { userAgent }) {
  const [toolName, paramsInput, ...rest] = args;
  if (!toolName) throw new CliError('USAGE_ERROR', "用法：call <toolName> '<参数JSON>'；toolName 取自 search 结果。");
  if (LEGACY_SERVER_TYPES.has(toolName)) throw new CliError('LEGACY_USAGE', LEGACY_HINT);
  if (rest.length) throw new CliError('USAGE_ERROR', `call 只接受 toolName 和参数两项，多出：${rest[0]}。多半是值里的单引号或空格把参数拆开了。${PARAMS_HINT}`);
  const name = toolName.trim();
  if (!name || /\s/.test(name)) throw new CliError('USAGE_ERROR', `toolName 不能包含空白：${JSON.stringify(toolName)}`);
  // 工具没有参数时可以省略参数，按 {} 处理。网关要求 arguments 是 JSON 文本，由这里转换。
  const params = paramsInput === undefined ? {} : parseParams(paramsInput);
  const toolArgs = { toolName: name, arguments: JSON.stringify(params) };
  return interpretResult(await callGatewayTool(CALL_TOOL, toolArgs, { userAgent, timeoutMs: CALL_TIMEOUT_MS }));
}

// ------------------------------ 自动更新 ------------------------------
// 与 2.0.4 相同：当天（UTC 日期）还没成功更新过时，记下使用时间，把 update-check.mjs 复制到缓存目录后
// 以分离进程运行（更新会整体重装 Skill 目录，不能从目录内部运行），由它执行 npx skills update。
// 不阻塞取数，任何失败都忽略；Skill 目录不可写时写不进使用时间，也就不启动。

const UPDATE_CHECK_PATH = join(SKILL_DIR, 'scripts', 'update-check.mjs');
const UPDATE_STATE_FILE = join(SKILL_DIR, 'scripts', 'update-state.json');

function readUpdateState() {
  try {
    return existsSync(UPDATE_STATE_FILE) ? JSON.parse(readFileSync(UPDATE_STATE_FILE, 'utf8')) : null;
  } catch {
    return null;
  }
}

function updatedToday(state) {
  return Boolean(state && state.date === new Date().toISOString().slice(0, 10) && state.status === 'success');
}

function triggerUpdateCheck() {
  try {
    if (process.env.WIND_SKILL_AUTO_UPDATE === '0') return;
    if (!existsSync(UPDATE_CHECK_PATH)) return;
    if (updatedToday(readUpdateState())) return;
    const state = { ...(readUpdateState() || {}), lastUsedAt: new Date().toISOString(), lastUsedPid: process.pid };
    writeFileSync(UPDATE_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    const runnerDir = join(homedir(), '.cache', 'wind-aifinmarket');
    mkdirSync(runnerDir, { recursive: true });
    const runner = join(runnerDir, `update-check-${basename(SKILL_DIR)}-${process.pid}.mjs`);
    copyFileSync(UPDATE_CHECK_PATH, runner);
    const child = spawn('node', [runner, SKILL_DIR], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // 更新是尽力而为，任何失败都不影响取数。
  }
}

// ------------------------------ 其他命令 ------------------------------

async function cmdSetupKey([key, ...flags]) {
  if (!key || key.startsWith('--')) {
    throw new CliError('USAGE_ERROR', '用法：setup-key <KEY> [--scope global|skill]。默认 global，写入用户全局配置，所有 Wind Skill 共用。');
  }
  let scope = 'global';
  for (let i = 0; i < flags.length; i++) {
    const m = flags[i].match(/^--scope(?:=(.*))?$/);
    if (!m) throw new CliError('USAGE_ERROR', `setup-key 不支持 ${flags[i]}`);
    scope = m[1] !== undefined ? m[1] : flags[++i];
  }
  if (!['global', 'skill'].includes(scope)) throw new CliError('USAGE_ERROR', `--scope 只能是 global 或 skill，收到 ${scope}`);
  return writeApiKey({ key, scope });
}

function legacyCommand() {
  throw new CliError('LEGACY_USAGE', LEGACY_HINT);
}

const COMMANDS = {
  search: cmdSearch,
  discover: cmdSearch, // wind-one-mcp-skill 用过的名字，保留兼容，不写进文档
  call: cmdCall,
  'setup-key': cmdSetupKey,
  'open-portal': () => openDeveloperPortal(),
  'list-tools': legacyCommand,
  'list-servers': legacyCommand,
};

function usageText() {
  return [
    `wind-mcp-skill ${SKILL_VERSION} —— Wind 万得金融数据`,
    '',
    '取数两步：',
    '  node scripts/cli.mjs search "<要查的数据>" [--top-k N]     找工具，返回候选工具名和参数定义（params）',
    "  node scripts/cli.mjs call <toolName> '<参数JSON>'           按 params 写好参数 JSON，调用取数",
    "  PowerShell / cmd 里写成 call <toolName> \"{'key':'value'}\"（外层双引号，里面用单引号）",
    '',
    'API Key：',
    '  node scripts/cli.mjs open-portal                            打开用户页面获取 API Key',
    '  node scripts/cli.mjs setup-key <KEY> [--scope global|skill] 写入 API Key（默认 global）',
    '',
    '失败时退出码 1，输出 {"ok":false,"code","message"}：message 写明原因和建议。',
    '环境变量：WIND_API_KEY、WIND_SKILL_AUTO_UPDATE=0（关闭自动更新）',
  ].join('\n');
}

// ------------------------------ 主入口 ------------------------------

export async function main(argv) {
  // 版本检查放在最前面：后面的代码用到 Node 16.9+ 才有的 API。
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < MIN_NODE_MAJOR) throw new CliError('NODE_TOO_OLD', `需要 Node.js ${MIN_NODE_MAJOR} 或更高版本，当前是 ${process.version}。请告诉用户升级 Node.js。`);
  const [cmd, ...args] = argv;
  if (!cmd || ['help', '--help', '-h'].includes(cmd)) {
    writeLine(usageText());
    return;
  }
  const run = COMMANDS[cmd];
  if (!run) {
    if (LEGACY_SERVER_TYPES.has(cmd)) throw new CliError('LEGACY_USAGE', LEGACY_HINT);
    throw new CliError('USAGE_ERROR', `未知命令：${cmd}\n${usageText()}`);
  }
  // 每次调用自动识别调用方 agent，放进请求头 User-Agent。
  const userAgent = resolveUserAgent();
  try {
    printResult(await run(args, { userAgent }));
  } finally {
    // search / call 成功或失败都检查更新：某个版本若让调用全部失败，也要能收到修复版。
    if (DATA_COMMANDS.has(cmd)) triggerUpdateCheck();
  }
}

// 只有直接运行才执行（经软链调用时比较真实路径）；被测试 import 时无副作用。
const IS_MAIN = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (IS_MAIN) main(process.argv.slice(2)).catch(fail);
