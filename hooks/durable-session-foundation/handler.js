import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const HOOK_NAME = 'durable-session-foundation';
const HOME = os.homedir();
const OPENCLAW_DIR = path.join(HOME, '.openclaw');
const RUNTIME_DIR = path.join(OPENCLAW_DIR, 'runtime');
const DEFAULT_DB_PATH = path.join(RUNTIME_DIR, 'session-store.sqlite3');
const CONFIG_PATH = path.join(OPENCLAW_DIR, 'openclaw.json');
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');
const WORKER_ID = `gateway:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const MATCH_WINDOW_SECONDS = 180;

let db = null;
let periodicSweepStarted = false;
let periodicSweepTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return nowIso();
}

function addMinutes(iso, minutes) {
  const base = new Date(iso).getTime();
  return new Date(base + Math.max(1, minutes) * 60 * 1000).toISOString();
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseAgentId(sessionKey) {
  const raw = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  const match = /^agent:([^:]+):/i.exec(raw);
  return match?.[1]?.trim() || 'main';
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadConfig() {
  try {
    return safeJsonParse(fs.readFileSync(CONFIG_PATH, 'utf8'), {}) || {};
  } catch {
    return {};
  }
}

function getSettings() {
  const cfg = loadConfig();
  const entry = cfg?.hooks?.internal?.entries?.[HOOK_NAME] ?? {};
  return {
    enabled: entry?.enabled !== false,
    dbPath: normalizeText(entry?.dbPath) || DEFAULT_DB_PATH,
    leaseMinutes: Number.isFinite(entry?.leaseMinutes) ? Math.max(5, Math.floor(entry.leaseMinutes)) : 30,
    sweepIntervalMinutes: Number.isFinite(entry?.sweepIntervalMinutes) ? Math.max(1, Math.floor(entry.sweepIntervalMinutes)) : 5,
    reconcileLookbackHours: Number.isFinite(entry?.reconcileLookbackHours) ? Math.max(1, Math.floor(entry.reconcileLookbackHours)) : 48,
    reconcileTailLines: Number.isFinite(entry?.reconcileTailLines) ? Math.max(50, Math.floor(entry.reconcileTailLines)) : 400,
  };
}

function ensureDb() {
  const settings = getSettings();
  if (!settings.enabled) return null;
  if (db) return db;
  fs.mkdirSync(path.dirname(settings.dbPath), { recursive: true });
  db = new DatabaseSync(settings.dbPath);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    PRAGMA wal_autocheckpoint=1000;

    CREATE TABLE IF NOT EXISTS sessions (
      session_key TEXT PRIMARY KEY,
      channel TEXT,
      peer_id TEXT,
      account_id TEXT,
      chat_type TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turns (
      turn_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      turn_sequence INTEGER NOT NULL,
      generation_status TEXT NOT NULL CHECK (generation_status IN ('received','running','completed','failed','interrupted')),
      delivery_status TEXT NOT NULL CHECK (delivery_status IN ('not_applicable','pending','delivered','failed','unknown')),
      lease_owner TEXT,
      lease_expires_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      failed_at TEXT,
      interrupted_at TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(session_key) REFERENCES sessions(session_key)
    );

    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
      message_type TEXT NOT NULL CHECK (message_type IN ('user_text','assistant_text','tool_call','tool_result','system_event')),
      content_json TEXT NOT NULL,
      provider_message_id TEXT,
      transcript_entry_id TEXT,
      channel TEXT,
      peer_id TEXT,
      account_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_key) REFERENCES sessions(session_key),
      FOREIGN KEY(turn_id) REFERENCES turns(turn_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_created
      ON messages(session_key, created_at, message_id);

    CREATE INDEX IF NOT EXISTS idx_turns_session_sequence
      ON turns(session_key, turn_sequence);

    CREATE INDEX IF NOT EXISTS idx_turns_generation_status_lease
      ON turns(generation_status, lease_expires_at);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_turns_session_sequence
      ON turns(session_key, turn_sequence);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_inbound_provider
      ON messages(channel, account_id, peer_id, provider_message_id)
      WHERE role = 'user' AND provider_message_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_outbound_provider
      ON messages(channel, account_id, peer_id, provider_message_id)
      WHERE role = 'assistant' AND provider_message_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_transcript_entry
      ON messages(transcript_entry_id)
      WHERE transcript_entry_id IS NOT NULL;
  `);
  return db;
}

function withImmediateTransaction(fn) {
  const database = ensureDb();
  if (!database) return null;
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (err) {
    try { database.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

function upsertSession(database, { sessionKey, channel, peerId, accountId, chatType, messageAt }) {
  const existing = database.prepare('SELECT session_key FROM sessions WHERE session_key = ?').get(sessionKey);
  const createdAt = messageAt;
  const updatedAt = messageAt;
  if (existing) {
    database.prepare(`
      UPDATE sessions
      SET channel = COALESCE(?, channel),
          peer_id = COALESCE(?, peer_id),
          account_id = COALESCE(?, account_id),
          chat_type = COALESCE(?, chat_type),
          last_message_at = ?,
          updated_at = ?
      WHERE session_key = ?
    `).run(channel ?? null, peerId ?? null, accountId ?? null, chatType ?? null, messageAt, updatedAt, sessionKey);
  } else {
    database.prepare(`
      INSERT INTO sessions (session_key, channel, peer_id, account_id, chat_type, last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionKey, channel ?? null, peerId ?? null, accountId ?? null, chatType ?? null, messageAt, createdAt, updatedAt);
  }
}

function nextTurnSequence(database, sessionKey) {
  const row = database.prepare('SELECT COALESCE(MAX(turn_sequence), 0) AS max_seq FROM turns WHERE session_key = ?').get(sessionKey);
  return Number(row?.max_seq ?? 0) + 1;
}

function findRunningTurn(database, sessionKey) {
  return database.prepare(`
    SELECT * FROM turns
    WHERE session_key = ? AND generation_status = 'running'
    ORDER BY turn_sequence ASC
    LIMIT 1
  `).get(sessionKey) || null;
}

function claimNextReceivedTurnForSession(database, sessionKey, settings = getSettings()) {
  const running = findRunningTurn(database, sessionKey);
  if (running) return null;
  const next = database.prepare(`
    SELECT turn_id, turn_sequence
    FROM turns
    WHERE session_key = ? AND generation_status = 'received'
    ORDER BY turn_sequence ASC
    LIMIT 1
  `).get(sessionKey);
  if (!next?.turn_id) return null;
  const startedAt = nowIso();
  const leaseExpiresAt = addMinutes(startedAt, settings.leaseMinutes);
  const result = database.prepare(`
    UPDATE turns
    SET generation_status = 'running',
        lease_owner = ?,
        lease_expires_at = ?,
        started_at = COALESCE(started_at, ?),
        updated_at = ?
    WHERE turn_id = ? AND generation_status = 'received'
  `).run(WORKER_ID, leaseExpiresAt, startedAt, startedAt, next.turn_id);
  return result.changes > 0 ? next.turn_id : null;
}

function interruptExpiredRunningTurns(database, reason = 'lease_expired') {
  const now = nowIso();
  const rows = database.prepare(`
    SELECT session_key, turn_id
    FROM turns
    WHERE generation_status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < ?
  `).all(now);
  if (!rows.length) return [];
  database.prepare(`
    UPDATE turns
    SET generation_status = 'interrupted',
        interrupted_at = ?,
        lease_owner = NULL,
        lease_expires_at = NULL,
        error_code = COALESCE(error_code, ?),
        updated_at = ?
    WHERE generation_status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < ?
  `).run(now, reason, now, now);
  return [...new Set(rows.map((row) => row.session_key).filter(Boolean))];
}

function markTurnCompleted(database, turnId, deliveryStatus = 'pending') {
  const now = nowIso();
  database.prepare(`
    UPDATE turns
    SET generation_status = 'completed',
        delivery_status = ?,
        completed_at = COALESCE(completed_at, ?),
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = ?
    WHERE turn_id = ?
      AND generation_status IN ('running', 'received', 'interrupted', 'completed')
  `).run(deliveryStatus, now, now, turnId);
}

function updateTurnDeliveryStatus(database, turnId, deliveryStatus) {
  const now = nowIso();
  database.prepare(`
    UPDATE turns
    SET delivery_status = ?, updated_at = ?
    WHERE turn_id = ?
  `).run(deliveryStatus, now, turnId);
}

function insertMessage(database, params) {
  database.prepare(`
    INSERT INTO messages (
      message_id, session_key, turn_id, role, message_type, content_json,
      provider_message_id, transcript_entry_id, channel, peer_id, account_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.messageId,
    params.sessionKey,
    params.turnId ?? null,
    params.role,
    params.messageType,
    params.contentJson,
    params.providerMessageId ?? null,
    params.transcriptEntryId ?? null,
    params.channel ?? null,
    params.peerId ?? null,
    params.accountId ?? null,
    params.createdAt,
  );
}

function buildContentJson(text) {
  return JSON.stringify({ text: text ?? '' });
}

function messageExistsByTranscriptEntry(database, transcriptEntryId) {
  if (!transcriptEntryId) return null;
  return database.prepare('SELECT message_id, turn_id, role FROM messages WHERE transcript_entry_id = ?').get(transcriptEntryId) || null;
}

function findUnlinkedMessageMatch(database, { sessionKey, role, contentJson, createdAt }) {
  const center = new Date(createdAt).getTime();
  const lower = new Date(center - MATCH_WINDOW_SECONDS * 1000).toISOString();
  const upper = new Date(center + MATCH_WINDOW_SECONDS * 1000).toISOString();
  return database.prepare(`
    SELECT message_id, turn_id
    FROM messages
    WHERE session_key = ?
      AND role = ?
      AND transcript_entry_id IS NULL
      AND content_json = ?
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(sessionKey, role, contentJson, lower, upper) || null;
}

function findLatestTurnNeedingAssistant(database, sessionKey) {
  return database.prepare(`
    SELECT t.turn_id, t.turn_sequence, t.generation_status, t.delivery_status
    FROM turns t
    WHERE t.session_key = ?
      AND t.generation_status IN ('received', 'running', 'interrupted', 'completed')
    ORDER BY t.turn_sequence DESC
  `).all(sessionKey).find((row) => {
    const assistant = database.prepare(`
      SELECT 1 FROM messages WHERE turn_id = ? AND role = 'assistant' LIMIT 1
    `).get(row.turn_id);
    return !assistant;
  }) || null;
}

function findLatestTurnForDelivery(database, sessionKey) {
  return database.prepare(`
    SELECT * FROM turns
    WHERE session_key = ?
      AND (
        generation_status = 'running'
        OR (generation_status = 'completed' AND delivery_status IN ('pending', 'unknown', 'not_applicable'))
      )
    ORDER BY turn_sequence DESC
    LIMIT 1
  `).get(sessionKey) || null;
}

function resolveSessionStorePath(sessionKey) {
  const agentId = parseAgentId(sessionKey);
  return path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
}

function resolveTranscriptPath(sessionKey) {
  const storePath = resolveSessionStorePath(sessionKey);
  if (!fs.existsSync(storePath)) return null;
  const store = safeJsonParse(fs.readFileSync(storePath, 'utf8'), {}) || {};
  const entry = store?.[sessionKey];
  if (!entry?.sessionId) return null;
  return entry.sessionFile || path.join(path.dirname(storePath), `${entry.sessionId}.jsonl`);
}

function extractVisibleText(role, content) {
  if (typeof content === 'string') return normalizeText(content);
  if (!Array.isArray(content)) return null;
  if (role === 'user') {
    const joined = content.filter((item) => item?.type === 'text').map((item) => item.text || '').join('\n').trim();
    return normalizeText(joined);
  }
  if (role === 'assistant') {
    const joined = content.filter((item) => item?.type === 'text').map((item) => item.text || '').join('\n').trim();
    return normalizeText(joined);
  }
  return null;
}

function readTranscriptVisibleRows(sessionFile, tailLines = 400) {
  try {
    const raw = fs.readFileSync(sessionFile, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const sliced = tailLines > 0 ? lines.slice(-tailLines) : lines;
    const rows = [];
    for (const line of sliced) {
      const entry = safeJsonParse(line, null);
      if (!entry || entry.type !== 'message' || !entry.message) continue;
      const role = entry.message.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractVisibleText(role, entry.message.content);
      if (!text) continue;
      rows.push({
        transcriptEntryId: entry.id || null,
        role,
        text,
        createdAt: normalizeText(entry.timestamp) || toIso(entry.message.timestamp),
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function reconcileTranscriptRows(database, sessionKey, rows) {
  if (!rows.length) return;
  withImmediateTransaction(() => {
    for (const row of rows) {
      const contentJson = buildContentJson(row.text);
      if (row.transcriptEntryId && messageExistsByTranscriptEntry(database, row.transcriptEntryId)) continue;

      const matched = findUnlinkedMessageMatch(database, {
        sessionKey,
        role: row.role,
        contentJson,
        createdAt: row.createdAt,
      });

      if (matched?.message_id) {
        database.prepare('UPDATE messages SET transcript_entry_id = ? WHERE message_id = ?').run(row.transcriptEntryId, matched.message_id);
        if (row.role === 'assistant' && matched.turn_id) {
          markTurnCompleted(database, matched.turn_id, 'unknown');
        }
        continue;
      }

      upsertSession(database, {
        sessionKey,
        channel: null,
        peerId: null,
        accountId: null,
        chatType: null,
        messageAt: row.createdAt,
      });

      if (row.role === 'user') {
        const turnId = crypto.randomUUID();
        const turnSequence = nextTurnSequence(database, sessionKey);
        database.prepare(`
          INSERT INTO turns (
            turn_id, session_key, turn_sequence, generation_status, delivery_status,
            lease_owner, lease_expires_at, started_at, completed_at, failed_at, interrupted_at,
            error_code, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, 'received', 'not_applicable', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `).run(turnId, sessionKey, turnSequence, row.createdAt, row.createdAt);
        insertMessage(database, {
          messageId: crypto.randomUUID(),
          sessionKey,
          turnId,
          role: 'user',
          messageType: 'user_text',
          contentJson,
          transcriptEntryId: row.transcriptEntryId,
          createdAt: row.createdAt,
        });
        continue;
      }

      let turn = findLatestTurnNeedingAssistant(database, sessionKey);
      if (!turn?.turn_id) {
        const turnId = crypto.randomUUID();
        const turnSequence = nextTurnSequence(database, sessionKey);
        database.prepare(`
          INSERT INTO turns (
            turn_id, session_key, turn_sequence, generation_status, delivery_status,
            lease_owner, lease_expires_at, started_at, completed_at, failed_at, interrupted_at,
            error_code, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, 'completed', 'unknown', NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?)
        `).run(turnId, sessionKey, turnSequence, row.createdAt, row.createdAt, row.createdAt);
        turn = { turn_id: turnId };
      }

      insertMessage(database, {
        messageId: crypto.randomUUID(),
        sessionKey,
        turnId: turn.turn_id,
        role: 'assistant',
        messageType: 'assistant_text',
        contentJson,
        transcriptEntryId: row.transcriptEntryId,
        createdAt: row.createdAt,
      });
      markTurnCompleted(database, turn.turn_id, 'unknown');
    }
  });
}

function reconcileTranscriptForSession(sessionKey, tailLines = getSettings().reconcileTailLines) {
  const database = ensureDb();
  if (!database) return;
  const sessionFile = resolveTranscriptPath(sessionKey);
  if (!sessionFile || !fs.existsSync(sessionFile)) return;
  const rows = readTranscriptVisibleRows(sessionFile, tailLines);
  reconcileTranscriptRows(database, sessionKey, rows);
}

async function reconcileRecentSessionsOnStartup() {
  const database = ensureDb();
  if (!database || !fs.existsSync(AGENTS_DIR)) return;
  const settings = getSettings();
  const cutoffMs = Date.now() - settings.reconcileLookbackHours * 60 * 60 * 1000;
  const agentDirs = await fsp.readdir(AGENTS_DIR, { withFileTypes: true }).catch(() => []);
  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory()) continue;
    const storePath = path.join(AGENTS_DIR, agentDir.name, 'sessions', 'sessions.json');
    if (!fs.existsSync(storePath)) continue;
    const store = safeJsonParse(fs.readFileSync(storePath, 'utf8'), {}) || {};
    for (const [sessionKey, entry] of Object.entries(store)) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.updatedAt === 'number' && entry.updatedAt < cutoffMs) continue;
      const sessionFile = entry.sessionFile || (entry.sessionId ? path.join(path.dirname(storePath), `${entry.sessionId}.jsonl`) : null);
      if (!sessionFile || !fs.existsSync(sessionFile)) continue;
      const rows = readTranscriptVisibleRows(sessionFile, settings.reconcileTailLines);
      reconcileTranscriptRows(database, sessionKey, rows);
    }
  }
}

function performRecoverySweep() {
  const database = ensureDb();
  if (!database) return;
  const touchedSessions = withImmediateTransaction(() => interruptExpiredRunningTurns(database));
  if (Array.isArray(touchedSessions) && touchedSessions.length) {
    withImmediateTransaction(() => {
      for (const sessionKey of touchedSessions) claimNextReceivedTurnForSession(database);
    });
  }
}

function startPeriodicSweepIfNeeded() {
  if (periodicSweepStarted) return;
  const settings = getSettings();
  periodicSweepTimer = setInterval(() => {
    try {
      performRecoverySweep();
    } catch (err) {
      console.warn(`[${HOOK_NAME}] periodic sweep failed:`, err instanceof Error ? err.message : String(err));
    }
  }, settings.sweepIntervalMinutes * 60 * 1000);
  periodicSweepTimer.unref?.();
  periodicSweepStarted = true;
}

function handleMessageReceived(event) {
  const settings = getSettings();
  if (!settings.enabled) return;
  const database = ensureDb();
  if (!database) return;
  const ctx = event.context || {};
  const messageAt = toIso(ctx.timestamp ?? event.timestamp);
  const sessionKey = event.sessionKey;
  const content = normalizeText(ctx.content) || '';
  const providerMessageId = normalizeText(ctx.messageId);
  const channelId = normalizeText(ctx.channelId);
  const from = normalizeText(ctx.from);
  const accountId = normalizeText(ctx.accountId);
  const conversationId = normalizeText(ctx.conversationId);

  withImmediateTransaction(() => {
    if (providerMessageId && channelId && from) {
      const existing = database.prepare(`
        SELECT m.message_id, m.turn_id
        FROM messages m
        WHERE m.role = 'user'
          AND m.channel = ?
          AND COALESCE(m.account_id, '') = COALESCE(?, '')
          AND COALESCE(m.peer_id, '') = COALESCE(?, '')
          AND m.provider_message_id = ?
        LIMIT 1
      `).get(channelId, accountId ?? '', from ?? '', providerMessageId);
      if (existing?.message_id) return;
    }

    upsertSession(database, {
      sessionKey,
      channel: channelId,
      peerId: from,
      accountId,
      chatType: conversationId ? 'dm' : null,
      messageAt,
    });

    const turnId = crypto.randomUUID();
    const turnSequence = nextTurnSequence(database, sessionKey);
    database.prepare(`
      INSERT INTO turns (
        turn_id, session_key, turn_sequence, generation_status, delivery_status,
        lease_owner, lease_expires_at, started_at, completed_at, failed_at, interrupted_at,
        error_code, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, 'received', 'not_applicable', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
    `).run(turnId, sessionKey, turnSequence, messageAt, messageAt);

    insertMessage(database, {
      messageId: crypto.randomUUID(),
      sessionKey,
      turnId,
      role: 'user',
      messageType: 'user_text',
      contentJson: buildContentJson(content),
      providerMessageId,
      channel: channelId,
      peerId: from,
      accountId,
      createdAt: messageAt,
    });

    claimNextReceivedTurnForSession(database, sessionKey, settings);
  });
}

function handleMessageSent(event) {
  const settings = getSettings();
  if (!settings.enabled) return;
  const database = ensureDb();
  if (!database) return;
  const sessionKey = event.sessionKey;
  reconcileTranscriptForSession(sessionKey, settings.reconcileTailLines);

  const ctx = event.context || {};
  const messageAt = toIso(event.timestamp);
  const content = normalizeText(ctx.content) || '';
  const providerMessageId = normalizeText(ctx.messageId);
  const channelId = normalizeText(ctx.channelId);
  const to = normalizeText(ctx.to);
  const accountId = normalizeText(ctx.accountId);
  const success = Boolean(ctx.success);

  withImmediateTransaction(() => {
    upsertSession(database, {
      sessionKey,
      channel: channelId,
      peerId: to,
      accountId,
      chatType: ctx.isGroup ? 'group' : 'dm',
      messageAt,
    });

    let turn = findLatestTurnForDelivery(database, sessionKey);

    if (!turn?.turn_id) {
      const turnId = crypto.randomUUID();
      const turnSequence = nextTurnSequence(database, sessionKey);
      database.prepare(`
        INSERT INTO turns (
          turn_id, session_key, turn_sequence, generation_status, delivery_status,
          lease_owner, lease_expires_at, started_at, completed_at, failed_at, interrupted_at,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, 'completed', ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?)
      `).run(turnId, sessionKey, turnSequence, success ? 'delivered' : 'failed', messageAt, messageAt, messageAt);
      turn = { turn_id: turnId };
    }

    const assistantByProvider = providerMessageId && channelId && to
      ? database.prepare(`
          SELECT message_id FROM messages
          WHERE role = 'assistant'
            AND channel = ?
            AND COALESCE(account_id, '') = COALESCE(?, '')
            AND COALESCE(peer_id, '') = COALESCE(?, '')
            AND provider_message_id = ?
          LIMIT 1
        `).get(channelId, accountId ?? '', to ?? '', providerMessageId)
      : null;

    const hasAssistant = database.prepare(`
      SELECT message_id FROM messages WHERE turn_id = ? AND role = 'assistant' LIMIT 1
    `).get(turn.turn_id);

    if (!assistantByProvider?.message_id && !hasAssistant && content) {
      insertMessage(database, {
        messageId: crypto.randomUUID(),
        sessionKey,
        turnId: turn.turn_id,
        role: 'assistant',
        messageType: 'assistant_text',
        contentJson: buildContentJson(content),
        providerMessageId,
        channel: channelId,
        peerId: to,
        accountId,
        createdAt: messageAt,
      });
    } else if (providerMessageId && hasAssistant?.message_id) {
      database.prepare(`
        UPDATE messages
        SET provider_message_id = COALESCE(provider_message_id, ?)
        WHERE message_id = ?
      `).run(providerMessageId, hasAssistant.message_id);
    }

    markTurnCompleted(database, turn.turn_id, success ? 'delivered' : 'failed');
    if (!success) updateTurnDeliveryStatus(database, turn.turn_id, 'failed');
    claimNextReceivedTurnForSession(database, sessionKey, settings);
  });
}

async function handleGatewayStartup() {
  const settings = getSettings();
  if (!settings.enabled) return;
  ensureDb();
  await reconcileRecentSessionsOnStartup();
  performRecoverySweep();
  startPeriodicSweepIfNeeded();
}

export default async function durableSessionFoundation(event) {
  const settings = getSettings();
  if (!settings.enabled) return;
  try {
    if (event?.type === 'gateway' && event?.action === 'startup') {
      await handleGatewayStartup();
      return;
    }
    if (event?.type === 'message' && event?.action === 'received') {
      handleMessageReceived(event);
      return;
    }
    if (event?.type === 'message' && event?.action === 'sent') {
      handleMessageSent(event);
      return;
    }
  } catch (err) {
    console.warn(`[${HOOK_NAME}] handler failed:`, err instanceof Error ? err.stack || err.message : String(err));
  }
}
