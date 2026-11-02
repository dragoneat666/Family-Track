import crypto from 'node:crypto';
import { db, getSecret, setSecret } from './db.js';

// Two layers:
//  - Every device (tablet/phone) gets a long random token when it is set up
//    with the parent PIN. All API calls need it.
//  - Parent screens additionally need a short-lived parent session, opened
//    by entering the PIN again. Kids never see the PIN.

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function pinMatches(pin) {
  const stored = getSecret('parent_pin');
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

export const isSetUp = () => getSecret('parent_pin') !== null;

export function setPin(pin) {
  if (!/^\d{4,8}$/.test(String(pin))) throw httpError(400, 'PIN must be 4–8 digits');
  setSecret('parent_pin', hashPin(pin));
}

// Slow down PIN guessing: 5 wrong tries locks that address out for 10 minutes.
const failures = new Map();
export function checkPin(pin, ip) {
  const f = failures.get(ip);
  if (f && f.count >= 5 && Date.now() - f.last < 10 * 60 * 1000) {
    throw httpError(429, 'Too many wrong PINs. Try again in 10 minutes.');
  }
  if (!pinMatches(pin)) {
    failures.set(ip, { count: (f?.count || 0) + 1, last: Date.now() });
    throw httpError(401, 'Wrong PIN');
  }
  failures.delete(ip);
}

export function registerDevice(name) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO devices (name, token_hash) VALUES (?, ?)').run(String(name || 'Device').slice(0, 60), sha256(token));
  return token;
}

const parentSessions = new Map(); // token -> expires (ms)
const PARENT_SESSION_MS = 30 * 60 * 1000;

export function openParentSession() {
  const token = crypto.randomBytes(24).toString('base64url');
  parentSessions.set(token, Date.now() + PARENT_SESSION_MS);
  return token;
}

export function requireDevice(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  // <img>/<a> style downloads can't set headers, so asset URLs may carry ?t=
  const token = m?.[1] || req.query.t;
  const device = token && db.prepare('SELECT id FROM devices WHERE token_hash = ?').get(sha256(String(token)));
  if (!device) return res.status(401).json({ error: 'This device is not set up' });
  db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(device.id);
  req.deviceId = device.id;
  next();
}

export function requireParent(req, res, next) {
  const token = req.get('x-parent-token');
  const expires = token && parentSessions.get(token);
  if (!expires || expires < Date.now()) {
    if (token) parentSessions.delete(token);
    return res.status(403).json({ error: 'Parent PIN needed', parentLocked: true });
  }
  parentSessions.set(token, Date.now() + PARENT_SESSION_MS); // sliding expiry
  next();
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
