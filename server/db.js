'use strict';
// In-memory store with JSON-file persistence and automatic audit capture.
const fs = require('fs');
const path = require('path');
const seed = require('./seed');
const security = require('./security');
const auth = require('./auth');

const FILE = process.env.GT_DB_FILE || path.join(__dirname, 'data', 'db.json');
let db;
let saveTimer = null;

const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const nextId = k => (db.seq[k] = (db.seq[k] || 0) + 1);

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db));
  }, 300);
}

// Fields that never count as a business change.
const IGNORED = new Set(['updatedAt', 'updatedBy', 'version', 'validated']);

function diff(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter(k => !IGNORED.has(k) && JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k]));
}

function audit(entityType, entity, action, before, after, ctx, at) {
  const entry = {
    id: nextId('audit'), entityType, entityId: entity.id,
    entityName: entity.name || entity.fullName || entity.username || entity.tradeRef || entity.fileName || String(entity.id),
    action, user: (ctx && ctx.user) || 'system', ip: (ctx && ctx.ip) || '127.0.0.1',
    reason: (ctx && ctx.reason) || '', at: at || new Date().toISOString(),
    changed: action === 'UPDATE' ? diff(before, after) : [],
    before: clone(before) || null, after: clone(after) || null
  };
  db.audit.push(entry);
  return entry;
}

// Generic CRUD used by every collection. Contracts add versioning on top (see server.js).
function list(name) { return db[name]; }
function get(name, id) { return db[name].find(x => x.id === Number(id)); }

function insert(name, entityType, data, ctx) {
  const rec = Object.assign({}, data, { id: nextId(name) });
  db[name].push(rec);
  audit(entityType, rec, 'INSERT', null, rec, ctx);
  save();
  return rec;
}

function update(name, entityType, id, changes, ctx) {
  const rec = get(name, id);
  if (!rec) return null;
  const before = clone(rec);
  delete changes.id;
  Object.assign(rec, changes);
  const entry = audit(entityType, rec, 'UPDATE', before, rec, ctx);
  if (!entry.changed.length) db.audit.pop(); // nothing really changed: no audit noise
  save();
  return rec;
}

function remove(name, entityType, id, ctx) {
  const idx = db[name].findIndex(x => x.id === Number(id));
  if (idx < 0) return false;
  const [rec] = db[name].splice(idx, 1);
  audit(entityType, rec, 'DELETE', rec, null, ctx);
  save();
  return true;
}

function seedAudit() {
  const day = 86400000;
  db.roles.forEach(r => audit('Role', r, 'INSERT', null, r, { user: 'system' }, new Date(Date.now() - 420 * day).toISOString()));
  db.users.forEach(u => audit('User', Object.assign({ name: u.fullName }, u), 'INSERT', null, u, { user: 'system' }, u.createdAt));
  db.counterparties.concat().forEach(c => audit('Counterparty', c, 'INSERT', null, c, { user: 'system' }, new Date(Date.now() - 400 * day).toISOString()));
  db.commodities.forEach(c => audit('Commodity', c, 'INSERT', null, c, { user: 'system' }, new Date(Date.now() - 400 * day).toISOString()));
  db.contracts.forEach(c => audit('Contract', c, 'INSERT', null, c, { user: c.createdBy }, c.createdAt));
  // A few amended contracts so versions and audit compare have something to show.
  [2, 5, 9, 14].forEach((id, i) => {
    const c = get('contracts', id);
    if (!c) return;
    const before = clone(c);
    c.contractedMw = Math.round((c.contractedMw + 2.5 + i) * 10) / 10;
    c.notes = 'Capacity revised after site load study.';
    if (i % 2 === 0) c.holidayCalendar = 'India - Maharashtra';
    c.version = 2;
    c.updatedBy = 'risk.manager';
    c.updatedAt = new Date(Date.now() - (20 - i) * day).toISOString();
    audit('Contract', c, 'UPDATE', before, c, { user: 'risk.manager', reason: 'Load study revision' }, c.updatedAt);
    db.versions.push({ id: nextId('versions'), contractId: c.id, version: 2, effectiveDate: c.effectiveDate, createdAt: c.updatedAt, createdBy: 'risk.manager', comment: 'Capacity revised after site load study', snapshot: clone(c) });
  });
  db.audit.sort((a, b) => a.at.localeCompare(b.at));
  db.audit.forEach((a, i) => { a.id = i + 1; });
  db.seq.audit = db.audit.length;
}

function reset() {
  const credentials = db && db.credentials; // a data reset keeps everyone's password
  db = seed.build();
  security.ensure(db); // generated modules' grants
  db.credentials = credentials || {};
  auth.ensureCredentials(db, { reset: true });
  seedAudit();
  save();
}

function load() {
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const a = security.ensure(db), b = auth.ensureCredentials(db);
    if (a || b) { save(); }
  } catch (e) {
    reset();
  }
}

load();

module.exports = {
  get data() { return db; },
  nextId, list, get, insert, update, remove, audit, save, reset, clone, diff
};
