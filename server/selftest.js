'use strict';
// API self-test: starts the server on a free port with a throw-away database and walks the main workflows.
//   npm run test:api
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-selftest-'));
process.env.GT_LATENCY = '0';
process.env.GT_AUTH = 'demo'; // the workflow checks below use the demo header; sign-in is checked at the end
process.env.GT_SEED_PASSWORD = 'Selftest-Pass-1';
process.env.GT_DB_FILE = path.join(tmp, 'db.json'); // never touches your demo data

const server = require('./server');
const store = require('./db');
store.reset();

let failures = 0, passed = 0;
const check = (name, cond, extra) => { if (cond) { passed++; console.log('  ok   ' + name); } else { failures++; console.log('  FAIL ' + name + (extra ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); } };

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const callT = async (method, p, body, token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const call = async (method, p, body, user) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-GT-User': user || 'demo.trader' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try {
    console.log('GridTrade Contracts API self-test');
    let r = await call('GET', '/health');
    check('health', r.status === 200 && r.body.data.status === 'ok');
    r = await call('GET', '/lookups/counterparties');
    check('lookups', r.body.data.length >= 10);
    r = await call('GET', '/contracts');
    check('contract list', r.body.total >= 20, r.body.total);
    r = await call('GET', '/contracts?status=Pending');
    check('pending filter', r.body.data.every(c => c.status !== 'Approved'));

    r = await call('POST', '/contracts', { name: '' });
    check('create validation (400 + field errors)', r.status === 400 && r.body.errors.name === 'Required', r.body);

    r = await call('POST', '/contracts', { name: 'Selftest PPA', type: 'Green PPA', transactionType: 'Purchase', counterpartyId: 8, legalEntityId: 2, timeZone: 'IST',
      effectiveDate: '2026-11-01', startDate: '2026-11-01', endDate: '2027-10-31', commodities: ['Energy'] });
    check('create contract', r.status === 200 && r.body.data.status === 'Draft' && r.body.data.version === 1, r.body);
    const id = r.body.data.id;

    r = await call('POST', `/contracts/${id}/validate`);
    check('validation fails without components', r.body.data.valid === false);

    r = await call('POST', `/contracts/${id}/components`, { name: 'Solar price', product: 'Solar Profile', granularity: 'Hourly', type: 'Fixed Price', price: 3200, commodity: 'Energy' });
    check('add component', r.status === 200 && r.body.data.contractId === id);
    const compId = r.body.data.id;

    r = await call('POST', `/contracts/${id}/validate`);
    check('Green PPA needs REC', r.body.data.valid === false && r.body.data.messages.some(m => /Renewable/.test(m.message)));

    r = await call('PUT', `/contracts/${id}`, { commodities: ['Energy', 'Renewable Energy Certificate'], versionComment: 'Add REC' });
    check('update creates version 2', r.body.data.version === 2);

    r = await call('POST', `/contracts/${id}/validate`);
    check('validation passes', r.body.data.valid === true && r.body.data.contract.status === 'Validated');

    r = await call('POST', `/contracts/${id}/approve`, {});
    check('trader has no approve permission (403)', r.status === 403, r.body);
    r = await call('POST', `/contracts/${id}/approve`, { comment: 'ok' }, 'risk.manager');
    check('approve by another user', r.status === 200 && r.body.data.status === 'Approved');

    r = await call('DELETE', `/contracts/${id}`, null, 'admin');
    check('approved contract cannot be deleted', r.status === 409);

    r = await call('PUT', `/contracts/${id}/components/${compId}`, { price: 3300 });
    check('component edit resets approval', r.status === 200);
    r = await call('GET', `/contracts/${id}`);
    check('contract back to Draft', r.body.data.status === 'Draft');

    r = await call('GET', `/contracts/${id}/versions`);
    check('versions listed', r.body.data.length === 2);

    r = await call('GET', `/audit?entityType=Contract&entityId=${id}`);
    check('audit entries recorded', r.body.total >= 3, r.body.total);
    const upd = r.body.data.find(a => a.action === 'UPDATE' && a.changed.includes('commodities'));
    r = await call('GET', `/audit/${upd.id}`);
    check('audit before/after', r.body.data.before.commodities.length === 1 && r.body.data.after.commodities.length === 2);

    r = await call('POST', '/trades', { tradeDate: '2026-10-21', buySell: 'Buy', counterpartyId: 1, product: 'DAM', deliveryStart: '2026-10-22', deliveryEnd: '2026-10-22', volumeMw: 10, priceInrMwh: 4500 });
    check('create trade', r.status === 200 && r.body.data.status === 'New' && r.body.data.notionalInr === 1080000, r.body.data);
    const tid = r.body.data.id;
    r = await call('POST', '/trades', { tradeDate: '2026-10-21', buySell: 'Buy', counterpartyId: 1, product: 'DAM', deliveryStart: '2026-10-22', deliveryEnd: '2026-10-22', volumeMw: 10, priceInrMwh: 12000 });
    check('price cap enforced', r.status === 400 && r.body.errors.priceInrMwh);
    r = await call('POST', `/trades/${tid}/confirm`);
    check('trader cannot confirm trades (403)', r.status === 403);
    r = await call('POST', `/trades/${tid}/confirm`, null, 'ops.analyst');
    check('confirm trade', r.body.data.status === 'Confirmed');
    r = await call('POST', `/trades/${tid}/cancel`, {}, 'ops.analyst');
    check('cancel needs reason', r.status === 400);
    r = await call('POST', `/trades/${tid}/cancel`, { reason: 'Duplicate' }, 'ops.analyst');
    check('cancel trade', r.body.data.status === 'Cancelled');

    const csv = fs.readFileSync(path.join(__dirname, '..', 'web', 'resources', 'samples', 'trades-sample.csv'), 'utf8');
    r = await call('POST', '/ingestion/upload', { target: 'trades', fileName: 'trades-sample.csv', content: csv });
    check('trader cannot load files (403)', r.status === 403);
    r = await call('POST', '/ingestion/upload', { target: 'trades', fileName: 'trades-sample.csv', content: csv }, 'ops.analyst');
    check('ingest trades sample', r.body.data.total === 12 && r.body.data.accepted === 6 && r.body.data.rejected === 6, r.body.data);
    r = await call('GET', `/ingestion/jobs/${r.body.data.id}/errors`);
    check('row-level errors', r.body.data.some(e => /ZZZ/.test(e.message)));
    const meter = fs.readFileSync(path.join(__dirname, '..', 'web', 'resources', 'samples', 'meter-sample.csv'), 'utf8');
    r = await call('POST', '/ingestion/upload', { target: 'meter', fileName: 'meter-sample.csv', content: meter }, 'ops.analyst');
    check('ingest meter sample', r.body.data.accepted === 49 && r.body.data.rejected === 3, r.body.data);

    r = await call('GET', '/timeseries/1/data?date=2026-10-20');
    check('series data (24 intervals)', r.body.data.length === 24);
    r = await call('PUT', '/timeseries/1/data', { date: '2026-10-20', values: [{ interval: 5, value: 2.5 }] }, 'ops.analyst');
    check('save interval value', r.body.data[4].value === 2.5 && r.body.data[4].quality === 'Manual');

    r = await call('DELETE', '/commodities/1', null, 'ops.analyst');
    check('system commodity protected', r.status === 409);
    r = await call('DELETE', '/counterparties/1', null, 'ops.analyst');
    check('counterparty in use protected', r.status === 409);

    // four-eyes: the user who made the last change cannot approve, even with the permission
    r = await call('PUT', `/contracts/2`, { notes: 'admin edit' }, 'admin');
    r = await call('POST', `/contracts/2/components`, { name: 'x', product: 'Peak', granularity: 'Hourly', type: 'Fixed Price', price: 3000, commodity: 'Energy' }, 'admin');
    r = await call('POST', `/contracts/2/validate`, null, 'admin');
    r = await call('POST', `/contracts/2/approve`, {}, 'admin');
    check('four-eyes blocks self approval (409)', r.status === 409, r.body);

    // user management
    r = await call('GET', '/me');
    check('/me returns permissions', r.body.data.user.username === 'demo.trader' && r.body.data.permissions.includes('contracts.edit') && !r.body.data.permissions.includes('users.manage'));
    r = await call('GET', '/permissions');
    check('permission catalog', r.body.data.some(m => m.module === 'users'));
    r = await call('POST', '/users', { username: 'new.user', fullName: 'New User', email: 'new.user@gridtrade.example', roleIds: [5] });
    check('trader cannot create users (403)', r.status === 403);
    r = await call('POST', '/users', { username: 'New User', fullName: '', email: 'bad', roleIds: [] }, 'admin');
    check('user validation', r.status === 400 && r.body.errors.username && r.body.errors.email && r.body.errors.roleIds, r.body);
    r = await call('POST', '/users', { username: 'new.user', fullName: 'New User', email: 'new.user@gridtrade.example', department: 'Risk', roleIds: [5] }, 'admin');
    check('create user', r.status === 200 && r.body.data.roleNames === 'Read Only', r.body);
    const uid = r.body.data.id;
    r = await call('PUT', `/users/${uid}`, { roleIds: [4, 5] }, 'admin');
    check('change roles', r.body.data.roleNames === 'Risk Manager, Read Only');
    r = await call('GET', '/me', null, 'new.user');
    check('roles combine permissions', r.body.data.permissions.includes('contracts.approve'));
    r = await call('PUT', `/users/${uid}`, { enabled: false }, 'admin');
    r = await call('GET', '/me', null, 'new.user');
    check('disabled user has no permissions', r.body.data.permissions.length === 0);
    r = await call('PUT', `/users/4`, { enabled: false }, 'admin');
    check('last administrator protected (409)', r.status === 409);
    r = await call('POST', '/roles', { name: 'Scheduler', description: 'Data loads', permissions: ['dashboard.view', 'data.view', 'data.edit'] }, 'admin');
    check('create role', r.status === 200 && r.body.data.permissionCount === 3);
    r = await call('GET', '/counterparties/2', null, 'admin');
    check('reference record by id', r.status === 200 && r.body.data.id === 2);
    r = await call('POST', '/roles', { name: 'Bad', permissions: ['nope.view'] }, 'admin');
    check('unknown permission rejected', r.status === 400);
    r = await call('DELETE', '/roles/5', null, 'admin');
    check('role in use cannot be deleted (409)', r.status === 409);
    r = await call('PUT', '/roles/1', { permissions: ['dashboard.view'] }, 'admin');
    check('administrator role protected (409)', r.status === 409);
    r = await call('GET', '/audit?entityType=User');
    check('user changes audited', r.body.total >= 3);

    console.log('Sign-in');
    const auth = require('./auth');
    process.env.GT_AUTH = 'jwt';
    r = await callT('GET', '/me');
    check('jwt mode: no token is 401', r.status === 401);
    r = await call('GET', '/me', null, 'admin');
    check('jwt mode: demo header is refused', r.status === 401);
    r = await callT('GET', '/health');
    check('health stays public', r.status === 200 && r.body.data.auth === 'jwt');
    r = await callT('POST', '/auth/login', { username: 'admin', password: 'wrong-password-1' });
    check('wrong password is 401', r.status === 401 && r.body.message === 'Wrong username or password');
    r = await callT('POST', '/auth/login', { username: 'nobody', password: 'Selftest-Pass-1' });
    check('unknown user gets the same 401', r.status === 401 && r.body.message === 'Wrong username or password');
    r = await callT('POST', '/auth/login', { username: 'Admin', password: 'Selftest-Pass-1' });
    check('login', r.status === 200 && r.body.data.token && r.body.data.permissions.includes('displays.register'), r.body);
    const adminToken = r.body.data.token;
    const claims = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url').toString());
    check('token claims', claims.sub === 'admin' && claims.iss === 'gridtrade' && claims.aud === 'gridtrade-app' && claims.exp > claims.iat);
    r = await callT('GET', '/me', null, adminToken);
    check('bearer /me', r.status === 200 && r.body.data.user.username === 'admin');
    check('no credentials in user API', !JSON.stringify((await callT('GET', '/users', null, adminToken)).body).includes('scrypt'));
    r = await callT('GET', '/permissions', null, adminToken);
    check('catalog lists display registration', r.body.data.some(m => m.module === 'displays' && m.actions.includes('register')));
    r = await callT('GET', '/me', null, adminToken.slice(0, -3) + (adminToken.endsWith('AAA') ? 'BBB' : 'AAA'));
    check('tampered token is 401', r.status === 401);
    const expired = auth.sign(Object.assign({}, claims, { exp: Math.floor(Date.now() / 1000) - 5 }));
    r = await callT('GET', '/me', null, expired);
    check('expired token is 401', r.status === 401 && /expired/i.test(r.body.message));
    const foreign = auth.sign(Object.assign({}, claims, { aud: 'other-app' }));
    check('token for another app is 401', (await callT('GET', '/me', null, foreign)).status === 401);
    r = await callT('POST', '/auth/refresh', null, adminToken);
    check('refresh', r.status === 200 && r.body.data.token && r.body.data.token !== adminToken);
    r = await callT('POST', '/users', { username: 'pw.user', fullName: 'Pw User', email: 'pw.user@gridtrade.example', roleIds: [5], password: 'short' }, adminToken);
    check('weak password rejected', r.status === 400 && r.body.errors.password);
    r = await callT('POST', '/users', { username: 'pw.user', fullName: 'Pw User', email: 'pw.user@gridtrade.example', roleIds: [5], password: 'Pw-User-Pass-9' }, adminToken);
    check('admin creates a user with a password', r.status === 200);
    const pwId = r.body.data.id;
    r = await callT('POST', '/auth/login', { username: 'pw.user', password: 'Pw-User-Pass-9' });
    check('new user signs in', r.status === 200 && !r.body.data.permissions.includes('users.manage'));
    const userToken = r.body.data.token;
    r = await callT('POST', '/counterparties', { code: 'ZZ1', name: 'Nope', type: 'Industrial' }, userToken);
    check('read-only token cannot write (403)', r.status === 403);
    r = await callT('POST', '/auth/password', { currentPassword: 'Pw-User-Pass-9', newPassword: 'Pw-User-Pass-10' }, userToken);
    check('change own password', r.status === 200);
    check('old password no longer works', (await callT('POST', '/auth/login', { username: 'pw.user', password: 'Pw-User-Pass-9' })).status === 401);
    await callT('PUT', `/users/${pwId}`, { enabled: false }, adminToken);
    check('disabled user token stops working', (await callT('GET', '/me', null, userToken)).status === 401);
    r = await callT('POST', '/auth/login', { username: 'pw.user', password: 'Pw-User-Pass-10' });
    check('disabled user cannot sign in (403)', r.status === 403);
    for (let i = 0; i < 5; i++) await callT('POST', '/auth/login', { username: 'risk.manager', password: 'bad-guess-' + i });
    r = await callT('POST', '/auth/login', { username: 'risk.manager', password: 'Selftest-Pass-1' });
    check('lock after 5 failures (429)', r.status === 429);
    const audit = JSON.stringify((await callT('GET', '/audit?entityType=User&limit=500&start=0', null, adminToken)).body);
    check('passwords never reach the audit trail', !audit.includes('scrypt') && !audit.includes('Pw-User'));
  } catch (e) {
    failures++;
    console.error(e);
  }
  console.log(`\n${passed} passed, ${failures} failed`);
  server.close();
  setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failures ? 1 : 0); }, 500);
});
