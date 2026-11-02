import crypto from 'node:crypto';
import { db } from './db.js';

// Accounts and devices:
//  - Grown-up accounts each have their own PIN. Kid accounts have none.
//  - Every device (phone, tablet, browser) gets a long random token the
//    first time someone signs in on it, and remembers which account is
//    signed in there.
//  - Signing in as a grown-up needs that grown-up's PIN. Signing in as a kid
//    needs any grown-up's PIN, unless a grown-up is already signed in on that
//    device. That's what stops one kid switching into another's account.

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function pinMatchesHash(pin, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

export function validPin(pin) {
  if (!/^\d{4,8}$/.test(String(pin ?? ''))) throw httpError(400, 'PIN must be 4–8 digits');
  return String(pin);
}

const adults = () => db.prepare('SELECT * FROM profiles WHERE is_parent = 1 AND is_test = 0').all();
export const hasAdults = () => adults().length > 0;

// Slow down PIN guessing: 5 wrong tries locks that address out for 10 minutes.
const failures = new Map();
function guard(ip, ok) {
  const f = failures.get(ip);
  if (f && f.count >= 5 && Date.now() - f.last < 10 * 60 * 1000) {
    throw httpError(429, 'Too many wrong PINs. Try again in 10 minutes.');
  }
  if (!ok()) {
    failures.set(ip, { count: (f?.count || 0) + 1, last: Date.now() });
    throw httpError(401, 'Wrong PIN');
  }
  failures.delete(ip);
}

export function checkAccountPin(account, pin, ip) {
  guard(ip, () => pinMatchesHash(pin, account.pin_hash));
}

export function checkAnyAdultPin(pin, ip) {
  guard(ip, () => adults().some((a) => pinMatchesHash(pin, a.pin_hash)));
}

export function createDevice(name, profileId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO devices (name, token_hash, profile_id) VALUES (?, ?, ?)')
    .run(String(name || 'Device').slice(0, 60), sha256(token), profileId ?? null);
  return token;
}

function deviceFromRequest(req) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  const token = m?.[1] || req.query.t;
  return token ? db.prepare('SELECT * FROM devices WHERE token_hash = ?').get(sha256(String(token))) : null;
}

// For routes that work with or without a signed-in device (sign-in itself).
export function optionalDevice(req, res, next) {
  const device = deviceFromRequest(req);
  if (device) {
    req.device = device;
    req.account = device.profile_id ? db.prepare('SELECT * FROM profiles WHERE id = ?').get(device.profile_id) : null;
  }
  next();
}

// Everything else: a known device with someone signed in.
export function requireAccount(req, res, next) {
  const device = deviceFromRequest(req);
  if (!device) return res.status(401).json({ error: 'This device is not signed in', signedOut: true });
  const account = device.profile_id && db.prepare('SELECT * FROM profiles WHERE id = ?').get(device.profile_id);
  if (!account) return res.status(401).json({ error: 'Pick who you are first', signedOut: true, deviceKnown: true });
  db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(device.id);
  req.device = device;
  req.account = account;
  next();
}

export function requireAdult(req, res, next) {
  if (!req.account?.is_parent || req.account.is_test) return res.status(403).json({ error: 'Grown-ups only' });
  next();
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
