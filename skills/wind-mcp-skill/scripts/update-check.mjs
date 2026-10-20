#!/usr/bin/env node
// Daily background updater for the personal Wind Skill.
// Download and validate the locked source before replacing the loaded directory.

import {
  closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
  statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const IS_MAIN = Boolean(process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH);
const SKILL_DIR = IS_MAIN && process.argv[2] ? resolve(process.argv[2]) : dirname(dirname(SCRIPT_PATH));
const SKILL_NAME = basename(SKILL_DIR);
const STATE_FILE = join(SKILL_DIR, 'scripts', 'update-state.json');
const CACHE_DIR = join(homedir(), '.cache', 'wind-aifinmarket');
const LOCK_FILE = join(CACHE_DIR, 'locks', `${createHash('sha256').update(normalized(SKILL_DIR)).digest('hex').slice(0, 24)}.lock`);
const DEFAULT_SOURCE = 'https://github.com/Wind-Alice/AliceMarket.git';
const LOCK_STALE_MS = 30 * 60 * 1000;
const QUIET_MS = 10 * 1000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const RETRY_BASE_MS = 30 * 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

function normalized(path) {
  const value = resolve(path).replace(/\\/g, '/');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function updateScope() {
  const override = String(process.env.WIND_SKILL_INSTALL_SCOPE || '').trim().toLowerCase();
  if (override === 'global' || override === 'project') return override;
  const rel = relative(homedir(), SKILL_DIR).split(sep);
  return rel.length === 3 && rel[0].startsWith('.') && rel[1] === 'skills' ? 'global' : 'project';
}

function projectRoot() {
  return resolve(SKILL_DIR, '..', '..', '..');
}

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter(Boolean).map((path) => resolve(path)).filter((path) => {
    const key = normalized(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lockCandidates() {
  const global = [
    process.env.XDG_STATE_HOME && join(process.env.XDG_STATE_HOME, 'skills', '.skill-lock.json'),
    join(homedir(), '.agents', '.skill-lock.json'),
  ];
  const project = [projectRoot(), process.cwd(), process.env.INIT_CWD]
    .filter(Boolean).map((root) => join(root, 'skills-lock.json'));
  const agentsRoot = `${normalized(join(homedir(), '.agents', 'skills'))}/`;
  const standardGlobal = updateScope() === 'global' && normalized(SKILL_DIR).startsWith(agentsRoot);
  return uniquePaths(standardGlobal ? [...global, ...project] : [...project, ...global]);
}

function readLockInfo() {
  const candidates = lockCandidates();
  let firstExisting = null;
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      firstExisting ||= file;
      const entry = JSON.parse(readFileSync(file, 'utf8'))?.skills?.[SKILL_NAME];
      if (entry) return { file, entry };
    } catch {}
  }
  return { file: firstExisting || candidates[0] || null, entry: null };
}

function sourceUrl(entry) {
  if (!entry) return DEFAULT_SOURCE;
  if (entry.sourceUrl) return entry.sourceUrl;
  const source = String(entry.source || '');
  if (entry.sourceType === 'github' && /^[^/\s]+\/[^/\s]+$/.test(source)) {
    return `https://github.com/${source}.git`;
  }
  if ((entry.sourceType === 'gitee' || entry.sourceType === 'git') &&
      /^[^/\s]+\/[^/\s]+$/.test(source)) {
    return `https://gitee.com/${source}.git`;
  }
  return source || DEFAULT_SOURCE;
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

function todayKey() { return new Date().toISOString().slice(0, 10); }

function retryPending(state = readState()) {
  return state?.status === 'failed' && Number.isFinite(Date.parse(state.nextRetryAt)) &&
    Date.now() < Date.parse(state.nextRetryAt);
}

function successfulToday(state = readState()) {
  return state?.date === todayKey() && state.status === 'success';
}

function alreadyUpdatedToday() {
  const state = readState();
  if (!successfulToday(state)) return false;
  const lock = readLockInfo();
  if (!lock.entry || /gitee/i.test(sourceUrl(lock.entry)) || !state.lastAppliedRemoteHead) return true;
  const head = spawnSync('git', ['ls-remote', sourceUrl(lock.entry), 'HEAD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60 * 1000, windowsHide: true,
  });
  if (head.status !== 0) return true;
  const remote = String(head.stdout || '').trim().split(/\s+/)[0];
  return !/^[0-9a-f]{40}$/i.test(remote) || remote === state.lastAppliedRemoteHead;
}

function writeState(patch) {
  const lock = readLockInfo();
  const state = {
    ...(readState() || {}), date: todayKey(), scope: updateScope(),
    lockFile: lock.file, lockFound: Boolean(lock.entry),
    source: sourceUrl(lock.entry), updatedAt: new Date().toISOString(), ...patch,
  };
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function writeUsageState() {
  const state = {
    ...(readState() || {}),
    lastUsedAt: new Date().toISOString(),
    lastUsedPid: process.pid,
  };
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export function diagnoseUpdate() {
  const lock = readLockInfo();
  const state = readState();
  const source = sourceUrl(lock.entry);
  return {
    update_scope: updateScope(), update_channel: 'personal', auto_update: 'enabled',
    update_source: source, fallback_sources: [source], update_state_file: STATE_FILE,
    update_state: state, next_update_needed: !successfulToday(state) && !retryPending(state),
    lock_file: lock.file, lock_found: Boolean(lock.entry), skill_directory: SKILL_DIR,
    project_directory: updateScope() === 'global' ? null : projectRoot(),
  };
}

export function triggerUpdateCheck() {
  try {
    if (successfulToday() || retryPending()) return;
    writeUsageState();
    mkdirSync(CACHE_DIR, { recursive: true });
    const runner = join(CACHE_DIR, `update-check-${SKILL_NAME}-${process.pid}.mjs`);
    copyFileSync(SCRIPT_PATH, runner);
    const child = spawn(process.execPath, [runner, SKILL_DIR, '--cleanup-runner'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.on('error', () => { try { unlinkSync(runner); } catch {} });
    child.unref();
  } catch {
    // Updating must never block a market-data call.
  }
}

function acquireLock() {
  mkdirSync(dirname(LOCK_FILE), { recursive: true });
  try {
    if (Date.now() - statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) unlinkSync(LOCK_FILE);
  } catch {}
  try { return openSync(LOCK_FILE, 'wx'); } catch { return null; }
}

function releaseLock(fd) {
  try { closeSync(fd); } catch {}
  try { unlinkSync(LOCK_FILE); } catch {}
}

function versionOf(dir) {
  for (const file of ['scripts/mcp.mjs', 'scripts/cli.mjs']) {
    try {
      const match = readFileSync(join(dir, file), 'utf8').match(/\bSKILL_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
      if (match) return match[1];
    } catch {}
  }
  throw new Error(`SKILL_VERSION missing in ${dir}`);
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

function packageHash(dir) {
  const hash = createHash('sha256');
  const files = [];
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      const rel = relative(dir, full).replace(/\\/g, '/');
      if (rel === 'config.json' || rel === 'scripts/update-state.json' || rel === 'scripts/update.lock') continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push({ full, rel });
    }
  }
  walk(dir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  for (const file of files) {
    hash.update(file.rel); hash.update('\0'); hash.update(readFileSync(file.full)); hash.update('\0');
  }
  return hash.digest('hex');
}

function candidatePath(cloneDir, entry) {
  const skillPath = String(entry?.skillPath || `skills/${SKILL_NAME}/SKILL.md`).replace(/\\/g, '/');
  const subdir = skillPath.endsWith('/SKILL.md') ? skillPath.slice(0, -9) : skillPath;
  if (isAbsolute(subdir) || subdir.split('/').some((part) => part === '..')) {
    throw new Error('Unsafe skillPath in lock file');
  }
  const candidate = resolve(cloneDir, subdir);
  if (!normalized(candidate).startsWith(`${normalized(cloneDir)}/`)) {
    throw new Error('Skill path escapes downloaded repository');
  }
  if (!existsSync(join(candidate, 'SKILL.md'))) throw new Error(`Skill missing at ${subdir}`);
  return candidate;
}

function cloneSource(source, dest) {
  if (!/^(https?:\/\/|ssh:\/\/|git@|file:\/\/)/i.test(source)) {
    throw new Error('Unsupported Skill source URL');
  }
  const result = spawnSync('git', ['clone', '--depth', '1', '--quiet', source, dest], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git clone failed: ${(result.stderr || result.error?.message || '').trim().slice(-500)}`);
  }
  const head = spawnSync('git', ['-C', dest, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  return head.status === 0 ? head.stdout.trim() : null;
}

function installSourceInStaging(source, fetchDir) {
  // Preserve the 2.0.4 add fallback for Git credentials and transport issues,
  // while keeping installation confined to a temporary project and one source.
  if (!/^[A-Za-z0-9_./:@%-]+$/.test(source)) {
    throw new Error('Source URL cannot be passed safely to the skills CLI');
  }
  const command = ['npx', 'skills', 'add', source, '--skill', SKILL_NAME, '--agent', 'codex', '-y'];
  const isWin = process.platform === 'win32';
  const result = spawnSync(isWin ? 'cmd.exe' : 'npx',
    isWin ? ['/d', '/s', '/c', command.join(' ')] : command.slice(1), {
      cwd: fetchDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000, windowsHide: true,
    });
  const candidate = join(fetchDir, '.agents', 'skills', SKILL_NAME);
  if (!existsSync(join(candidate, 'SKILL.md'))) {
    throw new Error(`Same-source skills add failed: ${(result.stderr || result.error?.message || result.stdout || '').trim().slice(-500)}`);
  }
  return candidate;
}

function replaceTarget(candidate) {
  const target = realpathSync(SKILL_DIR);
  const parent = dirname(target);
  const work = mkdtempSync(join(parent, `.${SKILL_NAME}-update-`));
  const staged = join(work, 'new');
  const backup = join(work, 'old');
  let oldMoved = false;
  let newMoved = false;
  try {
    cpSync(candidate, staged, { recursive: true });
    for (const rel of ['config.json', 'scripts/update-state.json']) {
      const oldFile = join(target, rel);
      if (existsSync(oldFile)) {
        mkdirSync(dirname(join(staged, rel)), { recursive: true });
        copyFileSync(oldFile, join(staged, rel));
      }
    }
    renameSync(target, backup);
    oldMoved = true;
    renameSync(staged, target);
    newMoved = true;
    if (versionOf(target) !== versionOf(candidate) || packageHash(target) !== packageHash(candidate)) {
      throw new Error('Installed directory failed post-update verification');
    }
  } catch (error) {
    if (oldMoved) {
      if (newMoved) rmSync(target, { recursive: true, force: true });
      renameSync(backup, target);
      oldMoved = false;
    }
    throw error;
  } finally {
    // work is a newly created sibling of the exact, resolved target directory.
    if (normalized(work).startsWith(`${normalized(parent)}/`)) {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

function quietLongEnough() {
  const last = Date.parse(readState()?.lastUsedAt);
  return !Number.isFinite(last) || Date.now() - last >= QUIET_MS;
}

async function waitForQuietWindow() {
  const started = Date.now();
  while (!quietLongEnough()) {
    if (Date.now() - started >= MAX_WAIT_MS) return false;
    await new Promise((done) => setTimeout(done, QUIET_MS));
  }
  return true;
}

function markFailure(error) {
  const previous = readState();
  const count = Math.min(5, (Number(previous?.failureCount) || 0) + 1);
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (count - 1));
  writeState({ status: 'failed', finishedAt: new Date().toISOString(),
    failureCount: count, nextRetryAt: new Date(Date.now() + delay).toISOString(),
    error: String(error?.message || error).slice(0, 1000), changed: false });
}

function runUpdate() {
  const lock = readLockInfo();
  const source = sourceUrl(lock.entry);
  const previous = versionOf(SKILL_DIR);
  const beforeHash = packageHash(SKILL_DIR);
  const fetchDir = mkdtempSync(join(tmpdir(), 'wind-skill-fetch-'));
  try {
    const cloneDir = join(fetchDir, 'repo');
    let head = null;
    let candidate;
    let method = 'verified-git-clone';
    try {
      head = cloneSource(source, cloneDir);
      candidate = candidatePath(cloneDir, lock.entry);
    } catch {
      candidate = installSourceInStaging(source, fetchDir);
      method = 'verified-skills-add';
    }
    const next = versionOf(candidate);
    if (compareVersions(next, previous) < 0) {
      throw new Error(`Downgrade blocked: installed ${previous}, source offers ${next}`);
    }
    const sourceHash = packageHash(candidate);
    const changed = sourceHash !== beforeHash;
    if (changed) replaceTarget(candidate);
    const installed = versionOf(SKILL_DIR);
    const afterHash = packageHash(SKILL_DIR);
    if (installed !== next || afterHash !== sourceHash) {
      throw new Error('Loaded Skill directory does not match downloaded source');
    }
    writeState({ status: 'success', finishedAt: new Date().toISOString(),
      failureCount: 0, nextRetryAt: null, error: null, changed,
      previousVersion: previous, installedVersion: installed,
      remoteHead: head, lastAppliedRemoteHead: head,
      beforeHash, afterHash, method });
  } finally {
    rmSync(fetchDir, { recursive: true, force: true });
  }
}

async function main() {
  if (alreadyUpdatedToday() || retryPending()) return;
  const fd = acquireLock();
  if (fd === null) return;
  try {
    if (alreadyUpdatedToday() || retryPending()) return;
    if (!(await waitForQuietWindow())) {
      writeState({ status: 'deferred', finishedAt: new Date().toISOString(),
        error: 'Skill kept being used; update deferred after max wait', changed: false });
      return;
    }
    writeState({ status: 'updating', startedAt: new Date().toISOString(), changed: false });
    try { runUpdate(); } catch (error) { markFailure(error); }
  } finally {
    releaseLock(fd);
  }
}

if (IS_MAIN) {
  main().catch(markFailure).finally(() => {
    if (process.argv[3] === '--cleanup-runner' &&
        normalized(dirname(SCRIPT_PATH)) === normalized(CACHE_DIR) &&
        basename(SCRIPT_PATH).startsWith(`update-check-${SKILL_NAME}-`)) {
      try { unlinkSync(SCRIPT_PATH); } catch {}
    }
  });
}
