// Web Push (RFC 8291 aes128gcm) + VAPID (RFC 8292), dependency-free, Web Crypto only.
// Used by the Peakora Worker to deliver gentle nudges to subscribed devices.

function base64UrlEncode(bytes) {
  let s = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

// RFC 5869 HKDF-Extract.
async function hkdfExtract(salt, ikm) {
  return hmac(salt.length ? salt : new Uint8Array(32), ikm);
}

// RFC 5869 HKDF-Expand.
async function hkdfExpand(prk, info, length) {
  const t = [];
  let prev = new Uint8Array(0);
  let n = 0;
  let out = new Uint8Array(0);
  while (out.length < length) {
    n++;
    prev = await hmac(prk, concat(prev, info, new Uint8Array([n])));
    out = concat(out, prev);
  }
  return out.subarray(0, length);
}

// Import the P-256 public key from a PushSubscription (uncompressed point, base64url).
async function importSubscriptionKey(keyB64url) {
  const raw = base64UrlDecode(keyB64url);
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

// Import the VAPID private key (32-byte scalar, base64url) as a P-256 ECDSA key for JWT signing.
// We rebuild a JWK from the scalar (d) plus the x,y coordinates recovered from the public key,
// which avoids hand-crafting fragile PKCS8 DER.
async function importVapidPrivateKey(dB64url, publicKeyB64url) {
  const d = base64UrlDecode(dB64url);            // 32-byte private scalar
  const pub = base64UrlDecode(publicKeyB64url);  // 65 bytes: 0x04 || x || y
  const x = pub.subarray(1, 33);
  const y = pub.subarray(33, 65);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: base64UrlEncode(d),
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    ext: true
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// Build the VAPID JWT (ES256) and return the Authorization header value.
async function vapidAuthHeader(endpoint, env) {
  const audience = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:peakora.network@gmail.com'
  };
  const enc = (o) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const key = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `vapid t=${signingInput}.${base64UrlEncode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Encrypt a payload per RFC 8291 (aes128gcm content coding) and return the full body.
async function encryptPayload(payload, subscription) {
  const plaintext = new TextEncoder().encode(payload);
  const uaPublic = base64UrlDecode(subscription.keys.p256dh);
  const authSecret = base64UrlDecode(subscription.keys.auth);
  const peerKey = await importSubscriptionKey(subscription.keys.p256dh);

  // Ephemeral application-server ECDH key pair.
  const ecdhKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, ecdhKey.privateKey, 256)
  );
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ecdhKey.publicKey));

  // PRK_key = HKDF-Extract(auth_secret, ecdh_secret)
  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  // key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = concat(new TextEncoder().encode('WebPush: info\0'), uaPublic, asPublic);
  // IKM = HKDF-Expand(PRK_key, key_info, 32)
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // Random salt for this record.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  // PRK = HKDF-Extract(salt, IKM)
  const prk = await hkdfExtract(salt, ikm);
  // cek = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  // nonce = HKDF-Expand(PRK, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Single record: plaintext || 0x02 (last-record delimiter, no padding).
  const dataToEncrypt = concat(plaintext, new Uint8Array([0x02]));
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, dataToEncrypt)
  );

  // Record header: salt(16) + rs(4) + idlen(1) + keyid(as_public)
  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, recordSize);
  header[20] = asPublic.length;
  header.set(asPublic, 21);

  return concat(header, encrypted);
}

// Send one web push. Returns { ok, status }.
export async function sendWebPush(subscription, payload, env) {
  const body = await encryptPayload(typeof payload === 'string' ? payload : JSON.stringify(payload), subscription);
  const auth = await vapidAuthHeader(subscription.endpoint, env);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '2419200',
      'Authorization': auth
    },
    body
  });
  return { ok: res.ok, status: res.status };
}
