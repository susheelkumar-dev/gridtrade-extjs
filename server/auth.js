'use strict';
// Sign-in for GridTrade: scrypt password hashes and HS256 JSON Web Tokens, using only Node's crypto module.
//
//   GT_AUTH            jwt (default): every API call except /api/health and /api/auth/login needs
//                      "Authorization: Bearer <token>".
//                      demo: also accepts the old X-GT-User header (the Ext JS build and its tests use it).
//                      Never use demo outside a developer machine.
//   GT_JWT_SECRET      signing secret, at least 32 characters. Share it with the display registry
//                      (its app config names the variable). When unset, a random secret is created once in
//                      server/data/jwt-secret and reused; set GT_JWT_SECRET from that file for the registry.
//   GT_JWT_TTL_MINUTES token lifetime, default 30. The UI refreshes tokens before they expire.
//   GT_SEED_PASSWORD   initial password given to seeded users that have none yet (development only).
//
// Credentials live in their own collection (db.credentials), never on the user record, so they never reach
// the audit trail or a user API response.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ISSUER = 'gridtrade';
const AUDIENCE = 'gridtrade-app';
const DEV_SEED_PASSWORD = 'GridTrade#2026';
const MIN_PASSWORD = 10;

let secretCache = null;
function secret() {
  if (secretCache) return secretCache;
  const fromEnv = process.env.GT_JWT_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('GT_JWT_SECRET must be at least 32 characters');
    secretCache = fromEnv;
    return secretCache;
  }
  const file = path.join(path.dirname(process.env.GT_DB_FILE || path.join(__dirname, 'data', 'db.json')), 'jwt-secret');
  if (fs.existsSync(file)) {
    secretCache = fs.readFileSync(file, 'utf8').trim();
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    secretCache = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(file, secretCache, { mode: 0o600 });
    console.log(`Created a JWT signing secret in ${path.relative(process.cwd(), file)}. Set GT_JWT_SECRET from it for the display registry.`);
  }
  return secretCache;
}

const mode = () => (process.env.GT_AUTH || 'jwt').toLowerCase();
const ttlSeconds = () => Math.max(60, Number(process.env.GT_JWT_TTL_MINUTES || 30) * 60);
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

function sign(claims) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  const sig = crypto.createHmac('sha256', secret()).update(head + '.' + body).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** Returns the claims, or throws an Error whose message is safe to show. */
function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [head, body, sig] = parts;
  let header;
  try { header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')); } catch (e) { throw new Error('Malformed token'); }
  if (header.alg !== 'HS256') throw new Error('Unsupported token algorithm');
  const expected = crypto.createHmac('sha256', secret()).update(head + '.' + body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('Invalid token signature');
  let claims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { throw new Error('Malformed token'); }
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) throw new Error('Token is not for this application');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('Session expired: sign in again');
  return claims;
}

function issue(user, roles, permissions) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds();
  const token = sign({ iss: ISSUER, aud: AUDIENCE, sub: user.username, name: user.fullName, roles, permissions,
    iat: now, exp, jti: crypto.randomUUID() });
  return { token, expiresAt: new Date(exp * 1000).toISOString(), expiresIn: exp - now };
}

// ---- passwords
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(String(password), salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function checkPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(got, expected);
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `At least ${MIN_PASSWORD} characters`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use letters and at least one digit';
  return null;
}

/**
 * Gives users the development seed password when the database has no credentials yet (first start, or a
 * database from before sign-in existed) or after a data reset. Users created later get a password from an
 * administrator; until then they cannot sign in. Returns true when it changed data.
 */
function ensureCredentials(db, opts) {
  const fresh = !db.credentials || typeof db.credentials !== 'object';
  if (fresh) db.credentials = {};
  if (!fresh && !(opts && opts.reset)) return false;
  const seedPassword = process.env.GT_SEED_PASSWORD || DEV_SEED_PASSWORD;
  // Optional per-user seed passwords, e.g. GT_SEED_PASSWORDS='{"auditor":"public-demo-pass"}': a hosted demo can
  // publish one read-only login without revealing the password of every other account.
  let perUser = {};
  try { perUser = JSON.parse(process.env.GT_SEED_PASSWORDS || '{}') || {}; } catch (e) { throw new Error('GT_SEED_PASSWORDS must be a JSON object of {username: password}'); }
  let seeded = 0;
  for (const u of db.users || []) {
    if (!db.credentials[u.username]) { db.credentials[u.username] = hashPassword(String(perUser[u.username] || seedPassword)); seeded++; }
  }
  if (seeded && !process.env.GT_SEED_PASSWORD) {
    console.log(`Gave ${seeded} user(s) the development password. Set GT_SEED_PASSWORD before first start, or change passwords in User Management.`);
  }
  return fresh || seeded > 0;
}

// ---- brute-force protection: 5 failures per username+IP lock it for 5 minutes
const failures = new Map();
const LOCK_AFTER = 5, LOCK_MS = 5 * 60 * 1000;
function lockedFor(key) {
  const f = failures.get(key);
  if (!f || f.count < LOCK_AFTER) return 0;
  const left = f.at + LOCK_MS - Date.now();
  if (left <= 0) { failures.delete(key); return 0; }
  return Math.ceil(left / 1000);
}
function recordFailure(key) {
  const f = failures.get(key) || { count: 0, at: 0 };
  f.count++; f.at = Date.now();
  failures.set(key, f);
}
function clearFailures(key) { failures.delete(key); }

module.exports = { ISSUER, AUDIENCE, mode, sign, verify, issue, hashPassword, checkPassword, passwordProblem,
  ensureCredentials, lockedFor, recordFailure, clearFailures, _resetSecret: () => { secretCache = null; } };
