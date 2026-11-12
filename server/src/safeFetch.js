import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import { httpError } from './auth.js';

// Fetching a web page someone typed the address of (a recipe), without
// letting it reach anything on the home network: the server, the router,
// the other apps, NetBird. Every address a name turns into is checked as the
// connection is made (so a name can't change its answer in between), and so
// is every redirect.

const blocked = new net.BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blocked.addSubnet(ip, bits, 'ipv4');
// (Not ::ffff:0:0/96: Node matches every IPv4 address against that. An
// IPv4 address written as IPv6 is checked as itself below.)
for (const [ip, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]]) {
  blocked.addSubnet(ip, bits, 'ipv6');
}
export function isPrivateAddress(ip) {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (v4) return blocked.check(v4, 'ipv4');
  if (/^::ffff:/i.test(ip)) return true;
  return blocked.check(ip, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

const NOT_OUTSIDE = "That address is on the home network, not out on the internet";

function lookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error(NOT_OUTSIDE), { code: 'PRIVATE' }));
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

function once(url, { accept, maxBytes, timeout }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateAddress(host)) return reject(httpError(400, NOT_OUTSIDE));
    const req = (u.protocol === 'https:' ? https : http).get(u, {
      lookup,
      timeout,
      headers: {
        Accept: accept,
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.8',
        // Some recipe sites turn away anything that doesn't look like a browser.
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, u).href });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(httpError(502, res.statusCode === 403 || res.statusCode === 401
          ? "That site wouldn't let Family Track read the page. You can still add it by hand."
          : `That page answered ${res.statusCode}`));
      }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const body = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate())
        : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = [];
      let size = 0;
      body.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(httpError(400, 'That page is too big'));
        } else chunks.push(c);
      });
      body.on('end', () => resolve({ url: u.href, type: res.headers['content-type'] || '', body: Buffer.concat(chunks) }));
      body.on('error', () => reject(httpError(502, "That page couldn't be read")));
    });
    req.on('timeout', () => req.destroy(httpError(504, 'That page took too long to answer')));
    req.on('error', (e) => reject(e.status ? e : e.code === 'PRIVATE'
      ? httpError(400, NOT_OUTSIDE)
      : httpError(502, e.code === 'ENOTFOUND' ? "Can't find that site" : "Can't reach that site")));
  });
}

// GET a page or picture out on the internet: { url (after redirects), type, body }.
export async function safeFetch(url, { accept = '*/*', maxBytes = 5 * 1024 * 1024, timeout = 15000 } = {}) {
  for (let hops = 0; hops < 6; hops++) {
    if (!/^https?:\/\//i.test(url)) throw httpError(400, "That doesn't look like a web address");
    const r = await once(url, { accept, maxBytes, timeout });
    if (!r.redirect) return r;
    url = r.redirect;
  }
  throw httpError(502, 'That page kept sending Family Track somewhere else');
}
