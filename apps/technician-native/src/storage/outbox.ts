import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import type { QueuedMutation } from "../types";

const DB_NAME = "cluexp-field.db";
const KEY_NAME = "cluexp.sqlcipherKey";
const DATABASE_VERSION = 1;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function randomKey() {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function databaseKey() {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const created = await randomKey();
  await SecureStore.setItemAsync(KEY_NAME, created);
  return created;
}

function escapePragmaString(value: string) {
  return value.replaceAll("'", "''");
}

async function openDatabase() {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  const key = await databaseKey();
  await db.execAsync(`PRAGMA key = '${escapePragmaString(key)}';`);
  await db.execAsync("PRAGMA journal_mode = WAL;");
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = row?.user_version ?? 0;
  if (currentVersion < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS mutation_outbox (
        client_mutation_id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        expected_version TEXT,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mutation_outbox_state
        ON mutation_outbox (state, created_at);
    `);
    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
  }
  return db;
}

async function db() {
  databasePromise ??= openDatabase();
  return databasePromise;
}

export async function initOutbox() {
  await db();
}

export async function enqueueMutation(mutation: QueuedMutation) {
  const conn = await db();
  const now = new Date().toISOString();
  await conn.runAsync(
    "INSERT OR REPLACE INTO mutation_outbox " +
      "(client_mutation_id, job_id, kind, expected_version, payload_json, state, created_at, updated_at, last_error) " +
      "VALUES (?, ?, ?, ?, ?, 'queued', COALESCE((SELECT created_at FROM mutation_outbox WHERE client_mutation_id = ?), ?), ?, NULL)",
    mutation.clientMutationId,
    mutation.jobId,
    mutation.kind,
    mutation.expectedVersion ?? null,
    JSON.stringify(mutation.payload),
    mutation.clientMutationId,
    mutation.createdAt || now,
    now
  );
}

export async function queuedMutationCount() {
  const conn = await db();
  const row = await conn.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM mutation_outbox WHERE state = 'queued'"
  );
  return row?.count ?? 0;
}

export async function queuedMutations(limit = 25): Promise<QueuedMutation[]> {
  const conn = await db();
  const rows = await conn.getAllAsync<{
    client_mutation_id: string;
    job_id: string;
    kind: QueuedMutation["kind"];
    expected_version: string | null;
    payload_json: string;
    created_at: string;
  }>(
    "SELECT client_mutation_id, job_id, kind, expected_version, payload_json, created_at " +
      "FROM mutation_outbox WHERE state = 'queued' ORDER BY created_at ASC LIMIT ?",
    limit
  );
  return rows.map((row) => ({
    clientMutationId: row.client_mutation_id,
    jobId: row.job_id,
    kind: row.kind,
    expectedVersion: row.expected_version,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at
  }));
}

export async function markMutationDone(clientMutationId: string) {
  const conn = await db();
  await conn.runAsync(
    "UPDATE mutation_outbox SET state = 'done', updated_at = ?, last_error = NULL WHERE client_mutation_id = ?",
    new Date().toISOString(),
    clientMutationId
  );
}

export async function markMutationFailed(clientMutationId: string, detail: string) {
  const conn = await db();
  await conn.runAsync(
    "UPDATE mutation_outbox SET state = 'failed', updated_at = ?, last_error = ? WHERE client_mutation_id = ?",
    new Date().toISOString(),
    detail,
    clientMutationId
  );
}

export async function wipeOutbox() {
  const conn = await db();
  await conn.runAsync("DELETE FROM mutation_outbox");
}
