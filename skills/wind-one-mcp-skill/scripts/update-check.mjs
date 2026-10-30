#!/usr/bin/env node
// Daily GitHub/Gitee updater for the Search / Call Skill.

import {
  closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
  statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPackageLock } from './package-lock.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const IS_MAIN = Boolean(process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH);
const SKILL_DIR = IS_MAIN && process.argv[2] ? resolve(process.argv[2]) : dirname(dirname(SCRIPT_PATH));
const SKILL_NAME = basename(SKILL_DIR);
const REQUIRED_TRANSPORT = 'search-call-v1';
const autoUpdateEnabled = () => process.env.WIND_SKILL_AUTO_UPDATE !== '0';
const STATE_FILE = join(SKILL_DIR, 'scripts', 'update-state.json');
const CACHE_DIR = join(homedir(), '.cache', 'wind-aifinmarket');
const LOCK_FILE = join(CACHE_DIR, 'locks', `${createHash('sha256').update(normalized(SKILL_DIR)).digest('hex').slice(0, 24)}.lock`);
const DEFAULT_SOURCES = [
  'https://github.com/Wind-Alice/AliceMarket.git',
  'https://gitee.com/WindAlice/AliceMarket.git',
];
const LOCK_STALE_MS = 30 * 60 * 1000;
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
  const project = [join(projectRoot(), 'skills-lock.json')];
  if (updateScope() !== 'global') return uniquePaths([...project, ...global]);
  const workbuddyRoot = normalized(join(homedir(), '.workbuddy', 'skills'));
  const workbuddyLock = normalized(SKILL_DIR).startsWith(`${workbuddyRoot}/`)
    ? [join(homedir(), 'skills-lock.json')] : [];
  return uniquePaths([...global, ...workbuddyLock]);
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
  if (!entry) return DEFAULT_SOURCES[0];
  if (entry.sourceUrl) return entry.sourceUrl;
  const source = String(entry.source || '');
  if (entry.sourceType === 'github' && /^[^/\s]+\/[^/\s]+$/.test(source)) {
    return `https://github.com/${source}.git`;
  }
  if ((entry.sourceType === 'gitee' || entry.sourceType === 'git') &&
      /^[^/\s]+\/[^/\s]+$/.test(source)) {
    return `https://gitee.com/${source}.git`;
  }
  return source || DEFAULT_SOURCES[0];
}

function updateSources(entry) {
  return entry ? [sourceUrl(entry)] : DEFAULT_SOURCES;
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

export function diagnoseUpdate() {
  const lock = readLockInfo();
  const state = readState();
  const source = sourceUrl(lock.entry);
  return {
    update_scope: updateScope(), update_channel: 'wind_tools',
    update_method: 'github-gitee', required_update_transport: REQUIRED_TRANSPORT,
    auto_update: autoUpdateEnabled() ? 'enabled' : 'disabled',
    update_source: source, fallback_sources: updateSources(lock.entry), update_state_file: STATE_FILE,
    update_state: state, next_update_needed: autoUpdateEnabled() && !successfulToday(state) && !retryPending(state),
    lock_file: lock.file, lock_found: Boolean(lock.entry), skill_directory: SKILL_DIR,
    project_directory: updateScope() === 'global' ? null : projectRoot(),
  };
}

export function triggerUpdateCheck() {
  try {
    if (!autoUpdateEnabled() || successfulToday() || retryPending()) return;
    mkdirSync(CACHE_DIR, { recursive: true });
    const runnerDir = mkdtempSync(join(CACHE_DIR, 'runner-'));
    const runner = join(runnerDir, 'update-check.mjs');
    copyFileSync(join(SKILL_DIR, 'scripts', 'package-lock.mjs'), join(runnerDir, 'package-lock.mjs'));
    copyFileSync(SCRIPT_PATH, runner);
    const child = spawn(process.execPath, [runner, SKILL_DIR, '--cleanup-runner'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.on('error', (error) => {
      try { rmSync(runnerDir, { recursive: true, force: true }); } catch {}
      try { markFailure(new Error(`Cannot start background updater: ${error.message}`)); } catch {}
    });
    child.unref();
  } catch (error) {
    try { markFailure(error); } catch {}
  }
}

function acquireLock() {
  mkdirSync(dirname(LOCK_FILE), { recursive: true });
  try {
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    let owner = null;
    try { owner = JSON.parse(readFileSync(LOCK_FILE, 'utf8'))?.pid; } catch {}
    let ownerAlive = false;
    if (Number.isSafeInteger(owner) && owner > 0) {
      try { process.kill(owner, 0); ownerAlive = true; }
      catch (error) { ownerAlive = error?.code === 'EPERM'; }
    }
    if (!ownerAlive && (owner || age > LOCK_STALE_MS)) unlinkSync(LOCK_FILE);
  } catch {}
  let fd = null;
  try {
    fd = openSync(LOCK_FILE, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return fd;
  } catch {
    if (fd !== null) {
      try { closeSync(fd); } catch {}
      try { unlinkSync(LOCK_FILE); } catch {}
    }
    return null;
  }
}

function releaseLock(fd) {
  try { closeSync(fd); } catch {}
  try { unlinkSync(LOCK_FILE); } catch {}
}

function versionOf(dir) {
  const match = readFileSync(join(dir, 'scripts/mcp.mjs'), 'utf8')
    .match(/\bSKILL_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
  if (match) return match[1];
  throw new Error(`SKILL_VERSION missing in ${dir}`);
}

function validatePackage(dir) {
  for (const file of ['SKILL.md', 'scripts/cli.mjs', 'scripts/client.mjs', 'scripts/mcp.mjs', 'scripts/update-check.mjs', 'scripts/package-lock.mjs']) {
    const full = join(dir, file);
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`Incomplete Skill package: ${file}`);
  }
  const text = readFileSync(join(dir, 'scripts/mcp.mjs'), 'utf8');
  const transport = text.match(/export const SKILL_TRANSPORT = ['"]([^'"]+)['"];?/)?.[1];
  if (transport !== REQUIRED_TRANSPORT) {
    throw new Error(`Incompatible Skill transport: expected ${REQUIRED_TRANSPORT}, received ${transport || 'missing'}`);
  }
  const version = versionOf(dir);
  const skill = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  const metadata = skill.match(/^metadata:\r?\n((?:[ \t]+.*\r?\n)*)/m)?.[1] || '';
  const documentedVersion = metadata.match(/^\s+version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m)?.[1];
  if (documentedVersion !== version) {
    throw new Error(`Skill version mismatch: SKILL.md ${documentedVersion || 'missing'}, runtime ${version}`);
  }
  for (const file of packageFiles(dir).filter((file) => file.rel.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', file.full], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Invalid script ${file.rel}: ${(result.stderr || result.error?.message || '').trim()}`);
    }
  }
  return version;
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

function packageFiles(dir) {
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
  return files;
}

function packageHash(dir) {
  const hash = createHash('sha256');
  for (const file of packageFiles(dir)) {
    hash.update(file.rel); hash.update('\0'); hash.update(readFileSync(file.full)); hash.update('\0');
  }
  return hash.digest('hex');
}

function candidatePath(cloneDir, entry) {
  const skillPath = String(entry?.skillPath || `skills/${SKILL_NAME}/SKILL.md`).replace(/\\/g, '/');
  const subdir = skillPath.endsWith('/SKILL.md') ? skillPath.slice(0, -9) : skillPath;
  const candidate = resolve(cloneDir, subdir);
  if (!normalized(candidate).startsWith(`${normalized(cloneDir)}/`)) {
    throw new Error('Skill path escapes downloaded repository');
  }
  return candidate;
}

function cloneSource(source, dest) {
  const result = spawnSync('git', ['clone', '--depth', '1', '--quiet', '--', source, dest], {
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

function syncDirectory(source, target) {
  mkdirSync(target, { recursive: true });
  const names = new Set();
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    names.add(entry.name);
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      if (existsSync(to) && !statSync(to).isDirectory()) rmSync(to, { force: true });
      syncDirectory(from, to);
    } else if (entry.isFile()) {
      if (existsSync(to) && statSync(to).isDirectory()) rmSync(to, { recursive: true });
      const temporary = `${to}.wind-update-${process.pid}.tmp`;
      copyFileSync(from, temporary);
      renameSync(temporary, to);
    } else {
      throw new Error(`Unsupported entry in Skill package: ${from}`);
    }
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!names.has(entry.name)) rmSync(join(target, entry.name), { recursive: true, force: true });
  }
}

function recoverInterruptedUpdate() {
  const parent = dirname(SKILL_DIR);
  if (!existsSync(parent)) return;
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(`.${SKILL_NAME}-update-`)) continue;
    const work = join(parent, name);
    const backup = join(work, 'old');
    if (!existsSync(join(work, 'restore-on-interruption')) || !existsSync(backup)) continue;
    syncDirectory(backup, SKILL_DIR);
    rmSync(work, { recursive: true, force: true });
  }
}

function replaceTarget(candidate, sourceHash) {
  const target = realpathSync(SKILL_DIR);
  const parent = dirname(target);
  const work = mkdtempSync(join(parent, `.${SKILL_NAME}-update-`));
  const staged = join(work, 'new');
  const backup = join(work, 'old');
  let safeToClean = false;
  try {
    cpSync(candidate, staged, { recursive: true });
    for (const rel of ['config.json', 'scripts/update-state.json']) {
      const oldFile = join(target, rel);
      if (existsSync(oldFile)) {
        mkdirSync(dirname(join(staged, rel)), { recursive: true });
        copyFileSync(oldFile, join(staged, rel));
      }
    }
    cpSync(target, backup, { recursive: true });
    writeFileSync(join(work, 'restore-on-interruption'), target);
    syncDirectory(staged, target);
    const afterHash = packageHash(target);
    if (afterHash !== sourceHash) {
      throw new Error('Installed directory failed post-update verification');
    }
    safeToClean = true;
    return afterHash;
  } catch (error) {
    if (existsSync(join(work, 'restore-on-interruption'))) {
      try {
        syncDirectory(backup, target);
        safeToClean = true;
      } catch (restoreError) {
        throw new Error(`Update failed: ${error.message}; restore failed: ${restoreError.message}`);
      }
    }
    throw error;
  } finally {
    if (safeToClean) rmSync(work, { recursive: true, force: true });
  }
}

function markFailure(error) {
  const previous = readState();
  const count = Math.min(5, (Number(previous?.failureCount) || 0) + 1);
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (count - 1));
  writeState({ status: 'failed', finishedAt: new Date().toISOString(),
    failureCount: count, nextRetryAt: new Date(Date.now() + delay).toISOString(),
    error: String(error?.message || error).slice(0, 4000), changed: false });
}

async function runUpdate() {
  await withPackageLock(SKILL_DIR, recoverInterruptedUpdate);
  const lock = readLockInfo();
  const previous = versionOf(SKILL_DIR);
  const beforeHash = packageHash(SKILL_DIR);
  const fetchDir = mkdtempSync(join(tmpdir(), 'wind-skill-fetch-'));
  try {
    const failures = [];
    let selected = null;
    for (const [index, source] of updateSources(lock.entry).entries()) {
      const attemptDir = join(fetchDir, `source-${index}`);
      mkdirSync(attemptDir, { recursive: true });
      const cloneDir = join(attemptDir, 'repo');
      try {
        const head = cloneSource(source, cloneDir);
        const candidate = candidatePath(cloneDir, lock.entry);
        const next = validatePackage(candidate);
        if (compareVersions(next, previous) < 0) {
          throw new Error(`Downgrade blocked: installed ${previous}, source offers ${next}`);
        }
        selected = { source, head, candidate, next, sourceHash: packageHash(candidate) };
        break;
      } catch (error) {
        failures.push(`${source}: ${error.message}`);
      }
    }
    if (!selected) throw new Error(`All update sources failed: ${failures.join(' | ')}`);
    const { source, head, candidate, next, sourceHash } = selected;
    const changed = sourceHash !== beforeHash;
    await withPackageLock(SKILL_DIR, () => {
      const afterHash = changed ? replaceTarget(candidate, sourceHash) : packageHash(SKILL_DIR);
      if (afterHash !== sourceHash) {
        throw new Error('Loaded Skill directory does not match downloaded source');
      }
      writeState({ status: 'success', finishedAt: new Date().toISOString(),
        failureCount: 0, nextRetryAt: null, error: null, changed,
        previousVersion: previous, installedVersion: next,
        remoteHead: head, lastAppliedRemoteHead: head,
        beforeHash, afterHash, method: 'verified-git-clone', source,
        attemptedSources: updateSources(lock.entry), sourceFailures: failures });
    });
  } finally {
    rmSync(fetchDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!autoUpdateEnabled()) return;
  if (successfulToday() || retryPending()) return;
  const fd = acquireLock();
  if (fd === null) return;
  try {
    if (successfulToday() || retryPending()) return;
    writeState({ status: 'updating', startedAt: new Date().toISOString(), changed: false });
    await runUpdate();
  } finally {
    releaseLock(fd);
  }
}

if (IS_MAIN) {
  main().catch(markFailure).finally(() => {
    const runnerDir = dirname(SCRIPT_PATH);
    if (process.argv[3] === '--cleanup-runner' &&
        normalized(dirname(runnerDir)) === normalized(CACHE_DIR) &&
        basename(runnerDir).startsWith('runner-')) {
      try { rmSync(runnerDir, { recursive: true, force: true }); } catch {}
    }
  });
}
