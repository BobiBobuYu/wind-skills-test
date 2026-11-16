// ============================================================================
// mcp.mjs —— Wind 金融数据 Skill 的传输层（个人版 4.0.0：search + call）
// ----------------------------------------------------------------------------
// 分节：
//   基本信息 / 错误定义 / 凭证 / 传输 / 结果
//   - 凭证：读取顺序（全局配置 > Skill 本地 config.json > 环境变量）、setup-key 写入、open-portal
//   - 传输：每条命令向 vserver_wind_tools 发一次 tools/call。网关无状态，不做 initialize 握手，
//           身份信息（Authorization、User-Agent、clientVersion）每次请求都带上
//   - 结果：成功时原样返回 content 里的文本；Wind 返回错误时原样保留 message 和 code（见 interpretResult）
// 约定：本文件不写 stdout、不退出进程、不写日志；输出与退出码由 cli.mjs 负责。
// ============================================================================
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// ------------------------------ 基本信息 ------------------------------

export const SKILL_VERSION = '4.0.0';
// Skill 根目录：scripts/ 的上一级。
export const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// WIND_MCP_ENDPOINT 只用于测试或私有部署；默认连 Wind 主站。
export const ENDPOINT = process.env.WIND_MCP_ENDPOINT || 'https://mcp.windalice.com/vserver_wind_tools/mcp/';
export const SEARCH_TOOL = 'market_search_tools';
export const CALL_TOOL = 'market_call_tool';
const PORTAL_URL = 'https://market.windalice.com/#/user/overview';
const CREDENTIAL_ENV = 'WIND_API_KEY';


// ------------------------------ 错误定义 ------------------------------

// code 是错误类别（取值见 cli.mjs 开头）；message 写明原因和建议；extra 原样并入输出。
export class CliError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.extra = extra;
  }
}

// ------------------------------ 凭证 ------------------------------

const globalConfigFile = () => join(homedir(), '.wind-aifinmarket', 'config');
const localConfigFile = () => join(SKILL_DIR, 'config.json');

export function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// dotenv 子集：注释行、export 前缀、引号包裹（引号后可跟 # 注释）、行尾 # 注释。
function parseDotenv(content) {
  const env = {};
  for (const rawLine of stripBom(content).split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const close = value.indexOf(quote, 1);
      value = close > 0 ? value.slice(1, close) : value.slice(1);
    } else {
      const comment = value.indexOf(' #');
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    env[key] = value;
  }
  return env;
}

function readGlobalConfig() {
  try {
    const file = globalConfigFile();
    return existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {};
  } catch {
    return {};
  }
}

function readLocalConfig() {
  try {
    const file = localConfigFile();
    if (!existsSync(file)) return {};
    const cfg = JSON.parse(stripBom(readFileSync(file, 'utf8')));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {};
  }
}

// 与 2.0.4 / 3.0.0 相同的读取顺序：用户全局配置 > Skill 本地 config.json > 环境变量。
function resolveCredential() {
  const sources = [
    ['global', globalConfigFile(), () => readGlobalConfig()[CREDENTIAL_ENV]],
    ['skill', localConfigFile(), () => readLocalConfig().wind_api_key],
    ['env', CREDENTIAL_ENV, () => process.env[CREDENTIAL_ENV]],
  ];
  for (const [source, location, read] of sources) {
    const value = read();
    if (typeof value === 'string' && value.trim()) return { source, location, key: value.trim() };
  }
  return null;
}

export function credentialSummary() {
  const found = resolveCredential();
  return found
    ? { source: found.source, location: found.location, key_masked: maskKey(found.key) }
    : { source: null, checked: [globalConfigFile(), localConfigFile(), `环境变量 ${CREDENTIAL_ENV}`] };
}

// Key 只会是可打印的英文字符。从网页复制时混进全角或不可见字符，fetch 会抛 ByteString 错误，
// 被当成网络问题；这里提前拦下，报成 Key 的问题。
const KEY_PATTERN = /^[\x21-\x7e]+$/;
const SOURCE_LABELS = Object.freeze({ global: '用户全局配置', skill: 'Skill 本地 config.json', env: `环境变量 ${CREDENTIAL_ENV}` });

function getApiKey() {
  const found = resolveCredential();
  if (!found) throw new CliError('AUTH_ERROR', `未配置 API Key（已检查：用户全局配置、Skill 本地配置、环境变量 ${CREDENTIAL_ENV}）。`);
  if (!KEY_PATTERN.test(found.key)) {
    throw new CliError('AUTH_ERROR', `${SOURCE_LABELS[found.source]}里的 API Key 含有空格、全角或不可见字符，可能是复制时带进来的（${found.location}）。`);
  }
  return found;
}

// writeFileSync 的 mode 只在新建文件时生效；文件已存在时要显式收紧成仅本人可读写。
function restrictPermissions(file) {
  if (process.platform === 'win32') return;
  try { chmodSync(file, 0o600); } catch {}
}

function writeGlobalKey(file, key) {
  mkdirSync(dirname(file), { recursive: true });
  const keyLine = new RegExp(`^\\s*(export\\s+)?${CREDENTIAL_ENV}\\s*=`);
  const kept = existsSync(file)
    ? readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.length > 0 && !keyLine.test(line))
    : [];
  writeFileSync(file, [...kept, `${CREDENTIAL_ENV}=${key}`].join('\n') + '\n', { mode: 0o600 });
  restrictPermissions(file);
}

function writeLocalKey(file, key) {
  let cfg = {};
  if (existsSync(file)) {
    try {
      cfg = JSON.parse(stripBom(readFileSync(file, 'utf8')));
    } catch (err) {
      throw new CliError('SETUP_ERROR', `本地配置不是合法 JSON，已保留原文件未覆盖：${file}（${err.message}）`);
    }
  }
  writeFileSync(file, JSON.stringify({ ...cfg, wind_api_key: key }, null, 2) + '\n', { mode: 0o600 });
  restrictPermissions(file);
}

// setup-key：scope=global 写用户全局配置（所有 Wind Skill 共用），scope=skill 写本 Skill 的 config.json。
export function writeApiKey({ key, scope }) {
  const trimmed = String(key || '').trim();
  if (!KEY_PATTERN.test(trimmed)) throw new CliError('SETUP_ERROR', 'API Key 只能由可打印的英文字符组成，不能为空，也不能有空格、全角或不可见字符；请重新复制。');
  const file = scope === 'global' ? globalConfigFile() : localConfigFile();
  try {
    if (scope === 'global') writeGlobalKey(file, trimmed);
    else writeLocalKey(file, trimmed);
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError('SETUP_ERROR', `API Key 写入失败（scope=${scope}，path=${file}）：${err.message}`);
  }
  const result = { ok: true, scope, path: file, key_masked: maskKey(trimmed), next: '重试原来的 search 或 call 命令' };
  // 写进 Skill 本地配置时，全局配置里的旧 Key 优先级更高，会把这次写的盖住。
  const effective = resolveCredential();
  if (effective && effective.source !== scope) {
    result.effective_source = effective.source;
    result.warning = `已写入，但当前生效的是${SOURCE_LABELS[effective.source]}里的 Key（${maskKey(effective.key)}），它的优先级更高。` +
      '要让这次的 Key 生效，运行 setup-key <KEY>（默认写入用户全局配置）。';
    result.next = '先按 warning 处理，再重试原来的命令';
  }
  return result;
}

export async function openDeveloperPortal() {
  const platform = process.platform;
  const [bin, args] = platform === 'darwin' ? ['open', [PORTAL_URL]]
    : platform === 'win32' ? ['cmd', ['/c', 'start', '', PORTAL_URL]]
      : ['xdg-open', [PORTAL_URL]];
  let spawnError = null;
  try {
    const child = spawn(bin, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.unref();
    spawnError = await new Promise((done) => {
      child.once('error', done);
      child.once('exit', (code) => done(code ? new Error(`${bin} 退出码 ${code}`) : null));
      setTimeout(() => done(null), 1000);
    });
  } catch (err) {
    spawnError = err;
  }
  return {
    ok: true,
    opened: !spawnError,
    url: PORTAL_URL,
    message: spawnError
      ? `无法自动打开浏览器（${spawnError.message}）。请把地址 ${PORTAL_URL} 发给用户，请用户登录后复制 API Key。`
      : `已在浏览器打开 ${PORTAL_URL}。请用户登录后复制 API Key，再运行 setup-key <KEY>。`,
  };
}

// ------------------------------ 传输 ------------------------------

const MCP_HEADERS = Object.freeze({
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
});
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
let requestSeq = 0;

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
    || error?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT' || error?.cause?.code === 'UND_ERR_BODY_TIMEOUT';
}

// fetch 的网络异常统一成 NETWORK_ERROR / TIMEOUT，保留底层错误码便于排查。
function transportFailure(error, timeoutMs) {
  if (error instanceof CliError) return error;
  if (isTimeoutError(error)) {
    return new CliError('TIMEOUT', `请求 Wind 超过 ${Math.round(timeoutMs / 1000)} 秒未返回。可减少标的或缩短时间段后再试。`);
  }
  const cause = error?.cause;
  const detail = cause?.code || cause?.errors?.map((item) => item.code).filter(Boolean).join(', ') || error?.message || 'UNKNOWN';
  const proxyVar = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY'].find((name) => process.env[name]);
  const proxyNote = proxyVar ? `检测到设置了 ${proxyVar}，但 Node.js 内置的 fetch 默认不走这个代理（Node 24 起可再设 NODE_USE_ENV_PROXY=1）。` : '';
  return new CliError('NETWORK_ERROR', `无法连接 Wind 服务（${detail}）。${proxyNote}请检查网络后再试。`);
}

// SSE：按空行分块，取 id 匹配的 data 消息；纯 JSON：整体解析。
async function readRpcResponse(resp, id) {
  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const text = await resp.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new CliError('SERVICE_ERROR', '返回内容超过 32MB，请缩小查询范围。');
    try {
      return JSON.parse(text);
    } catch {
      throw new CliError('SERVICE_ERROR', `Wind 返回的内容无法解析（HTTP ${resp.status}）：${text.slice(0, 300)}`);
    }
  }
  const reader = resp.body?.getReader();
  if (!reader) throw new CliError('SERVICE_ERROR', 'Wind 返回了空的事件流。');
  const decoder = new TextDecoder();
  let buffer = '';
  let scanFrom = 0;
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new CliError('SERVICE_ERROR', '返回内容超过 32MB，请缩小查询范围。');
        // JSON 文本里的回车都是转义过的，裸 \r 只会是行尾，去掉后按 \n 分行。
        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
      }
      if (done) buffer += `${decoder.decode().replace(/\r/g, '')}\n\n`;
      let separator;
      while ((separator = buffer.indexOf('\n\n', scanFrom)) >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        scanFrom = 0;
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let message;
        try { message = JSON.parse(data); } catch (err) {
          throw new CliError('SERVICE_ERROR', `事件流里的 JSON 无法解析：${err.message}`);
        }
        if (message.id === id) return message;
      }
      if (done) throw new CliError('SERVICE_ERROR', '事件流结束，但没有收到本次请求的结果。');
      scanFrom = Math.max(0, buffer.length - 1);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// 发一条 JSON-RPC 请求。返回 { status, message }；HTTP 非 2xx 时 message 为 null、body 为原文。
async function rpc(method, params, { timeoutMs, headers = {} }) {
  const credential = getApiKey();
  const id = `${process.pid}-${Date.now()}-${++requestSeq}`;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const allHeaders = { Authorization: `Bearer ${credential.key}`, ...MCP_HEADERS, ...headers };
  let resp;
  try {
    resp = await fetch(ENDPOINT, { method: 'POST', headers: allHeaders, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw transportFailure(error, timeoutMs);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { status: resp.status, message: null, body: text };
  }
  try {
    return { status: resp.status, message: await readRpcResponse(resp, id), body: null };
  } catch (error) {
    throw error instanceof CliError ? error : transportFailure(error, timeoutMs);
  }
}

// HTTP 层的失败（网关之前的代理、鉴权页面等）。网关自身的错误走 HTTP 200 + isError，见 interpretResult。
function httpError(reply) {
  // 401/403 常返回整页 HTML，对 agent 没有信息量，不放进输出。
  const raw = (reply.body || '').trim();
  const extra = { status: reply.status, ...(raw && !raw.startsWith('<') ? { body: raw.slice(0, 1000) } : {}) };
  if (reply.status === 401) return new CliError('AUTH_ERROR', 'API Key 无效或已过期（HTTP 401）。', extra);
  if (reply.status === 403) return new CliError('PERMISSION_DENIED', '当前账号没有权限访问（HTTP 403）。', extra);
  if (reply.status === 429) return new CliError('SERVICE_ERROR', '请求过于频繁，Wind 服务暂时拒绝了这次请求（HTTP 429）。请稍后再试。', extra);
  // 502/503/504 多是短暂的（11-11 第五轮实测 3 次，重试或换工具都拿到了数据）。CLI 不自动重试：请求可能已经执行。
  if ([502, 503, 504].includes(reply.status)) {
    return new CliError('SERVICE_ERROR', `Wind 服务暂时不可用（HTTP ${reply.status}）。可以过几秒重试一次，或换个工具；仍然失败就停止调用，如实告诉用户。`, extra);
  }
  return new CliError('SERVICE_ERROR', `Wind 服务返回 HTTP ${reply.status}，请稍后再试。`, extra);
}

// 调用网关上的一个元工具（market_search_tools / market_call_tool），返回 MCP result 原文。
export async function callGatewayTool(name, args, { userAgent, timeoutMs }) {
  const params = { name, arguments: args, _meta: { clientVersion: SKILL_VERSION } };
  const reply = await rpc('tools/call', params, { timeoutMs, headers: { 'User-Agent': userAgent } });
  if (reply.message === null) throw httpError(reply);
  if (reply.message.error) {
    const err = reply.message.error;
    throw new CliError('SERVICE_ERROR', `Wind 服务返回错误：${err.message || JSON.stringify(err)}`, { rpc_code: err.code ?? null });
  }
  if (!reply.message.result || typeof reply.message.result !== 'object') {
    throw new CliError('SERVICE_ERROR', 'Wind 返回中缺少 result。');
  }
  return reply.message.result;
}

// ------------------------------ 结果 ------------------------------

function textOf(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text);
}

// 认证（401）和权限（403）单独标出：前者要重新配置 Key，后者 Key 没问题、是账号没开通。
const STATUS_CODES = Object.freeze({ 401: 'AUTH_ERROR', 403: 'PERMISSION_DENIED' });

// 成功：原样返回 content 里的文本，不解析、不改写；多段文本按换行拼接。
//       没有文本时才退而返回 structuredContent（序列化成 JSON 文本）。
// 失败：Wind 的报错都是 HTTP 200 + isError，structuredContent.code 沿用 HTTP 语义（400、401、403、422、429、5xx…，见 MCP-CODE.md）。
//       提示语已写明原因和建议，原样作为 message，code 放进 status。
export function interpretResult(result) {
  const texts = textOf(result);
  if (result?.isError === true) {
    const sc = result.structuredContent && typeof result.structuredContent === 'object' ? result.structuredContent : {};
    const status = Number(sc.code) || null;
    const message = texts.join('\n') || sc.message || 'Wind 工具返回错误，未给出原因。';
    throw new CliError(STATUS_CODES[status] || 'TOOL_ERROR', message, { status });
  }
  if (texts.length > 0) return texts.join('\n');
  if (result?.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
  throw new CliError('TOOL_ERROR', 'Wind 返回成功但没有内容。');
}
