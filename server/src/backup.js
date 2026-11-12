import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { DATA_DIR } from './config.js';

// A full copy of the database every night (and when the server starts, if
// there's none from the last day), in data/backups as
// family-track-YYYY-MM-DD.db. VACUUM INTO makes a clean, complete copy
// while the app keeps running. The last two weeks are kept here; a script
// on the server copies them on (to Dropbox).

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_DAYS = 14;
const AT_HOUR = 1, AT_MINUTE = 30; // before the 2:00 copy to Dropbox
const NAME = /^family-track-(\d{4}-\d{2}-\d{2})\.db$/;
const DAY = 24 * 3600e3;

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function backUpNow() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `family-track-${dayOf(new Date())}.db`);
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, file); // (a copy cut short never looks like a backup)
  // Older than two weeks: gone.
  const cutoff = dayOf(new Date(Date.now() - KEEP_DAYS * DAY));
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    const m = NAME.exec(f);
    if (m && m[1] < cutoff) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  }
  return file;
}

function backUp() {
  try {
    const file = backUpNow();
    console.log(`Database backed up: ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  } catch (e) {
    console.error('Database backup failed:', e);
  }
}

function nextRun() {
  const t = new Date();
  t.setHours(AT_HOUR, AT_MINUTE, 0, 0);
  if (t <= new Date()) t.setDate(t.getDate() + 1);
  return t - Date.now();
}

export function startBackups() {
  let recent = false;
  try {
    recent = fs.readdirSync(BACKUP_DIR).some((f) => NAME.test(f) && Date.now() - fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs < DAY);
  } catch { /* no folder yet */ }
  if (!recent) setTimeout(backUp, 30 * 1000); // shortly after starting
  const loop = () => setTimeout(() => { backUp(); loop(); }, nextRun());
  loop();
}
