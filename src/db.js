// Storage for businesses, bookings, blocks, suggestions, changes and
// pending actions. Uses Postgres when DATABASE_URL is set, otherwise an
// in-memory store with the same API. Every record is kept as one JSON
// document in a `records` table (kind, id, business_id, data), which keeps
// both code paths identical and tiny.

import { randomUUID } from "node:crypto";

let pool = null;
const memory = new Map(); // key `${kind}:${id}` -> record

function key(kind, id) { return `${kind}:${id}`; }

export async function init() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL, id TEXT NOT NULL, business_id TEXT, data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (kind, id))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS records_business ON records (kind, business_id)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS bookings_conversation ON records ((data->>'conversation_id')) WHERE kind = 'booking'`);
    console.log("db: postgres");
  } else {
    console.log("db: in memory (set DATABASE_URL to keep data between restarts)");
  }
}

export function isPostgres() { return !!pool; }

// Insert one record. Returns it with id and created_at filled in.
async function insert(kind, data) {
  const rec = { id: data.id || randomUUID(), created_at: new Date().toISOString(), ...data };
  if (pool) {
    await pool.query("INSERT INTO records (kind, id, business_id, data) VALUES ($1, $2, $3, $4)", [kind, rec.id, rec.business_id || null, rec]);
  } else {
    memory.set(key(kind, rec.id), rec);
  }
  return rec;
}

async function get(kind, id) {
  if (!id) return null;
  if (pool) {
    const r = await pool.query("SELECT data FROM records WHERE kind = $1 AND id = $2", [kind, id]);
    return r.rows[0]?.data || null;
  }
  return memory.get(key(kind, id)) || null;
}

// All records of a kind, optionally for one business. Newest first.
async function list(kind, businessId) {
  let rows;
  if (pool) {
    const r = businessId
      ? await pool.query("SELECT data FROM records WHERE kind = $1 AND business_id = $2", [kind, businessId])
      : await pool.query("SELECT data FROM records WHERE kind = $1", [kind]);
    rows = r.rows.map((x) => x.data);
  } else {
    rows = [...memory.entries()].filter(([k, r]) => k.startsWith(kind + ":") && (!businessId || r.business_id === businessId)).map(([, r]) => r);
  }
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

async function update(kind, id, patch) {
  const cur = await get(kind, id);
  if (!cur) return null;
  const next = { ...cur, ...patch, id: cur.id };
  if (pool) await pool.query("UPDATE records SET data = $3 WHERE kind = $1 AND id = $2", [kind, id, next]);
  else memory.set(key(kind, id), next);
  return next;
}

async function remove(kind, id) {
  if (pool) await pool.query("DELETE FROM records WHERE kind = $1 AND id = $2", [kind, id]);
  else memory.delete(key(kind, id));
}

// Businesses
export const createBusiness = (b) => insert("business", b);
export const getBusinessById = (id) => get("business", id);
export const updateBusiness = (id, patch) => update("business", id, patch);
export async function getBusinessBySlug(slug) { return (await list("business")).find((b) => b.slug === slug) || null; }
export async function getBusinessByVerifyToken(token) { return token ? (await list("business")).find((b) => b.verify_token === token) || null : null; }
export async function listBusinesses({ verifiedOnly = true } = {}) {
  const all = await list("business");
  return (verifiedOnly ? all.filter((b) => b.verified) : all).sort((a, b) => a.name.localeCompare(b.name));
}
export async function countBusinesses() { return (await list("business")).length; }

// Blocks (closed periods)
export const createBlock = (b) => insert("block", b);
export const listBlocks = (businessId) => list("block", businessId);
export async function deleteBlock(id, businessId) {
  const b = await get("block", id);
  if (!b || b.business_id !== businessId) return false;
  await remove("block", id);
  return true;
}

// Bookings
export async function saveBooking(b) {
  try { return await insert("booking", b); }
  catch (e) { if (String(e.message).includes("bookings_conversation")) return null; throw e; }
}
export const getBooking = (id) => get("booking", id);
export const updateBooking = (id, patch) => update("booking", id, patch);
export const listBookings = (businessId) => list("booking", businessId);
export async function getBookingByConversation(conversationId) {
  if (!conversationId) return null;
  return (await list("booking")).find((b) => b.conversation_id === conversationId) || null;
}
export async function getBookingByCancelToken(token) {
  if (!token) return null;
  return (await list("booking")).find((b) => b.cancel_token === token) || null;
}
export async function countBookingsByPhoneToday(businessId, phone, dateKey) {
  if (!phone) return 0;
  return (await list("booking", businessId)).filter((b) => b.customer_phone === phone && b.status !== "cancelled" && String(b.created_at).slice(0, 10) === dateKey).length;
}

// Suggestions, changes, pending actions
export const createSuggestion = (s) => insert("suggestion", s);
export const listSuggestions = (businessId) => list("suggestion", businessId);
export const getSuggestion = (id) => get("suggestion", id);
export const updateSuggestion = (id, patch) => update("suggestion", id, patch);

export const createChange = (c) => insert("change", c);
export const listChanges = (businessId) => list("change", businessId);
export const getChange = (id) => get("change", id);
export const updateChange = (id, patch) => update("change", id, patch);

export const createPendingAction = (p) => insert("pending", p);
export const listPendingActions = (businessId) => list("pending", businessId);
export const getPendingAction = (id) => get("pending", id);
export const updatePendingAction = (id, patch) => update("pending", id, patch);

// Test helper: wipe the in-memory store.
export function _reset() { memory.clear(); }
