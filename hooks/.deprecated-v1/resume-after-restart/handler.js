import { readFile, writeFile, appendFile, readdir, mkdir, stat } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(workspaceDir, 'runtime');
const pendingLegacyPath = path.join(runtimeDir, 'pending-resume.json');
const pendingDir = path.join(runtimeDir, 'pending-resume.d');
const stateRoot = path.join(os.homedir(), '.openclaw');
const contextTokenPath = path.join(stateRoot, 'state', 'openclaw-weixin-context-tokens.json');
const weixinAccountsDir = path.join(stateRoot, 'openclaw-weixin', 'accounts');
const require = createRequire(import.meta.url);

let cachedInternalsPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGatewayStartupEvent(event) {
  return Boolean(event && event.type === 'gateway' && event.action === 'startup');
}

function isTerminalStatus(status) {
  return status === 'completed' || status === 'failed';
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseAgentId(sessionKey) {
  const raw = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  const match = /^agent:([^:]+):/i.exec(raw);
  return match?.[1]?.trim()?.toLowerCase() || 'main';
}

function taskIdForPath(filePath) {
  return path.basename(filePath, '.json');
}

function buildHiddenResumeSessionKey(data, filePath) {
  const agentId = normalizeText(data?.agentId) || parseAgentId(data?.sessionKey);
  return `agent:${agentId}:resume:${taskIdForPath(filePath)}`;
}

function buildHiddenResumeSessionId(filePath) {
  return `resume-${taskIdForPath(filePath)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function readRecentVisibleMessages(sessionFile, limit = 8) {
  try {
    const raw = await readFile(sessionFile, 'utf8');
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
      try {
        const row = JSON.parse(lines[i]);
        if (row?.type !== 'message') continue;
        const msg = row.message || {};
        const role = msg.role;
        if (!['user', 'assistant', 'system'].includes(role)) continue;
        const text = (msg.content || []).filter((c) => c?.type === 'text').map((c) => c.text || '').join('\n').trim();
        if (!text) continue;
        out.push({ role, text });
      } catch {
        continue;
      }
    }
    return out.reverse();
  } catch {
    return [];
  }
}

function buildNotificationText(data) {
  if (normalizeText(data?.notificationText)) return data.notificationText.trim();
  if (normalizeText(data?.lastResult)) return data.lastResult.trim();
  if (data?.status === 'completed') return '重启续跑任务已完成。';
  if (data?.status === 'failed') return '重启续跑任务失败，但原因已写入任务文件。';
  return null;
}

function resolveSessionStorePath(agentId) {
  return path.join(stateRoot, 'agents', agentId, 'sessions', 'sessions.json');
}

function resolveTranscriptPathFromEntry(storePath, entry) {
  const sessionsDir = path.dirname(storePath);
  if (normalizeText(entry?.sessionFile)) return entry.sessionFile;
  if (normalizeText(entry?.sessionId)) return path.join(sessionsDir, `${entry.sessionId}.jsonl`);
  return null;
}

function makeShortId() {
  return crypto.randomBytes(4).toString('hex');
}

async function ensureTranscriptHeader(sessionFile, sessionId) {
  if (await exists(sessionFile)) return;
  await mkdir(path.dirname(sessionFile), { recursive: true });
  const header = {
    type: 'session',
    version: 1,
    id: sessionId,
    timestamp: nowIso(),
    cwd: process.cwd(),
  };
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf8');
}

async function readLastTranscriptEntryId(sessionFile) {
  try {
    const raw = await readFile(sessionFile, 'utf8');
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (normalizeText(parsed?.id)) return parsed.id;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function transcriptHasIdempotencyKey(sessionFile, idempotencyKey) {
  try {
    const raw = await readFile(sessionFile, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        if (JSON.parse(line).message?.idempotencyKey === idempotencyKey) return true;
      } catch {
        continue;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function appendAssistantMirrorToTranscript({ sessionFile, sessionId, text, idempotencyKey }) {
  await ensureTranscriptHeader(sessionFile, sessionId);
  if (idempotencyKey && await transcriptHasIdempotencyKey(sessionFile, idempotencyKey)) {
    return { ok: true, duplicate: true };
  }
  const entryId = makeShortId();
  const parentId = await readLastTranscriptEntryId(sessionFile);
  const now = Date.now();
  const row = {
    type: 'message',
    id: entryId,
    ...(parentId ? { parentId } : {}),
    timestamp: nowIso(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: now,
      stopReason: 'stop',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      api: 'openai-responses',
      provider: 'openclaw',
      model: 'delivery-mirror',
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  };
  await appendFile(sessionFile, `${JSON.stringify(row)}\n`, 'utf8');
  return { ok: true, duplicate: false };
}

async function ensurePendingDir() {
  await mkdir(pendingDir, { recursive: true });
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  const next = { ...data, updatedAt: nowIso() };
  await writeFile(filePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

async function listTaskFiles() {
  await ensurePendingDir();
  const files = [];
  if (await exists(pendingLegacyPath)) files.push(pendingLegacyPath);
  const entries = await readdir(pendingDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;
    files.push(path.join(pendingDir, entry.name));
  }
  return files.sort();
}

function loadContextToken(accountId, to) {
  const raw = fs.readFileSync(contextTokenPath, 'utf8');
  const data = JSON.parse(raw);
  return data[`${accountId}:${to}`];
}

function loadWeixinAccount(accountId) {
  const raw = fs.readFileSync(path.join(weixinAccountsDir, `${accountId}.json`), 'utf8');
  const data = JSON.parse(raw);
  return {
    baseUrl: (typeof data.baseUrl === 'string' && data.baseUrl.trim()) ? data.baseUrl.trim() : 'https://ilinkai.weixin.qq.com',
    token: (typeof data.token === 'string' && data.token.trim()) ? data.token.trim() : undefined,
  };
}

async function sendWeixinText({ accountId, to, text }) {
  const { baseUrl, token } = loadWeixinAccount(accountId);
  const contextToken = loadContextToken(accountId, to);
  if (!contextToken) throw new Error(`missing weixin contextToken for ${accountId}:${to}`);
  const clientId = `resume-hook:${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const bodyObj = {
    msg: {
      from_user_id: '',
      to_user_id: to,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
      context_token: contextToken,
    },
    base_info: {
      channel_version: 'resume-after-restart-hook',
    },
  };
  const body = JSON.stringify(bodyObj);
  const headers = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
    'X-WECHAT-UIN': Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64'),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${baseUrl.replace(/\/?$/, '/') }ilink/bot/sendmessage`;
  const res = await fetch(url, { method: 'POST', headers, body });
  const raw = await res.text();
  if (!res.ok) throw new Error(`weixin sendmessage ${res.status}: ${raw}`);
  return { messageId: clientId, raw };
}

async function loadOpenClawInternals() {
  if (cachedInternalsPromise) return cachedInternalsPromise;
  cachedInternalsPromise = (async () => {
    const gatewayEntry = typeof process.argv?.[1] === 'string' ? path.resolve(process.argv[1]) : '';
    const distDir = gatewayEntry && path.basename(path.dirname(gatewayEntry)) === 'dist'
      ? path.dirname(gatewayEntry)
      : path.join(path.dirname(gatewayEntry || ''), 'dist');
    const files = await readdir(distDir);

    const importMatch = async (prefix, predicate) => {
      for (const name of files.filter((file) => file.startsWith(`${prefix}-`) && file.endsWith('.js')).sort()) {
        const fullPath = path.join(distDir, name);
        const source = await readFile(fullPath, 'utf8');
        const mod = await import(pathToFileURL(fullPath).href);
        if (predicate(mod, { name, source, fullPath })) return { name, mod, source, fullPath };
      }
      throw new Error(`unable to resolve internal module for ${prefix}`);
    };

    const sessions = await importMatch('sessions', (mod) => typeof mod.d === 'function');
    const piEmbedded = await importMatch(
      'pi-embedded',
      (_mod, ctx) => /agentCommandFromIngress as [A-Za-z$_][A-Za-z0-9$_]*/.test(ctx.source) && /createDefaultDeps as [A-Za-z$_][A-Za-z0-9$_]*/.test(ctx.source)
    );
    const agentCommandAlias = /agentCommandFromIngress as ([A-Za-z$_][A-Za-z0-9$_]*)/.exec(piEmbedded.source)?.[1];
    const createDefaultDepsAlias = /createDefaultDeps as ([A-Za-z$_][A-Za-z0-9$_]*)/.exec(piEmbedded.source)?.[1];
    const requestHeartbeatAlias = /requestHeartbeatNow as ([A-Za-z$_][A-Za-z0-9$_]*)/.exec(piEmbedded.source)?.[1];
    const agentCommandFromIngress = agentCommandAlias ? piEmbedded.mod[agentCommandAlias] : null;
    const createDefaultDeps = createDefaultDepsAlias ? piEmbedded.mod[createDefaultDepsAlias] : null;
    const requestHeartbeatNow = requestHeartbeatAlias ? piEmbedded.mod[requestHeartbeatAlias] : null;
    if (typeof agentCommandFromIngress !== 'function') throw new Error('unable to resolve agentCommandFromIngress export from pi-embedded');
    if (typeof createDefaultDeps !== 'function') throw new Error('unable to resolve createDefaultDeps export from pi-embedded');

    return {
      emitSessionTranscriptUpdate: sessions.mod.d,
      agentCommandFromIngress,
      createDefaultDeps,
      requestHeartbeatNow: typeof requestHeartbeatNow === 'function' ? requestHeartbeatNow : null,
    };
  })();
  return cachedInternalsPromise;
}

function buildResumePrompt(filePath, data, recentMessages = []) {
  const taskId = taskIdForPath(filePath);
  const historyBlock = recentMessages.length
    ? recentMessages.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n')
    : '(No recent visible transcript excerpt available.)';
  const lines = [
    'Your previous turn in a user conversation was interrupted by a gateway restart.',
    'You are running in a hidden recovery session.',
    'Use the transcript excerpt below to continue only the latest unfinished user request.',
    'Write a natural user-facing reply only. Do not mention hooks, restart plumbing, internal recovery, BOOT files, or hidden sessions.',
    normalizeText(data?.task) ? `Recorded task: ${data.task.trim()}` : '',
    Array.isArray(data?.notes) && data.notes.length ? `Recorded notes: ${data.notes.slice(0, 4).join(' | ')}` : '',
    `Recovery task id: ${taskId}`,
    '',
    'Recent transcript excerpt:',
    historyBlock,
  ].filter(Boolean);
  return lines.join('\n');
}

async function runResumeTask(filePath, data, event) {
  const sessionKey = normalizeText(data?.sessionKey);
  if (!sessionKey) {
    return writeJson(filePath, {
      ...data,
      status: 'failed',
      active: false,
      failedAt: nowIso(),
      lastResult: '无法续跑：缺少 sessionKey。',
    });
  }

  const { agentCommandFromIngress, createDefaultDeps } = await loadOpenClawInternals();
  const deps = event?.context?.deps ?? createDefaultDeps();
  const runtime = {
    log: () => {},
    error: (message) => console.warn('[resume-after-restart][agent]', String(message)),
    exit: (code = 0) => {
      throw new Error(`resume agent requested exit (${code})`);
    },
  };

  const agentId = normalizeText(data?.agentId) || parseAgentId(sessionKey);
  const storePath = resolveSessionStorePath(agentId);
  const store = await readJson(storePath);
  const entry = store?.[sessionKey];
  if (!entry?.sessionId) {
    return writeJson(filePath, {
      ...data,
      status: 'failed',
      active: false,
      failedAt: nowIso(),
      lastResult: `无法续跑：session not found for ${sessionKey}`,
    });
  }
  const sessionFile = resolveTranscriptPathFromEntry(storePath, entry);
  const recentMessages = sessionFile ? await readRecentVisibleMessages(sessionFile, 8) : [];

  const prepared = await writeJson(filePath, {
    ...data,
    attemptCount: Number(data?.attemptCount ?? 0) + 1,
    lastAttemptAt: nowIso(),
    resumeSessionKey: buildHiddenResumeSessionKey(data, filePath),
  });

  await sleep(1500);

  try {
    const result = await agentCommandFromIngress({
      message: buildResumePrompt(filePath, prepared, recentMessages),
      sessionKey: prepared.resumeSessionKey,
      sessionId: buildHiddenResumeSessionId(filePath),
      agentId,
      deliver: false,
      senderIsOwner: true,
      allowModelOverride: false,
      messageChannel: normalizeText(prepared?.originSnapshot?.provider) || 'webchat',
    }, runtime, deps);

    const text = (result?.payloads ?? []).map((payload) => payload?.text).filter((value) => typeof value === 'string' && value.trim()).join('\n').trim();
    return writeJson(filePath, {
      ...prepared,
      active: false,
      status: 'completed',
      completedAt: nowIso(),
      lastResult: text || '恢复任务已执行，但未生成可见回复。',
      notificationStatus: 'ready-to-deliver',
      sessionWakeRequestedAt: nowIso(),
    });
  } catch (err) {
    return writeJson(filePath, {
      ...prepared,
      active: false,
      status: 'failed',
      failedAt: nowIso(),
      lastResult: `恢复执行失败：${String(err)}`,
    });
  }
}

async function mirrorReplyIntoSession(filePath, data) {
  const sessionKey = normalizeText(data?.sessionKey);
  if (!sessionKey) return data;
  if (normalizeText(data?.sessionMirroredAt)) return data;
  const text = buildNotificationText(data);
  if (!text) return data;

  try {
    const agentId = normalizeText(data?.agentId) || parseAgentId(sessionKey);
    const storePath = resolveSessionStorePath(agentId);
    const store = await readJson(storePath);
    const entry = store?.[sessionKey];
    if (!entry?.sessionId) throw new Error(`unknown sessionKey: ${sessionKey}`);
    const sessionFile = resolveTranscriptPathFromEntry(storePath, entry);
    if (!sessionFile) throw new Error(`transcript path not resolved for ${sessionKey}`);
    const idempotencyKey = `resume-after-restart:${taskIdForPath(filePath)}`;
    await appendAssistantMirrorToTranscript({
      sessionFile,
      sessionId: entry.sessionId,
      text,
      idempotencyKey,
    });
    entry.updatedAt = Date.now();
    await writeFile(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
    const { emitSessionTranscriptUpdate } = await loadOpenClawInternals();
    emitSessionTranscriptUpdate(sessionFile);
    return writeJson(filePath, {
      ...data,
      sessionMirroredAt: nowIso(),
      notificationStatus: normalizeText(data?.notificationStatus) || 'mirrored',
      notificationError: null,
    });
  } catch (err) {
    return writeJson(filePath, {
      ...data,
      notificationStatus: normalizeText(data?.notificationStatus) || 'mirror-failed',
      notificationError: `session mirror failed: ${String(err)}`,
    });
  }
}

async function deliverReplyTarget(filePath, data) {
  const reply = data?.reply;
  if (!reply || typeof reply !== 'object') return data;
  if (normalizeText(data?.notificationSentAt)) return data;
  const text = buildNotificationText(data);
  if (!text) return data;

  try {
    if (reply.channel !== 'openclaw-weixin') throw new Error(`unsupported reply channel: ${reply.channel}`);
    await sendWeixinText({
      accountId: String(reply.accountId ?? ''),
      to: String(reply.to ?? ''),
      text,
    });
    return writeJson(filePath, {
      ...data,
      notificationStatus: 'sent',
      notificationSentAt: nowIso(),
      notificationError: null,
    });
  } catch (err) {
    return writeJson(filePath, {
      ...data,
      notificationStatus: 'failed',
      notificationError: String(err),
    });
  }
}

async function processTaskFile(filePath, event) {
  let data;
  try {
    data = await readJson(filePath);
  } catch (err) {
    console.warn('[resume-after-restart] failed to read task file', filePath, String(err));
    return;
  }

  if (data?.active === true && data?.status === 'pending' && data?.resumeAfterGatewayRestart === true) {
    data = await runResumeTask(filePath, data, event);
    await sleep(300);
    data = await readJson(filePath).catch(() => data);
  }

  if (!isTerminalStatus(data?.status)) return;

  if (['delivered-by-agent','sent','mirrored'].includes(normalizeText(data?.notificationStatus) || '')) return;

  if (data?.reply && !normalizeText(data?.notificationSentAt)) {
    data = await deliverReplyTarget(filePath, data);
  }

  if (!normalizeText(data?.notificationSentAt)) {
    data = await mirrorReplyIntoSession(filePath, data);
  }
}

export default async function resumeAfterRestart(event) {
  if (!isGatewayStartupEvent(event)) return;
  await ensurePendingDir();
  const files = await listTaskFiles();
  for (const filePath of files) {
    try {
      await processTaskFile(filePath, event);
    } catch (err) {
      console.warn('[resume-after-restart] failed:', filePath, err);
    }
  }
}
