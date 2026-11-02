import { Capacitor } from '@capacitor/core';

// In the Android app the server address is entered once at setup. When the
// app is opened in a browser straight from the server, it is the same origin.
export const isNative = Capacitor.isNativePlatform();
const DEFAULT_SERVER = '';

// Browsers only allow the camera on secure pages; over plain http on the
// private network that means brushing works in the Android app only.
export const canUseCamera = isNative || (window.isSecureContext && !!navigator.mediaDevices?.getUserMedia);

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }
};

export const api = {
  get serverUrl() { return isNative ? (store.get('ft.server') || DEFAULT_SERVER) : ''; },
  setServerUrl(url) { store.set('ft.server', url.replace(/\/+$/, '')); },
  get token() { return store.get('ft.token'); },
  setToken(t) { store.set('ft.token', t); },

  url(path) { return this.serverUrl + path; },
  authHeaders() {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  },

  async request(method, path, body) {
    let res;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: { ...this.authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new ApiError("Can't reach the server. Is NetBird connected?", 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Server error ${res.status}`, res.status, data);
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body = {}) { return this.request('POST', path, body); },
  put(path, body = {}) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },

  // Sign this device in as an account (or switch). Keeps the device's token
  // if it already has one; the server just moves it to the new account.
  async signIn(body) {
    const r = await this.post('/api/sign-in', { deviceName: defaultDeviceName(), ...body });
    if (r.token) this.setToken(r.token);
    return r.account;
  },

  // Multipart upload with progress (fetch can't report upload progress).
  upload(method, path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, this.url(path));
      for (const [k, v] of Object.entries(this.authHeaders())) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(data.error || `Upload failed (${xhr.status})`, xhr.status, data));
      };
      xhr.onerror = () => reject(new ApiError("Can't reach the server. Is NetBird connected?", 0));
      xhr.send(formData);
    });
  }
};

function defaultDeviceName() {
  if (!isNative) return 'Web browser';
  return /tablet|ipad/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) >= 600 ? 'Android tablet' : 'Android phone';
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
