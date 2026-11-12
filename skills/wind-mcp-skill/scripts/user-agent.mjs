// ============================================================================
// user-agent.mjs —— 识别调用 CLI 的 AI agent，作为请求头 User-Agent
// ----------------------------------------------------------------------------
// 只读本进程的环境变量和祖先进程，不联网；结果只进请求头，不进任何查询参数。没有手动指定的参数，每次调用自动识别。
// 依次看：显式声明（WIND_AGENT / AI_AGENT）> 进程树 > agent 环境变量 > IDE 兜底，命中即停；都没命中为 Unknown-Agent。
// 显式声明是调用方主动写给我们的，所以排第一；其余三层都是推断。
// 任何一层出错都只跳过该层，不影响取数。
// ============================================================================
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// ------------------------------ 识别规则 ------------------------------

// 进程名 → agent 名。只按可执行文件名或脚本文件名精确匹配（区分大小写），不在整条命令行里搜子串，
// 避免 `bash -c "cd ~/claude-notes && ..."` 这类路径被误判。
const PROCESS_NAMES = new Map(Object.entries({
  claude: 'claude-code',
  codex: 'codex',
  gemini: 'gemini-cli',
  'cursor-agent': 'cursor-cli',
  opencode: 'opencode',
  copilot: 'github-copilot-cli',
  auggie: 'augment',
  qwen: 'qwen-code',
  iflow: 'iflow-cli',
  kimi: 'kimi-cli',
  kimi_code: 'kimi-code',
  codebuddy: 'codebuddy',
  qodercli: 'qoder',
  openclaw: 'openclaw',
  hermes: 'hermes',
  goose: 'goose',
  aider: 'aider',
  amp: 'amp',
  crush: 'crush',
  droid: 'droid',
  cline: 'cline',
}));

// node 直接跑包内入口（进程名是 node、脚本名是 index / cli）时，按脚本路径里的 npm 包名识别。
const PACKAGE_PATHS = Object.freeze([
  ['/@anthropic-ai/claude-code/', 'claude-code'],
  ['/@openai/codex/', 'codex'],
  ['/@google/gemini-cli/', 'gemini-cli'],
]);

// agent 注入子进程的环境变量，按顺序判断。`KEY` 表示非空即命中，`KEY=value` 表示必须等于该值。
// 取自 @vercel/detect-agent 1.2.7（CODEX_SANDBOX_NETWORK_DISABLED 取自 Codex 文档）。IDE 变量（CURSOR_TRACE_ID 等）
// 放到最后一层，否则在 Cursor 终端里跑的 Claude Code 会被算成 cursor。
const ENV_RULES = Object.freeze([
  ['CURSOR_AGENT', 'cursor-cli'],
  ['CURSOR_EXTENSION_HOST_ROLE=agent-exec', 'cursor-cli'],
  ['GEMINI_CLI', 'gemini-cli'],
  ['CODEX_SANDBOX', 'codex'],
  ['CODEX_CI', 'codex'],
  ['CODEX_THREAD_ID', 'codex'],
  ['CODEX_SANDBOX_NETWORK_DISABLED', 'codex'],
  ['ANTIGRAVITY_AGENT', 'antigravity'],
  ['AUGMENT_AGENT', 'augment'],
  ['OPENCODE=1', 'opencode'],
  ['OPENCODE_CLIENT', 'opencode'],
  ['CLAUDECODE', 'claude-code'],
  ['CLAUDE_CODE', 'claude-code'],
  ['COPILOT_MODEL', 'github-copilot-cli'],
  ['COPILOT_ALLOW_ALL', 'github-copilot-cli'],
  ['COPILOT_GITHUB_TOKEN', 'github-copilot-cli'],
  ['QODER_WORK_INTEGRATION_PRODUCT', 'qwenwork'],
  ['WORKBUDDY_APP_NAME', 'workbuddy'],
  ['KIMI_CODE_HOME', 'kimi-code'],
]);

// 自带 agent 的 VS Code 系 IDE。它们的终端都报 TERM_PROGRAM=vscode，要看 git askpass 路径里的程序名区分。
const AGENT_IDES = Object.freeze(['cursor', 'windsurf', 'trae', 'kiro', 'qoder', 'codebuddy', 'antigravity']);

// ------------------------------ 进程树 ------------------------------

const MAX_DEPTH = 8;
const PS_TIMEOUT_MS = 500;
const INTERPRETER = /^(node|nodejs|bun|deno|pypy3?|python[\d.]*)$/;

function fileName(path) {
  return String(path).split(/[\\/]/).pop().replace(/^-/, '').replace(/\.(exe|cmd|bat|js|mjs|cjs|py)$/i, '');
}

// Linux：直接读 /proc，不起子进程。
function procAncestors(startPid) {
  const out = [];
  for (let pid = startPid; pid > 1 && out.length < MAX_DEPTH;) {
    let stat;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      break;
    }
    // comm 本身可能含空格和括号，所以 ppid 取最后一个 ')' 之后的第 2 个字段。
    const close = stat.lastIndexOf(')');
    const comm = stat.slice(stat.indexOf('(') + 1, close);
    const ppid = Number(stat.slice(close + 2).split(' ')[1]);
    let argv = [];
    try {
      argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    } catch {
      // 读不到命令行时只用 comm。
    }
    out.push({ pid, comm, argv });
    pid = ppid;
  }
  return out;
}

// macOS 等其他 Unix：一次 ps 拿全表再在内存里往上走，避免每层起一次子进程。
// ps 只给空格拼接的命令行，路径带空格时会被切开；这里只用程序名和脚本名，影响不大。
function psAncestors(startPid) {
  const text = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args='], {
    encoding: 'utf8', timeout: PS_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const table = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), args: m[3] });
  }
  const out = [];
  for (let pid = startPid; pid > 1 && out.length < MAX_DEPTH && table.has(pid);) {
    const { ppid, args } = table.get(pid);
    out.push({ pid, comm: '', argv: args.trim().split(/\s+/) });
    pid = ppid;
  }
  return out;
}

// Windows 查进程树要起 PowerShell，代价太大，只靠环境变量。
function defaultAncestors(platform, ppid) {
  if (platform === 'win32') return [];
  return platform === 'linux' ? procAncestors(ppid) : psAncestors(ppid);
}

// 一个祖先进程是不是 agent：依次看脚本名、可执行文件名、comm，最后看脚本路径里的包名。
function matchProcess(proc) {
  const exe = fileName(proc.argv[0] || proc.comm || '');
  const scriptArg = INTERPRETER.test(exe) ? proc.argv.slice(1).find((arg) => !arg.startsWith('-')) : undefined;
  for (const name of [scriptArg && fileName(scriptArg), exe, proc.comm && fileName(proc.comm)]) {
    if (name && PROCESS_NAMES.has(name)) return { agent: PROCESS_NAMES.get(name) };
  }
  const scriptPath = scriptArg?.replaceAll('\\', '/');
  const pkg = scriptPath && PACKAGE_PATHS.find(([segment]) => scriptPath.includes(segment));
  return pkg ? { agent: pkg[1] } : null;
}

// ------------------------------ 各层 ------------------------------

// HTTP 头只能放 Latin-1 且不能有换行；这里收得更窄，只留 UA 里安全的字符，其余替换成 "-"。
function clean(value, max = 40) {
  if (typeof value !== 'string') return null;
  const out = value.replace(/[^\w.-]+/g, '-').slice(0, max).replace(/^[-.]+|[-.]+$/g, '');
  return out || null;
}

// 显式声明：WIND_AGENT 留给集成方自己设（name 或 name/version），AI_AGENT 是各家 agent 的通用约定。
// Claude Code 的写法是 claude-code_2-1-296_agent。
function fromDeclared(env) {
  for (const key of ['WIND_AGENT', 'AI_AGENT']) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    const claude = raw.match(/^(.+?)_(\d+(?:-\d+)+)_agent$/);
    const slash = raw.indexOf('/');
    const [agent, version] = claude ? [claude[1], claude[2].replaceAll('-', '.')]
      : slash > 0 ? [raw.slice(0, slash), raw.slice(slash + 1) || null]
        : [raw, null];
    if (clean(agent)) return { agent, version };
  }
  return null;
}

// 离调用方最近的 agent 进程获胜。排在 agent 自动注入的环境变量前：这些变量会被嵌套的外层 agent 继承，
// 也会被 fork 出来的 CLI 原样沿用（如 Gemini CLI 的分支），进程名更准。
function fromProcessTree(listAncestors) {
  for (const proc of listAncestors()) {
    const hit = matchProcess(proc);
    if (hit) return hit;
  }
  return null;
}

function fromEnv(env) {
  for (const [rule, agent] of ENV_RULES) {
    const [key, want] = rule.split('=');
    if (want === undefined ? env[key] : env[key] === want) return { agent };
  }
  return null;
}

// 只有 IDE 信号时兜底当 agent，信号最弱：人在这些 IDE 的终端里手动跑也会命中。原版 VS Code 不算 agent。
function fromIde(env) {
  if (env.CURSOR_TRACE_ID) return { agent: 'cursor' };
  if (env.TERM_PROGRAM !== 'vscode') return null;
  const appPath = `${env.VSCODE_GIT_ASKPASS_NODE || ''} ${env.VSCODE_GIT_ASKPASS_MAIN || ''}`.toLowerCase();
  const ide = AGENT_IDES.find((name) => appPath.includes(name));
  return ide ? { agent: ide } : null;
}

// ------------------------------ 入口 ------------------------------

/**
 * 自动识别调用方 agent，返回形如 `claude-code/2.1.296` 的字符串；拿不到版本时只有名字（`codex`），
 * 认不出时为 `unknown`。只含 [A-Za-z0-9_./-]，可直接放进 HTTP 头。参数都可注入，便于离线测试。
 */
export function detectAgent({
  env = process.env,
  platform = process.platform,
  ppid = process.ppid,
  listAncestors,
} = {}) {
  const layer = (fn) => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  const ancestors = listAncestors || (() => defaultAncestors(platform, ppid));
  const hit = layer(() => fromDeclared(env))
    || layer(() => fromProcessTree(ancestors))
    || layer(() => fromEnv(env))
    || layer(() => fromIde(env));
  let agent = clean(hit?.agent.toLowerCase()) || 'unknown';
  if (agent === 'claude-code' && env.CLAUDE_CODE_IS_COWORK) agent = 'claude-cowork';
  const version = clean(hit?.version, 32);
  return version ? `${agent}/${version}` : agent;
}

/**
 * 本次请求的 User-Agent；认不出调用方时为 Unknown-Agent。
 */
export function resolveUserAgent({ env = process.env, detect = detectAgent } = {}) {
  let detected = 'unknown';
  try {
    detected = detect({ env });
  } catch {
    // 识别失败不影响取数。
  }
  return detected === 'unknown' ? 'Unknown-Agent' : detected;
}
