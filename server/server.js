'use strict';
// GridTrade Contracts API + static host for the built Ext JS app. No npm dependencies.
//   node server/server.js            -> http://localhost:5080
//   PORT=5090 GT_LATENCY=0 node server/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const store = require('./db');
const seed = require('./seed');
const { parseCsv } = require('./csv');
const security = require('./security');
const auth = require('./auth');

if (process.argv.includes('--demo-auth')) process.env.GT_AUTH = 'demo'; // npm run start:demo (works on Windows too)
const PORT = Number(process.env.PORT || 5080);
const LATENCY = Number(process.env.GT_LATENCY || 120);
const ROOT = path.resolve(__dirname, '..');
const BUILD_DIRS = ['build/production/GT', 'build/testing/GT'].map(d => path.join(ROOT, d));
const WEB_ROOT = process.env.GT_WEB_ROOT ? path.resolve(process.env.GT_WEB_ROOT) : BUILD_DIRS.find(d => fs.existsSync(path.join(d, 'index.html')));

const D = () => store.data;
const ymd = seed.ymd;

// ---------- helpers ----------
class HttpError extends Error { constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; } }
const bad = (msg, errors) => { throw new HttpError(400, msg, errors); };
const notFound = what => { throw new HttpError(404, `${what} not found`); };

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}
const ok = (data, extra) => Object.assign({ success: true, data }, extra || {});
const listResult = (rows, q) => {
  rows = sortRows(rows, q.sort);
  const total = rows.length;
  if (q.limit !== undefined && q.start !== undefined) rows = rows.slice(Number(q.start), Number(q.start) + Number(q.limit));
  return ok(rows, { total });
};

function sortRows(rows, sortParam) {
  if (!sortParam) return rows;
  let sorters;
  try { sorters = JSON.parse(sortParam); } catch (e) { return rows; }
  return rows.slice().sort((a, b) => {
    for (const s of sorters) {
      const av = a[s.property], bv = b[s.property];
      if (av === bv) continue;
      const cmp = av === null || av === undefined ? -1 : bv === null || bv === undefined ? 1 : (av > bv ? 1 : -1);
      return s.direction === 'DESC' ? -cmp : cmp;
    }
    return 0;
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 10 * 1024 * 1024) { reject(new HttpError(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new HttpError(400, 'Body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

/**
 * Who is calling. A Bearer token from /api/auth/login is always accepted; the X-GT-User header only when
 * GT_AUTH=demo. Returns null for an anonymous call (only public routes accept those).
 */
const ctxOf = req => {
  const header = String(req.headers.authorization || '');
  let user, method;
  if (/^bearer\s+/i.test(header)) {
    let claims;
    try { claims = auth.verify(header.replace(/^bearer\s+/i, '').trim()); } catch (e) { throw new HttpError(401, e.message); }
    user = claims.sub; method = 'jwt';
  } else if (auth.mode() === 'demo') {
    user = String(req.headers['x-gt-user'] || 'demo.trader').slice(0, 40); method = 'demo';
  } else {
    return null;
  }
  const account = security.userByName(D(), user);
  if (method === 'jwt' && (!account || !account.enabled)) throw new HttpError(401, 'This account is disabled or no longer exists');
  const perms = security.permissionsOf(D(), account);
  return {
    user,
    method,
    perms,
    can: p => perms.includes(p),
    reason: decodeURIComponent(String(req.headers['x-gt-reason'] || '')).slice(0, 200),
    ip: (req.socket.remoteAddress || '').replace('::ffff:', '')
  };
};

/** 403 unless the acting user's roles grant the permission. */
function need(ctx, perm) {
  if (!ctx.can(perm)) {
    const [module, action] = perm.split('.');
    const m = security.MODULES.find(x => x.module === module);
    throw new HttpError(403, `${ctx.user} does not have permission to ${(security.ACTION_LABELS[action] || action).toLowerCase()} in ${m ? m.label : module}. Ask an administrator, or switch user.`);
  }
}

const nameOf = (coll, id) => { const r = id ? store.get(coll, id) : null; return r ? (r.name || r.code) : ''; };
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);
const overlaps = (s, e, from, to) => (!to || s <= to) && (!from || e >= from);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));

// ---------- contracts ----------
const CONTRACT_FIELDS = ['name', 'type', 'internalRef', 'transactionType', 'counterpartyId', 'legalEntityId', 'marketParticipant', 'orderOfAccount',
  'studyContract', 'timeZone', 'effectiveDate', 'startDate', 'endDate', 'commodities', 'nodeId', 'meterId', 'holidayCalendar', 'contractedMw', 'notes'];

function contractView(c) {
  const comps = D().components.filter(x => x.contractId === c.id);
  return Object.assign({}, c, {
    counterpartyName: nameOf('counterparties', c.counterpartyId), legalEntityName: nameOf('legalEntities', c.legalEntityId),
    nodeName: nameOf('nodes', c.nodeId), meterName: nameOf('timeseries', c.meterId), componentCount: comps.length
  });
}

function checkContract(data, isNew) {
  const errors = {};
  const need = ['name', 'type', 'transactionType', 'counterpartyId', 'legalEntityId', 'timeZone', 'effectiveDate', 'startDate', 'endDate'];
  if (isNew) need.forEach(f => { if (data[f] === undefined || data[f] === null || data[f] === '') errors[f] = 'Required'; });
  ['effectiveDate', 'startDate', 'endDate'].forEach(f => { if (data[f] && !isDate(data[f])) errors[f] = 'Use YYYY-MM-DD'; });
  if (data.counterpartyId && !store.get('counterparties', data.counterpartyId)) errors.counterpartyId = 'Unknown counterparty';
  if (data.legalEntityId && !store.get('legalEntities', data.legalEntityId)) errors.legalEntityId = 'Unknown legal entity';
  if (data.name && D().contracts.some(c => c.name.toLowerCase() === String(data.name).toLowerCase() && c.id !== data.id)) errors.name = 'A contract with this name already exists';
  if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
}

function contractRules(c) {
  const msgs = [];
  const comps = D().components.filter(x => x.contractId === c.id);
  const add = (level, field, message) => msgs.push({ level, field, message });
  if (c.endDate < c.startDate) add('Error', 'endDate', 'End date is before start date');
  if (c.effectiveDate > c.startDate) add('Warning', 'effectiveDate', 'Effective date is after delivery start');
  if (!c.commodities || !c.commodities.length) add('Error', 'commodities', 'Select at least one commodity');
  if (!comps.length) add('Error', null, 'Add at least one product component');
  if (c.type === 'Green PPA' && !(c.commodities || []).includes('Renewable Energy Certificate')) add('Error', 'commodities', 'Green PPA must include Renewable Energy Certificate');
  if (!c.nodeId) add('Warning', 'nodeId', 'No delivery node set');
  const cp = store.get('counterparties', c.counterpartyId);
  if (cp && !cp.enabled) add('Error', 'counterpartyId', `Counterparty ${cp.name} is disabled`);
  comps.forEach(k => {
    if (k.type === 'Fixed Price' && !(k.price > 0)) add('Error', null, `Component "${k.name}": fixed price must be greater than zero`);
    if (k.type === 'Index Price' && !k.indexSeriesId) add('Error', null, `Component "${k.name}": choose an index series`);
    if (k.type === 'External Reference' && !k.referenceSeriesId) add('Error', null, `Component "${k.name}": choose a reference time series`);
    if (k.price > 10000) add('Warning', null, `Component "${k.name}": price is above the INR 10,000/MWh exchange cap`);
    if (k.commodity && !(c.commodities || []).includes(k.commodity)) add('Warning', null, `Component "${k.name}" uses ${k.commodity}, which is not on the contract`);
  });
  if (c.contractedMw !== undefined && c.contractedMw !== null && c.contractedMw <= 0) add('Error', 'contractedMw', 'Contracted capacity must be positive');
  return msgs;
}

function markUnvalidated(contractId, ctx) {
  const c = store.get('contracts', contractId);
  if (c && (c.validated || c.status !== 'Draft')) { c.validated = false; c.status = 'Draft'; c.updatedBy = ctx.user; c.updatedAt = new Date().toISOString(); }
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, opts) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, public: !!(opts && opts.public) });
};

// ---------- sign-in ----------
const rolesOf = u => D().roles.filter(r => u.roleIds.includes(r.id)).map(r => r.name);
function session(u) {
  const permissions = security.permissionsOf(D(), u);
  return Object.assign(auth.issue(u, rolesOf(u), permissions), {
    user: { username: u.username, fullName: u.fullName, email: u.email, roles: rolesOf(u) }, permissions
  });
}
route('POST', '/api/auth/login', async req => {
  const body = await readBody(req);
  const username = String(body.username || '').trim().toLowerCase().slice(0, 40);
  const key = username + '|' + (req.socket.remoteAddress || '');
  const wait = auth.lockedFor(key);
  if (wait) throw new HttpError(429, `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
  const u = security.userByName(D(), username);
  const stored = u && (D().credentials || {})[u.username];
  // Same message and similar work whether the user exists or not.
  const valid = auth.checkPassword(body.password || '', stored || auth.hashPassword('x'));
  if (!u || !stored || !valid) { auth.recordFailure(key); throw new HttpError(401, 'Wrong username or password'); }
  if (!u.enabled) throw new HttpError(403, 'This account is disabled. Ask an administrator.');
  auth.clearFailures(key);
  return ok(session(u));
}, { public: true });
route('POST', '/api/auth/refresh', (req, p, q, ctx) => {
  if (ctx.method !== 'jwt') throw new HttpError(400, 'Refresh needs a sign-in token');
  return ok(session(security.userByName(D(), ctx.user)));
});
route('POST', '/api/auth/password', async (req, p, q, ctx) => {
  const body = await readBody(req);
  const u = security.userByName(D(), ctx.user) || notFound('User');
  if (!auth.checkPassword(body.currentPassword || '', D().credentials[u.username])) bad('The current password is wrong', { currentPassword: 'Wrong password' });
  const problem = auth.passwordProblem(body.newPassword);
  if (problem) bad('Choose a stronger password', { newPassword: problem });
  D().credentials[u.username] = auth.hashPassword(body.newPassword);
  store.save();
  return ok({ message: 'Password changed' });
});

// Lookups
const STATIC_LOOKUPS = {
  contractTypes: seed.contractTypes, products: seed.products, granularities: seed.granularities, timeZones: seed.timeZones,
  componentTypes: seed.componentTypes, marketProducts: seed.marketProducts, holidayCalendars: seed.holidayCalendars,
  transactionTypes: ['Purchase', 'Sale'], contractStatuses: ['Draft', 'Validated', 'Approved'], tradeStatuses: ['New', 'Confirmed', 'Settled', 'Cancelled'],
  counterpartyTypes: ['Industrial', 'Commercial', 'Generator', 'Utility', 'Trader'], regions: ['North', 'West', 'South', 'East', 'Central'],
  entityTypes: ['Contract', 'Contract Component', 'Trade', 'Counterparty', 'Legal Entity', 'Commodity', 'Time Series', 'Time Series Data', 'Ingestion Job', 'User', 'Role'],
  departments: ['Front Office', 'Middle Office', 'Operations', 'Risk', 'Compliance', 'Finance', 'IT']
};
route('GET', '/api/lookups/:type', (req, p) => {
  const t = p.type;
  if (STATIC_LOOKUPS[t]) return ok(STATIC_LOOKUPS[t].map(v => ({ id: v, name: v })));
  const map = {
    counterparties: () => D().counterparties.map(c => ({ id: c.id, name: c.name, code: c.code, enabled: c.enabled })),
    legalEntities: () => D().legalEntities.map(c => ({ id: c.id, name: c.name, code: c.code, enabled: c.enabled })),
    commodities: () => D().commodities.map(c => ({ id: c.name, name: c.name, enabled: c.enabled, contractTypes: c.contractTypes, recordId: c.id })),
    nodes: () => D().nodes.map(n => ({ id: n.id, name: n.name, region: n.region })),
    timeseries: () => D().timeseries.map(t => ({ id: t.id, name: t.name, code: t.formula, unit: t.unit })),
    contracts: () => D().contracts.map(c => ({ id: c.id, name: c.name, status: c.status })),
    users: () => D().users.map(u => ({ id: u.username, name: u.username, code: u.fullName, enabled: u.enabled })),
    roles: () => D().roles.map(r => ({ id: r.id, name: r.name, enabled: true }))
  };
  if (!map[t]) notFound(`Lookup '${t}'`);
  return ok(map[t]());
});

// Dashboard
route('GET', '/api/dashboard', () => {
  const today = ymd(new Date());
  const trades = D().trades;
  const byProduct = seed.marketProducts.map(prod => {
    const t = trades.filter(x => x.product === prod && x.status !== 'Cancelled');
    return { product: prod, buy: Math.round(t.filter(x => x.buySell === 'Buy').reduce((s, x) => s + x.volumeMw, 0)), sell: Math.round(t.filter(x => x.buySell === 'Sell').reduce((s, x) => s + x.volumeMw, 0)) };
  });
  const lastJob = D().ingestionJobs[D().ingestionJobs.length - 1];
  return ok({
    kpis: {
      activeContracts: D().contracts.filter(c => c.status === 'Approved' && c.endDate >= today).length,
      pendingApproval: D().contracts.filter(c => c.status !== 'Approved').length,
      tradesToday: trades.filter(t => t.tradeDate === today).length,
      openVolumeMw: Math.round(trades.filter(t => t.status === 'New' || t.status === 'Confirmed').reduce((s, t) => s + t.volumeMw, 0)),
      ingestionIssues: lastJob ? lastJob.rejected + lastJob.warnings : 0
    },
    volumeByProduct: byProduct,
    recentActivity: D().audit.slice(-8).reverse().map(a => ({ id: a.id, entityType: a.entityType, entityId: a.entityId, entityName: a.entityName, action: a.action, user: a.user, at: a.at })),
    notices: [
      { level: 'info', title: 'Market coupling', text: 'Day-ahead bids now clear at a uniform price across exchanges. Review DAM strategy notes before 10:00.' },
      { level: 'warn', title: 'Meter data', text: 'Two meter files arrived with gaps yesterday. See Data Ingestion for row-level details.' },
      { level: 'info', title: 'Demo environment', text: 'All data is synthetic. Use the user menu to reset the demo database.' }
    ]
  });
});

// Contracts
route('GET', '/api/contracts', (req, p, q) => {
  let rows = D().contracts;
  if (q.name) rows = rows.filter(c => c.name.toLowerCase().includes(q.name.toLowerCase()));
  if (q.counterpartyId) rows = rows.filter(c => c.counterpartyId === Number(q.counterpartyId));
  if (q.legalEntityId) rows = rows.filter(c => c.legalEntityId === Number(q.legalEntityId));
  if (q.type) rows = rows.filter(c => c.type === q.type);
  if (q.status === 'Pending') rows = rows.filter(c => c.status !== 'Approved');
  else if (q.status) rows = rows.filter(c => c.status === q.status);
  if (q.studyContract === 'true' || q.studyContract === 'false') rows = rows.filter(c => c.studyContract === (q.studyContract === 'true'));
  if (q.from || q.to) rows = rows.filter(c => overlaps(c.startDate, c.endDate, q.from, q.to));
  return listResult(rows.map(contractView), q);
});
route('GET', '/api/contracts/:id', (req, p) => ok(contractView(store.get('contracts', p.id) || notFound('Contract'))));
route('POST', '/api/contracts', async (req, p, q, ctx) => {
  need(ctx, 'contracts.edit');
  const body = await readBody(req);
  const data = {};
  CONTRACT_FIELDS.forEach(f => { if (body[f] !== undefined) data[f] = body[f]; });
  checkContract(data, true);
  const now = new Date().toISOString();
  Object.assign(data, { status: 'Draft', validated: false, version: 1, createdBy: ctx.user, createdAt: now, updatedBy: ctx.user, updatedAt: now });
  if (!data.internalRef) data.internalRef = `GT-${data.startDate.slice(0, 4)}-${String(D().seq.contracts + 1).padStart(4, '0')}`;
  if (!Array.isArray(data.commodities)) data.commodities = [];
  const c = store.insert('contracts', 'Contract', data, ctx);
  D().versions.push({ id: store.nextId('versions'), contractId: c.id, version: 1, effectiveDate: c.effectiveDate, createdAt: now, createdBy: ctx.user, comment: body.versionComment || 'Initial version', snapshot: store.clone(c) });
  store.save();
  return ok(contractView(c));
});
route('PUT', '/api/contracts/:id', async (req, p, q, ctx) => {
  need(ctx, 'contracts.edit');
  const c = store.get('contracts', p.id) || notFound('Contract');
  const body = await readBody(req);
  const changes = {};
  CONTRACT_FIELDS.forEach(f => { if (body[f] !== undefined) changes[f] = body[f]; });
  checkContract(Object.assign({}, c, changes, { id: c.id }), false);
  const changed = store.diff(c, Object.assign({}, c, changes));
  if (!changed.length) return ok(contractView(c));
  Object.assign(changes, { version: c.version + 1, validated: false, status: 'Draft', updatedBy: ctx.user, updatedAt: new Date().toISOString() });
  const upd = store.update('contracts', 'Contract', c.id, changes, Object.assign({}, ctx, { reason: body.versionComment || ctx.reason }));
  D().versions.push({ id: store.nextId('versions'), contractId: c.id, version: upd.version, effectiveDate: upd.effectiveDate, createdAt: upd.updatedAt, createdBy: ctx.user, comment: body.versionComment || `Changed: ${changed.join(', ')}`, snapshot: store.clone(upd) });
  store.save();
  return ok(contractView(upd));
});
route('DELETE', '/api/contracts/:id', (req, p, q, ctx) => {
  need(ctx, 'contracts.delete');
  const c = store.get('contracts', p.id) || notFound('Contract');
  if (c.status === 'Approved') throw new HttpError(409, 'Approved contracts cannot be deleted. Amend it instead.');
  D().components.filter(k => k.contractId === c.id).forEach(k => store.remove('components', 'Contract Component', k.id, ctx));
  store.remove('contracts', 'Contract', c.id, ctx);
  return ok(null);
});
route('POST', '/api/contracts/:id/validate', (req, p, q, ctx) => {
  need(ctx, 'contracts.view');
  const c = store.get('contracts', p.id) || notFound('Contract');
  const messages = contractRules(c);
  const valid = !messages.some(m => m.level === 'Error');
  if (valid && c.status === 'Draft') { c.validated = true; c.status = 'Validated'; store.save(); }
  if (!valid && c.validated) { c.validated = false; c.status = 'Draft'; store.save(); }
  return ok({ valid, messages, contract: contractView(c) });
});
route('POST', '/api/contracts/:id/approve', async (req, p, q, ctx) => {
  need(ctx, 'contracts.approve');
  const c = store.get('contracts', p.id) || notFound('Contract');
  const body = await readBody(req);
  if (c.status !== 'Validated') throw new HttpError(409, 'Only a validated contract can be approved. Run Validate first.');
  if (c.updatedBy && c.updatedBy === ctx.user) throw new HttpError(409, `Four-eyes rule: ${ctx.user} made the last change, so another user must approve. Switch user from the user menu.`);
  const upd = store.update('contracts', 'Contract', c.id, { status: 'Approved', approvedBy: ctx.user, approvedAt: new Date().toISOString(), approvalComment: body.comment || '' }, ctx);
  return ok(contractView(upd));
});
route('GET', '/api/contracts/:id/versions', (req, p) => ok(D().versions.filter(v => v.contractId === Number(p.id)).sort((a, b) => b.version - a.version)));
route('GET', '/api/versions', (req, p, q) => {
  let rows = D().versions.map(v => {
    const c = store.get('contracts', v.contractId);
    return { id: v.id, contractId: v.contractId, contractName: c ? c.name : `#${v.contractId} (deleted)`, legalEntityName: nameOf('legalEntities', v.snapshot.legalEntityId), version: v.version, effectiveDate: v.effectiveDate, createdAt: v.createdAt, createdBy: v.createdBy, comment: v.comment };
  });
  if (q.contractId) rows = rows.filter(r => r.contractId === Number(q.contractId));
  if (q.legalEntityId) rows = rows.filter(r => { const v = store.get('versions', r.id); return v.snapshot.legalEntityId === Number(q.legalEntityId); });
  if (q.from || q.to) rows = rows.filter(r => inRange(r.createdAt.slice(0, 10), q.from, q.to));
  return listResult(rows.reverse(), q);
});
route('GET', '/api/versions/:id', (req, p) => ok(store.get('versions', p.id) || notFound('Version')));

// Components (nested REST, as an Ext REST proxy builds it)
const COMPONENT_FIELDS = ['name', 'commodity', 'product', 'granularity', 'type', 'price', 'indexSeriesId', 'adder', 'referenceSeriesId', 'updateValue', 'usage'];
function componentView(k) { return Object.assign({}, k, { indexSeriesName: nameOf('timeseries', k.indexSeriesId), referenceSeriesName: nameOf('timeseries', k.referenceSeriesId) }); }
function checkComponent(d) {
  const errors = {};
  ['name', 'product', 'granularity', 'type'].forEach(f => { if (!d[f]) errors[f] = 'Required'; });
  if (d.type && !seed.componentTypes.includes(d.type)) errors.type = 'Unknown component type';
  if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
}
route('GET', '/api/contracts/:id/components', (req, p, q) => listResult(D().components.filter(k => k.contractId === Number(p.id)).map(componentView), q));
route('POST', '/api/contracts/:id/components', async (req, p, q, ctx) => {
  need(ctx, 'contracts.edit');
  const c = store.get('contracts', p.id) || notFound('Contract');
  const body = await readBody(req); const data = { contractId: c.id };
  COMPONENT_FIELDS.forEach(f => { if (body[f] !== undefined) data[f] = body[f]; });
  checkComponent(data);
  const k = store.insert('components', 'Contract Component', data, ctx);
  markUnvalidated(c.id, ctx); store.save();
  return ok(componentView(k));
});
const putComponent = async (req, p, q, ctx) => {
  need(ctx, 'contracts.edit');
  const k = store.get('components', p.cid || p.id) || notFound('Component');
  const body = await readBody(req); const changes = {};
  COMPONENT_FIELDS.forEach(f => { if (body[f] !== undefined) changes[f] = body[f]; });
  checkComponent(Object.assign({}, k, changes));
  const upd = store.update('components', 'Contract Component', k.id, changes, ctx);
  markUnvalidated(k.contractId, ctx); store.save();
  return ok(componentView(upd));
};
const deleteComponent = (req, p, q, ctx) => {
  need(ctx, 'contracts.edit');
  const k = store.get('components', p.cid || p.id) || notFound('Component');
  store.remove('components', 'Contract Component', k.id, ctx);
  markUnvalidated(k.contractId, ctx); store.save();
  return ok(null);
};
route('PUT', '/api/contracts/:id/components/:cid', putComponent);
route('DELETE', '/api/contracts/:id/components/:cid', deleteComponent);

// Trades
const TRADE_FIELDS = ['tradeDate', 'buySell', 'counterpartyId', 'product', 'deliveryStart', 'deliveryEnd', 'block', 'volumeMw', 'priceInrMwh', 'contractId', 'comments'];
const tradeView = t => Object.assign({}, t, { counterpartyName: nameOf('counterparties', t.counterpartyId), contractName: nameOf('contracts', t.contractId), notionalInr: Math.round(t.volumeMw * t.priceInrMwh * blockHours(t.block) * days(t)) });
function blockHours(b) { const m = /^(\d\d):\d\d-(\d\d):\d\d$/.exec(b || ''); return m ? Number(m[2]) - Number(m[1]) : 24; }
function days(t) { return Math.max(1, Math.round((Date.parse(t.deliveryEnd) - Date.parse(t.deliveryStart)) / 86400000) + 1); }
function checkTrade(d) {
  const errors = {};
  ['tradeDate', 'buySell', 'counterpartyId', 'product', 'deliveryStart', 'deliveryEnd', 'volumeMw', 'priceInrMwh'].forEach(f => { if (d[f] === undefined || d[f] === null || d[f] === '') errors[f] = 'Required'; });
  ['tradeDate', 'deliveryStart', 'deliveryEnd'].forEach(f => { if (d[f] && !isDate(d[f])) errors[f] = 'Use YYYY-MM-DD'; });
  if (d.deliveryEnd && d.deliveryStart && d.deliveryEnd < d.deliveryStart) errors.deliveryEnd = 'Delivery end is before delivery start';
  if (d.volumeMw !== undefined && !(Number(d.volumeMw) > 0)) errors.volumeMw = 'Must be greater than zero';
  if (d.priceInrMwh !== undefined && Number(d.priceInrMwh) > 10000) errors.priceInrMwh = 'Above the INR 10,000/MWh exchange price cap';
  if (d.counterpartyId && !store.get('counterparties', d.counterpartyId)) errors.counterpartyId = 'Unknown counterparty';
  if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
}
route('GET', '/api/trades', (req, p, q) => {
  let rows = D().trades;
  if (q.from || q.to) rows = rows.filter(t => inRange(t.tradeDate, q.from, q.to));
  if (q.status) rows = rows.filter(t => t.status === q.status);
  if (q.product) rows = rows.filter(t => t.product === q.product);
  if (q.buySell) rows = rows.filter(t => t.buySell === q.buySell);
  if (q.counterpartyId) rows = rows.filter(t => t.counterpartyId === Number(q.counterpartyId));
  if (q.contractId) rows = rows.filter(t => t.contractId === Number(q.contractId));
  return listResult(rows.map(tradeView), q);
});
route('GET', '/api/trades/:id', (req, p) => ok(tradeView(store.get('trades', p.id) || notFound('Trade'))));
route('POST', '/api/trades', async (req, p, q, ctx) => {
  need(ctx, 'trades.edit');
  const body = await readBody(req); const data = {};
  TRADE_FIELDS.forEach(f => { if (body[f] !== undefined) data[f] = body[f]; });
  checkTrade(data);
  const d = data.tradeDate.replace(/-/g, '');
  Object.assign(data, { tradeRef: `TR-${d}-${String(D().seq.trades + 1).padStart(3, '0')}`, status: 'New', trader: ctx.user, source: 'Manual', block: data.block || '00:00-24:00' });
  return ok(tradeView(store.insert('trades', 'Trade', data, ctx)));
});
route('PUT', '/api/trades/:id', async (req, p, q, ctx) => {
  need(ctx, 'trades.edit');
  const t = store.get('trades', p.id) || notFound('Trade');
  if (t.status === 'Settled' || t.status === 'Cancelled') throw new HttpError(409, `${t.status} trades cannot be edited`);
  const body = await readBody(req); const changes = {};
  TRADE_FIELDS.forEach(f => { if (body[f] !== undefined) changes[f] = body[f]; });
  checkTrade(Object.assign({}, t, changes));
  return ok(tradeView(store.update('trades', 'Trade', t.id, changes, ctx)));
});
route('DELETE', '/api/trades/:id', (req, p, q, ctx) => {
  need(ctx, 'trades.delete');
  const t = store.get('trades', p.id) || notFound('Trade');
  if (t.status !== 'New') throw new HttpError(409, 'Only New trades can be deleted; cancel confirmed trades instead');
  store.remove('trades', 'Trade', t.id, ctx); return ok(null);
});
route('POST', '/api/trades/:id/confirm', (req, p, q, ctx) => {
  need(ctx, 'trades.approve');
  const t = store.get('trades', p.id) || notFound('Trade');
  if (t.status !== 'New') throw new HttpError(409, `Trade is ${t.status}; only New trades can be confirmed`);
  return ok(tradeView(store.update('trades', 'Trade', t.id, { status: 'Confirmed' }, ctx)));
});
route('POST', '/api/trades/:id/cancel', async (req, p, q, ctx) => {
  need(ctx, 'trades.approve');
  const t = store.get('trades', p.id) || notFound('Trade');
  const body = await readBody(req);
  if (t.status === 'Settled' || t.status === 'Cancelled') throw new HttpError(409, `Trade is already ${t.status}`);
  if (!body.reason) bad('A cancellation reason is required', { reason: 'Required' });
  return ok(tradeView(store.update('trades', 'Trade', t.id, { status: 'Cancelled', comments: body.reason }, Object.assign({}, ctx, { reason: body.reason }))));
});

// Reference data (generic REST)
function referenceRoutes(base, coll, entityType, fields, required, inUse) {
  route('GET', base, (req, p, q) => {
    let rows = D()[coll];
    if (q.query) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.query.toLowerCase()));
    return listResult(rows, q);
  });
  route('GET', base + '/:id', (req, p) => ok(store.get(coll, p.id) || notFound(entityType)));
  const pickFields = body => { const d = {}; fields.forEach(f => { if (body[f] !== undefined) d[f] = body[f]; }); return d; };
  const check = (d, id) => {
    const errors = {};
    required.forEach(f => { if (d[f] === undefined || d[f] === null || d[f] === '') errors[f] = 'Required'; });
    if (d.name && D()[coll].some(r => r.name.toLowerCase() === String(d.name).toLowerCase() && r.id !== id)) errors.name = 'Name must be unique';
    if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
  };
  route('POST', base, async (req, p, q, ctx) => { need(ctx, 'reference.edit'); const d = pickFields(await readBody(req)); check(d); if (d.enabled === undefined) d.enabled = true; d.isSystem = false; return ok(store.insert(coll, entityType, d, ctx)); });
  route('PUT', base + '/:id', async (req, p, q, ctx) => {
    need(ctx, 'reference.edit');
    const r = store.get(coll, p.id) || notFound(entityType);
    const d = pickFields(await readBody(req)); check(Object.assign({}, r, d), r.id);
    if (r.isSystem && d.name && d.name !== r.name) throw new HttpError(409, 'System records cannot be renamed');
    return ok(store.update(coll, entityType, r.id, d, ctx));
  });
  route('DELETE', base + '/:id', (req, p, q, ctx) => {
    need(ctx, 'reference.delete');
    const r = store.get(coll, p.id) || notFound(entityType);
    if (r.isSystem) throw new HttpError(409, 'System records cannot be deleted; disable it instead');
    const used = inUse && inUse(r);
    if (used) throw new HttpError(409, `${entityType} is used by ${used}`);
    store.remove(coll, entityType, r.id, ctx); return ok(null);
  });
}
referenceRoutes('/api/counterparties', 'counterparties', 'Counterparty', ['code', 'name', 'type', 'region', 'creditLimit', 'enabled'], ['code', 'name', 'type'],
  r => { const n = D().contracts.filter(c => c.counterpartyId === r.id).length + D().trades.filter(t => t.counterpartyId === r.id).length; return n ? `${n} contract(s)/trade(s)` : null; });
referenceRoutes('/api/legal-entities', 'legalEntities', 'Legal Entity', ['code', 'name', 'country', 'taxId', 'enabled'], ['code', 'name'],
  r => { const n = D().contracts.filter(c => c.legalEntityId === r.id).length; return n ? `${n} contract(s)` : null; });
referenceRoutes('/api/commodities', 'commodities', 'Commodity', ['name', 'enabled', 'contractTypes'], ['name'],
  r => { const n = D().contracts.filter(c => (c.commodities || []).includes(r.name)).length; return n ? `${n} contract(s)` : null; });

// Time series
const TS_FIELDS = ['name', 'formula', 'type', 'granularity', 'unit', 'timeZone', 'enabled', 'manual', 'usage', 'description'];
const intervalsOf = g => (g === '15 Min' ? 96 : 24);
function seriesValues(ts, date) {
  const key = `${ts.id}|${date}`;
  const stored = D().tsData[key] || {};
  const n = intervalsOf(ts.granularity);
  const r = seed.rng(ts.id * 100003 + Number(date.replace(/-/g, '')));
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const hour = (i - 1) * 24 / n;
    let v;
    if (ts.unit === '%') v = hour < 6 || hour >= 19 ? 0 : Math.round(Math.sin(Math.PI * (hour - 6) / 13) * 1000) / 10;
    else if (ts.unit === 'INR/MWh') v = Math.round(ts.base * (0.75 + 0.5 * (hour >= 18 && hour < 23 ? 1 : hour >= 9 && hour < 16 ? 0.2 : 0.5)) + r() * 400);
    else v = Math.round(ts.base / (24 / (24 / n)) * (0.7 + 0.5 * (hour >= 9 && hour < 20 ? 1 : 0.3) + r() * 0.15) * 1000) / 1000;
    const s = stored[i];
    rows.push({ id: i, date, interval: i, label: `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`, value: s ? s.value : v, quality: s ? s.quality : (date <= ymd(new Date()) ? 'Actual' : 'Forecast') });
  }
  return rows;
}
route('GET', '/api/timeseries', (req, p, q) => {
  let rows = D().timeseries;
  if (q.name) rows = rows.filter(t => t.name.toLowerCase().includes(q.name.toLowerCase()) || t.formula.toLowerCase().includes(q.name.toLowerCase()));
  return listResult(rows, q);
});
route('GET', '/api/timeseries/:id', (req, p) => ok(store.get('timeseries', p.id) || notFound('Time series')));
route('POST', '/api/timeseries', async (req, p, q, ctx) => {
  need(ctx, 'data.edit');
  const body = await readBody(req); const d = {};
  TS_FIELDS.forEach(f => { if (body[f] !== undefined) d[f] = body[f]; });
  const errors = {};
  ['name', 'type', 'granularity', 'timeZone'].forEach(f => { if (!d[f]) errors[f] = 'Required'; });
  if (d.name && D().timeseries.some(t => t.name.toLowerCase() === d.name.toLowerCase())) errors.name = 'Name must be unique';
  if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
  Object.assign(d, { formula: d.formula || d.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), profileType: 'Time Array', dataType: 'Decimal', unit: d.unit || 'MWh', enabled: d.enabled !== false, isSystem: false, manual: true, base: 10 });
  return ok(store.insert('timeseries', 'Time Series', d, ctx));
});
route('PUT', '/api/timeseries/:id', async (req, p, q, ctx) => {
  need(ctx, 'data.edit');
  const t = store.get('timeseries', p.id) || notFound('Time series');
  const body = await readBody(req); const d = {};
  TS_FIELDS.forEach(f => { if (body[f] !== undefined) d[f] = body[f]; });
  return ok(store.update('timeseries', 'Time Series', t.id, d, ctx));
});
route('GET', '/api/timeseries/:id/data', (req, p, q) => {
  const t = store.get('timeseries', p.id) || notFound('Time series');
  const date = isDate(q.date) ? q.date : ymd(new Date());
  return ok(seriesValues(t, date), { total: intervalsOf(t.granularity) });
});
route('PUT', '/api/timeseries/:id/data', async (req, p, q, ctx) => {
  need(ctx, 'data.edit');
  const t = store.get('timeseries', p.id) || notFound('Time series');
  const body = await readBody(req);
  if (!isDate(body.date)) bad('date is required (YYYY-MM-DD)');
  if (!Array.isArray(body.values) || !body.values.length) bad('values must be a non-empty array');
  const n = intervalsOf(t.granularity);
  const before = seriesValues(t, body.date).reduce((m, r) => (m[r.interval] = r.value, m), {});
  const key = `${t.id}|${body.date}`;
  const stored = D().tsData[key] = D().tsData[key] || {};
  const errors = [];
  body.values.forEach(v => {
    const i = Number(v.interval);
    if (!(i >= 1 && i <= n)) return errors.push(`Interval ${v.interval} is outside 1-${n}`);
    if (v.value !== null && v.value !== '' && isNaN(Number(v.value))) return errors.push(`Interval ${i}: '${v.value}' is not a number`);
    stored[i] = { value: v.value === null || v.value === '' ? null : Number(v.value), quality: 'Manual' };
  });
  if (errors.length) bad(errors.join('; '));
  const after = seriesValues(t, body.date).reduce((m, r) => (m[r.interval] = r.value, m), {});
  store.audit('Time Series Data', { id: t.id, name: `${t.name} @ ${body.date}` }, 'UPDATE', before, after, ctx);
  store.save();
  return ok(seriesValues(t, body.date));
});

// Data ingestion
const INGEST = {
  trades: {
    columns: ['tradeDate', 'buySell', 'counterparty', 'product', 'deliveryStart', 'deliveryEnd', 'volumeMw', 'priceInrMwh'],
    row(r, issue) {
      ['tradeDate', 'deliveryStart', 'deliveryEnd'].forEach(c => { if (!isDate(r[c])) issue('Error', c, `'${r[c] || ''}' is not a date (YYYY-MM-DD)`); });
      const bs = String(r.buySell || '').trim().toLowerCase();
      const buySell = bs === 'b' || bs === 'buy' ? 'Buy' : bs === 's' || bs === 'sell' ? 'Sell' : null;
      if (!buySell) issue('Error', 'buySell', `'${r.buySell || ''}' must be Buy/Sell (or B/S)`);
      const cp = D().counterparties.find(c => c.code.toLowerCase() === String(r.counterparty || '').trim().toLowerCase() || c.name.toLowerCase() === String(r.counterparty || '').trim().toLowerCase());
      if (!cp) issue('Error', 'counterparty', `Unknown counterparty '${r.counterparty || ''}'`);
      else if (!cp.enabled) issue('Error', 'counterparty', `Counterparty ${cp.name} is disabled`);
      if (!seed.marketProducts.includes(r.product)) issue('Error', 'product', `Unknown product '${r.product || ''}'`);
      const vol = Number(r.volumeMw), px = Number(r.priceInrMwh);
      if (!(vol > 0)) issue('Error', 'volumeMw', `Volume '${r.volumeMw || ''}' must be a positive number`);
      if (isNaN(px) || r.priceInrMwh === '') issue('Error', 'priceInrMwh', `Price '${r.priceInrMwh || ''}' is not a number`);
      else if (px > 10000) issue('Error', 'priceInrMwh', `Price ${px} is above the INR 10,000/MWh cap`);
      else if (px > 8000) issue('Warning', 'priceInrMwh', `Price ${px} is unusually high`);
      if (isDate(r.deliveryStart) && isDate(r.deliveryEnd) && r.deliveryEnd < r.deliveryStart) issue('Error', 'deliveryEnd', 'Delivery end is before delivery start');
      return cp && buySell ? { tradeDate: r.tradeDate, buySell, counterpartyId: cp.id, product: r.product, deliveryStart: r.deliveryStart, deliveryEnd: r.deliveryEnd, volumeMw: vol, priceInrMwh: px, block: '00:00-24:00' } : null;
    },
    commit(rows, ctx) {
      rows.forEach(d => {
        Object.assign(d, { tradeRef: `TR-${d.tradeDate.replace(/-/g, '')}-${String(D().seq.trades + 1).padStart(3, '0')}`, status: 'New', trader: ctx.user, source: 'Ingestion', contractId: null, comments: '' });
        store.insert('trades', 'Trade', d, ctx);
      });
    }
  },
  meter: {
    columns: ['series', 'date', 'interval', 'value'],
    row(r, issue) {
      const ts = D().timeseries.find(t => t.formula.toLowerCase() === String(r.series || '').trim().toLowerCase() || t.name.toLowerCase() === String(r.series || '').trim().toLowerCase());
      if (!ts) issue('Error', 'series', `Unknown time series '${r.series || ''}'`);
      if (!isDate(r.date)) issue('Error', 'date', `'${r.date || ''}' is not a date (YYYY-MM-DD)`);
      const n = ts ? intervalsOf(ts.granularity) : 24, i = Number(r.interval);
      if (!(Number.isInteger(i) && i >= 1 && i <= n)) issue('Error', 'interval', `Interval '${r.interval || ''}' is outside 1-${n}`);
      const v = Number(r.value);
      if (r.value === '' || isNaN(v)) issue('Error', 'value', `Value '${r.value || ''}' is not a number`);
      else if (v < 0) issue('Warning', 'value', `Negative value ${v}; stored as reported`);
      else if (ts && ts.base && v > ts.base * 3) issue('Warning', 'value', `Spike: ${v} is over 3x the typical value`);
      return ts ? { tsId: ts.id, date: r.date, interval: i, value: v } : null;
    },
    commit(rows, ctx) {
      const touched = new Set();
      rows.forEach(d => {
        const key = `${d.tsId}|${d.date}`;
        (D().tsData[key] = D().tsData[key] || {})[d.interval] = { value: d.value, quality: 'Actual' };
        touched.add(key);
      });
      touched.forEach(k => { const [id, date] = k.split('|'); const t = store.get('timeseries', id); store.audit('Time Series Data', { id: t.id, name: `${t.name} @ ${date}` }, 'UPDATE', null, D().tsData[k], Object.assign({}, ctx, { reason: 'File ingestion' })); });
    }
  }
};
route('GET', '/api/ingestion/jobs', (req, p, q) => listResult(D().ingestionJobs.slice().reverse().map(j => Object.assign({}, j, { errors: undefined, errorCount: j.errors.length })), q));
route('GET', '/api/ingestion/jobs/:id/errors', (req, p, q) => { const j = store.get('ingestionJobs', p.id) || notFound('Job'); return listResult(j.errors.map((e, i) => Object.assign({ id: i + 1 }, e)), q); });
route('POST', '/api/ingestion/upload', async (req, p, q, ctx) => {
  need(ctx, 'data.edit');
  const body = await readBody(req);
  const spec = INGEST[body.target];
  if (!spec) bad('target must be "trades" or "meter"', { target: 'Required' });
  if (!body.fileName || !/\.csv$/i.test(body.fileName)) bad('Upload a .csv file', { file: 'CSV only' });
  const started = Date.now();
  const { header, rows } = parseCsv(String(body.content || ''));
  const errors = [];
  const missing = spec.columns.filter(c => !header.includes(c));
  const job = { id: store.nextId('ingestionJobs'), fileName: body.fileName, target: body.target, user: ctx.user, startedAt: new Date(started).toISOString() };
  if (missing.length) {
    errors.push({ row: 1, column: missing.join(', '), severity: 'Error', message: `Missing column(s): ${missing.join(', ')}. Expected: ${spec.columns.join(', ')}` });
    Object.assign(job, { total: rows.length, accepted: 0, rejected: rows.length, warnings: 0, status: 'Failed' });
  } else {
    const good = [];
    rows.forEach((r, idx) => {
      let hard = false;
      const issue = (severity, column, message) => { errors.push({ row: idx + 2, column, severity, message }); if (severity === 'Error') hard = true; };
      const out = spec.row(r, issue);
      if (!hard && out) good.push(out);
    });
    spec.commit(good, ctx);
    const warnings = errors.filter(e => e.severity === 'Warning').length;
    Object.assign(job, { total: rows.length, accepted: good.length, rejected: rows.length - good.length, warnings,
      status: !rows.length ? 'Failed' : good.length === 0 ? 'Failed' : (rows.length - good.length || warnings) ? 'Completed with warnings' : 'Completed' });
    if (!rows.length) errors.push({ row: 1, column: '', severity: 'Error', message: 'The file has no data rows' });
  }
  job.errors = errors;
  job.finishedAt = new Date().toISOString();
  D().ingestionJobs.push(job);
  store.audit('Ingestion Job', { id: job.id, name: job.fileName }, 'INSERT', null, Object.assign({}, job, { errors: `${errors.length} issue(s)` }), ctx);
  store.save();
  return ok(Object.assign({}, job, { errors: undefined, errorCount: errors.length }));
});

// Audit
route('GET', '/api/audit', (req, p, q) => {
  let rows = D().audit;
  if (q.entityType) rows = rows.filter(a => a.entityType === q.entityType);
  if (q.entityId) rows = rows.filter(a => a.entityId === Number(q.entityId));
  if (q.user) rows = rows.filter(a => a.user === q.user);
  if (q.action) rows = rows.filter(a => a.action === q.action);
  if (q.from || q.to) rows = rows.filter(a => inRange(a.at.slice(0, 10), q.from, q.to));
  if (q.query) rows = rows.filter(a => a.entityName.toLowerCase().includes(q.query.toLowerCase()));
  rows = rows.slice().reverse().map(a => ({ id: a.id, entityType: a.entityType, entityId: a.entityId, entityName: a.entityName, action: a.action, user: a.user, ip: a.ip, reason: a.reason, at: a.at, changed: a.changed.join(', ') }));
  return listResult(rows, q);
});
route('GET', '/api/audit/:id', (req, p) => ok(store.get('audit', p.id) || notFound('Audit entry')));

// User management
const userView = u => Object.assign({}, u, {
  roleNames: D().roles.filter(r => u.roleIds.includes(r.id)).map(r => r.name).join(', '),
  permissionCount: security.permissionsOf(D(), Object.assign({}, u, { enabled: true })).length
});
const roleView = r => Object.assign({}, r, {
  userCount: D().users.filter(u => u.roleIds.includes(r.id)).length,
  userNames: D().users.filter(u => u.roleIds.includes(r.id)).map(u => u.username).join(', '),
  permissionCount: r.permissions.length
});
route('GET', '/api/me', (req, p, q, ctx) => {
  const u = security.userByName(D(), ctx.user);
  return ok({ user: u ? userView(u) : { username: ctx.user, fullName: ctx.user, enabled: false, roleIds: [] }, permissions: ctx.perms });
});
route('GET', '/api/permissions', () => ok(security.MODULES.map(m => Object.assign({}, m, { actionLabels: m.actions.map(a => security.ACTION_LABELS[a]) }))));
route('GET', '/api/users', (req, p, q) => {
  let rows = D().users;
  if (q.query) rows = rows.filter(u => (u.username + ' ' + u.fullName + ' ' + u.email).toLowerCase().includes(q.query.toLowerCase()));
  if (q.roleId) rows = rows.filter(u => u.roleIds.includes(Number(q.roleId)));
  return listResult(rows.map(userView), q);
});
route('GET', '/api/users/:id', (req, p) => ok(userView(store.get('users', p.id) || notFound('User'))));
const USER_FIELDS = ['username', 'fullName', 'email', 'department', 'roleIds', 'enabled'];
function checkUser(d, id) {
  const errors = {};
  ['username', 'fullName', 'email'].forEach(f => { if (!d[f]) errors[f] = 'Required'; });
  if (d.username && !/^[a-z][a-z0-9._-]{2,30}$/.test(d.username)) errors.username = '3-31 characters: lower-case letters, digits, dot, dash or underscore, starting with a letter';
  if (d.username && D().users.some(u => u.username.toLowerCase() === d.username.toLowerCase() && u.id !== id)) errors.username = 'Username is already taken';
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) errors.email = 'Not a valid e-mail address';
  if (!Array.isArray(d.roleIds) || !d.roleIds.length) errors.roleIds = 'Assign at least one role';
  else if (d.roleIds.some(r => !store.get('roles', r))) errors.roleIds = 'Unknown role';
  if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
}
function adminsLeft(excludingUserId, nextUser) {
  const adminRole = D().roles.find(r => r.isSystem);
  return D().users.filter(u => u.id !== excludingUserId && u.enabled && u.roleIds.includes(adminRole.id)).length +
    (nextUser && nextUser.enabled && nextUser.roleIds.includes(adminRole.id) ? 1 : 0);
}
route('POST', '/api/users', async (req, p, q, ctx) => {
  need(ctx, 'users.manage');
  const body = await readBody(req); const d = {};
  USER_FIELDS.forEach(f => { if (body[f] !== undefined) d[f] = body[f]; });
  if (typeof d.username === 'string') d.username = d.username.trim().toLowerCase();
  if (d.enabled === undefined) d.enabled = true;
  checkUser(d);
  const hasPassword = body.password !== undefined && body.password !== '';
  const problem = hasPassword ? auth.passwordProblem(body.password) : null;
  if (problem) bad('Please correct the highlighted fields', { password: problem });
  d.createdAt = new Date().toISOString();
  const created = store.insert('users', 'User', d, ctx);
  if (hasPassword) { D().credentials[created.username] = auth.hashPassword(body.password); store.save(); }
  return ok(userView(created)); // without a password the user cannot sign in until an administrator sets one
});
route('PUT', '/api/users/:id', async (req, p, q, ctx) => {
  need(ctx, 'users.manage');
  const u = store.get('users', p.id) || notFound('User');
  const body = await readBody(req); const d = {};
  USER_FIELDS.forEach(f => { if (body[f] !== undefined) d[f] = body[f]; });
  if (d.username !== undefined && d.username !== u.username) bad('The username cannot be changed', { username: 'Cannot be changed' });
  const next = Object.assign({}, u, d);
  checkUser(next, u.id);
  if (!adminsLeft(u.id, next)) throw new HttpError(409, 'At least one enabled Administrator must remain.');
  if (body.password !== undefined && body.password !== '') {
    const problem = auth.passwordProblem(body.password);
    if (problem) bad('Please correct the highlighted fields', { password: problem });
    D().credentials[u.username] = auth.hashPassword(body.password);
    store.save();
  }
  return ok(userView(store.update('users', 'User', u.id, d, ctx)));
});
route('DELETE', '/api/users/:id', (req, p, q, ctx) => {
  need(ctx, 'users.manage');
  const u = store.get('users', p.id) || notFound('User');
  if (u.username === ctx.user) throw new HttpError(409, 'You cannot delete yourself.');
  if (!adminsLeft(u.id)) throw new HttpError(409, 'At least one enabled Administrator must remain.');
  const used = D().contracts.some(c => c.createdBy === u.username) || D().trades.some(t => t.trader === u.username);
  if (used) throw new HttpError(409, `${u.username} has contracts or trades on record. Disable the user instead of deleting.`);
  store.remove('users', 'User', u.id, ctx); delete D().credentials[u.username]; store.save(); return ok(null);
});
route('GET', '/api/roles', (req, p, q) => listResult(D().roles.map(roleView), q));
route('GET', '/api/roles/:id', (req, p) => ok(roleView(store.get('roles', p.id) || notFound('Role'))));
function checkRole(d, id) {
  const errors = {};
  if (!d.name) errors.name = 'Required';
  if (d.name && D().roles.some(r => r.name.toLowerCase() === String(d.name).toLowerCase() && r.id !== id)) errors.name = 'Role name must be unique';
  if (!Array.isArray(d.permissions)) errors.permissions = 'Required';
  else if (d.permissions.some(x => !security.ALL.includes(x))) errors.permissions = 'Unknown permission';
  if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
}
route('POST', '/api/roles', async (req, p, q, ctx) => {
  need(ctx, 'users.manage');
  const body = await readBody(req);
  const d = { name: body.name, description: body.description || '', permissions: body.permissions || [], isSystem: false };
  checkRole(d);
  return ok(roleView(store.insert('roles', 'Role', d, ctx)));
});
route('PUT', '/api/roles/:id', async (req, p, q, ctx) => {
  need(ctx, 'users.manage');
  const r = store.get('roles', p.id) || notFound('Role');
  const body = await readBody(req); const d = {};
  ['name', 'description', 'permissions'].forEach(f => { if (body[f] !== undefined) d[f] = body[f]; });
  if (r.isSystem && ((d.name && d.name !== r.name) || (d.permissions && d.permissions.length !== security.ALL.length))) {
    throw new HttpError(409, 'The Administrator role is a system role: its name and permissions cannot be changed.');
  }
  checkRole(Object.assign({}, r, d), r.id);
  return ok(roleView(store.update('roles', 'Role', r.id, d, ctx)));
});
route('DELETE', '/api/roles/:id', (req, p, q, ctx) => {
  need(ctx, 'users.manage');
  const r = store.get('roles', p.id) || notFound('Role');
  if (r.isSystem) throw new HttpError(409, 'System roles cannot be deleted.');
  const n = D().users.filter(u => u.roleIds.includes(r.id)).length;
  if (n) throw new HttpError(409, `${n} user(s) still have the ${r.name} role. Reassign them first.`);
  store.remove('roles', 'Role', r.id, ctx); return ok(null);
});

// ---------- modules generated by UI Forge (server/generated, see security.js) ----------
// Each generated module adds its routes through the same helpers as the hand-written ones, so it gets the same
// sign-in, permission checks (need), validation errors (bad), envelope (ok / listResult) and audit (store).
if (security.generated) {
  security.generated.register({ route, need, ok, bad, notFound, HttpError, readBody, listResult, sortRows, store, D, isDate, nameOf, lookups: STATIC_LOOKUPS });
}

// Admin
route('POST', '/api/admin/reset', (req, p, q, ctx) => { need(ctx, 'users.manage'); store.reset(); return ok({ message: 'Demo data reset' }); });
route('GET', '/api/health', () => ok({ status: 'ok', time: new Date().toISOString(), auth: auth.mode() }), { public: true });

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jsonp': 'application/javascript',
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.csv': 'text/csv; charset=utf-8' };
function serveStatic(req, res, pathname) {
  if (!WEB_ROOT) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h2>GridTrade Contracts</h2><p>The Ext JS app has not been built yet. Run <code>npm run build</code> (or <code>npm run build:debug</code>), then refresh. The API is running at <a href="/api/health">/api/health</a>.</p>');
  }
  let file = path.normalize(path.join(WEB_ROOT, decodeURIComponent(pathname)));
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  if (pathname === '/' || (fs.existsSync(file) && fs.statSync(file).isDirectory())) file = path.join(WEB_ROOT, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- display registry pass-through ----------
// A React build on the framework shell calls /registry/api/v1/... for its menus. Vite proxies that in development;
// when this server hosts the build (GT_WEB_ROOT), it forwards the same paths to the display registry.
const REGISTRY_URL = url.parse(process.env.GT_REGISTRY_URL || 'http://127.0.0.1:8130');
function proxyRegistry(req, res) {
  const target = req.url.replace(/^\/registry/, '') || '/';
  const headers = Object.assign({}, req.headers, { host: REGISTRY_URL.host });
  const up = http.request({ hostname: REGISTRY_URL.hostname, port: REGISTRY_URL.port || 80, path: target, method: req.method, headers }, r => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', e => send(res, 502, { success: false, message: `Display registry not reachable at ${REGISTRY_URL.href} (${e.code || e.message}). Start it with "display-registry" or set GT_REGISTRY_URL.` }));
  req.pipe(up);
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  if (pathname === '/registry' || pathname.startsWith('/registry/')) return proxyRegistry(req, res);
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  const r = routes.find(x => x.method === req.method && x.re.test(pathname));
  if (!r) return send(res, 404, { success: false, message: `No route for ${req.method} ${pathname}` });
  const m = r.re.exec(pathname); const params = {};
  r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  try {
    if (LATENCY) await new Promise(ok2 => setTimeout(ok2, LATENCY));
    const ctx = ctxOf(req);
    if (!ctx && !r.public) throw new HttpError(401, 'Sign in required');
    const out = await r.handler(req, params, query, ctx);
    send(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { success: false, message: e.message, errors: e.errors });
    console.error(e);
    send(res, 500, { success: false, message: 'Unexpected server error: ' + e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`GridTrade Contracts API  http://localhost:${PORT}/api/health`);
    try { auth.sign({}); } catch (e) { console.error(e.message); process.exit(1); } // load or create the signing secret now
    console.log(auth.mode() === 'demo'
      ? 'Sign-in: DEMO mode - the X-GT-User header is trusted without a password. Developer machines only.'
      : 'Sign-in: tokens required (POST /api/auth/login). Start with "npm run start:demo" for the Ext JS build, which still uses the demo header.');
    console.log(WEB_ROOT ? `Serving the web app from ${path.relative(ROOT, WEB_ROOT) || WEB_ROOT} -> http://localhost:${PORT}/` : 'Ext JS app not built yet: run "npm run build" (the API still works).');
    console.log(`Display registry pass-through: /registry -> ${REGISTRY_URL.href}`);
  });
}
module.exports = server;
