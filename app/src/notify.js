import { registerPlugin } from '@capacitor/core';
import { api, isNative } from './api.js';

// Android notifications: reminders at a time, and things pinned to the
// status bar. The native side (android/.../notify) does the real work so it
// keeps going with the app closed:
//  - The server says what this phone should show (GET /api/notify/plan).
//    The phone fetches that whenever the app asks, and by itself about every
//    15 minutes, and sets Android alarms for it. Alarms fire with no network.
//  - Changes made on this phone that the server hasn't heard yet are passed
//    in as "overrides", so pinning something while offline still works.
//  - Buttons on a notification (Done) are sent to the server from the
//    notification itself, without opening the app. If that fails they wait
//    as events for the app to send later.
// In a browser none of this exists and every call quietly does nothing.

const Native = isNative ? registerPlugin('FamilyNotify') : null;
const quiet = (p) => p.catch((e) => { console.warn('notify:', e?.message || e); return null; });

const tapListeners = new Set();
const eventListeners = new Set();
let pendingTap = null;

if (Native) {
  // The app was already open (or in the background) when a notification was tapped.
  Native.addListener('tap', (tap) => deliverTap(tap));
  // A notification button was used while the app is alive.
  Native.addListener('action', () => notify.drainEvents());
}

function deliverTap(tap) {
  if (!tap?.screen) return;
  if (tapListeners.size) for (const fn of tapListeners) fn(tap);
  else pendingTap = tap;
}

export const notify = {
  available: !!Native,

  // Tell the native side where the server is and who this device is. Call at
  // start and after signing in or out; with no token everything is cleared.
  async configure() {
    if (!Native) return;
    await quiet(Native.configure({ server: api.serverUrl || '', token: api.token || '' }));
    const launch = await quiet(Native.takeLaunchTap());
    if (launch?.tap) deliverTap(launch.tap);
  },

  // Fetch the plan and bring alarms and pins in line with it. Resolves with
  // { fetched } so the caller knows whether the server was reached.
  async sync(overrides = []) {
    if (!Native) return { fetched: false };
    return (await quiet(Native.sync({ overrides }))) || { fetched: false };
  },

  // Buttons tapped on notifications since last asked: [{ id, action, post, sent }].
  onEvents(fn) {
    eventListeners.add(fn);
    return () => eventListeners.delete(fn);
  },
  async drainEvents() {
    if (!Native) return;
    const r = await quiet(Native.takeEvents());
    if (r?.events?.length) for (const fn of eventListeners) fn(r.events);
  },

  // A tapped notification says where to go: { screen: 'list', list, item }.
  onTap(fn) {
    tapListeners.add(fn);
    if (pendingTap) {
      const tap = pendingTap;
      pendingTap = null;
      fn(tap);
    }
    return () => tapListeners.delete(fn);
  },

  // 'granted' | 'denied' | 'prompt'
  async permission() {
    if (!Native) return 'denied';
    return (await quiet(Native.checkPermission()))?.notifications || 'denied';
  },
  // Asks if Android will still ask; true when notifications can be shown.
  async allow() {
    if (!Native) return false;
    if ((await this.permission()) === 'granted') return true;
    return (await quiet(Native.requestPermission()))?.notifications === 'granted';
  }
};
