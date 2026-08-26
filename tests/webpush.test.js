// Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
/**
 * Web Push crypto tests (RFC 8291 aes128gcm + RFC 8292 VAPID).
 *
 * Validates the dependency-free Web Crypto implementation used by the Worker
 * to send push messages. Round-trips an encrypted payload through a simulated
 * receiver, and signs+verifies a VAPID JWT with a generated keypair.
 *
 * Run: node --test tests/webpush.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

function base64UrlEncode(bytes) {
  let s = Buffer.from(bytes).toString('base64');
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
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
async function hkdfExtract(salt, ikm) { return hmac(salt.length ? salt : new Uint8Array(32), ikm); }
async function hkdfExpand(prk, info, length) {
  let prev = new Uint8Array(0), n = 0, out = new Uint8Array(0);
  while (out.length < length) { n++; prev = await hmac(prk, concat(prev, info, new Uint8Array([n]))); out = concat(out, prev); }
  return out.subarray(0, length);
}

// Mirrors worker/src/webpush.js encryptPayload (sender side).
async function encryptPayload(payload, subscription, asPublic, sharedSecret) {
  const plaintext = new TextEncoder().encode(payload);
  const uaPublic = base64UrlDecode(subscription.keys.p256dh);
  const authSecret = base64UrlDecode(subscription.keys.auth);
  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = concat(new TextEncoder().encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const dataToEncrypt = concat(plaintext, new Uint8Array([0x02]));
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, dataToEncrypt));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, encrypted);
}

test('RFC 8291: encrypted payload round-trips to the original plaintext', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const uaPubB64url = base64UrlEncode(uaPubRaw);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const authB64url = base64UrlEncode(authSecret);

  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const peerKey = await crypto.subtle.importKey('raw', uaPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, ephemeral.privateKey, 256));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const payload = JSON.stringify({ title: 'Peakora', body: 'test nudge' });
  const body = await encryptPayload(payload, { keys: { p256dh: uaPubB64url, auth: authB64url } }, asPublic, sharedSecret);

  // Receiver-side decrypt.
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic2 = body.subarray(21, 21 + idlen);
  const encrypted = body.subarray(21 + idlen);
  const asKey2 = await crypto.subtle.importKey('raw', asPublic2, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared2 = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey2 }, ua.privateKey, 256));
  const prkKey2 = await hkdfExtract(authSecret, shared2);
  const ikm2 = await hkdfExpand(prkKey2, concat(new TextEncoder().encode('WebPush: info\0'), uaPubRaw, asPublic2), 32);
  const prk2 = await hkdfExtract(salt, ikm2);
  const cek2 = await hkdfExpand(prk2, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce2 = await hkdfExpand(prk2, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const cekKey2 = await crypto.subtle.importKey('raw', cek2, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce2 }, cekKey2, encrypted));

  assert.equal(decrypted[decrypted.length - 1], 0x02, 'last-record delimiter');
  assert.equal(new TextDecoder().decode(decrypted.subarray(0, decrypted.length - 1)), payload);
});

test('RFC 8292: VAPID JWT signs and verifies with the application keypair', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privJwk = privateKey.export({ format: 'jwk' });
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' });
  const pub65 = pubRaw.subarray(pubRaw.length - 65);
  const pubB64url = base64UrlEncode(pub65);

  // Rebuild a signing key from d + the public coordinates (as webpush.js does).
  const pub = base64UrlDecode(pubB64url);
  const jwk = {
    kty: 'EC', crv: 'P-256', d: privJwk.d,
    x: base64UrlEncode(pub.subarray(1, 33)), y: base64UrlEncode(pub.subarray(33, 65)), ext: true
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: 'https://fcm.googleapis.com', exp: Math.floor(Date.now() / 1000) + 43200, sub: 'mailto:peakora.network@gmail.com' };
  const enc = (o) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)));

  assert.equal(sig.length, 64, 'ES256 raw signature is 64 bytes (r||s)');
  const pubKey = await crypto.subtle.importKey('raw', pubRaw.subarray(pubRaw.length - 65), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sig, new TextEncoder().encode(signingInput));
  assert.ok(valid, 'VAPID JWT signature verifies against the public key');
});

test('aes128gcm record header is well-formed (salt 16, rs 4096, idlen 65)', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const peerKey = await crypto.subtle.importKey('raw', uaPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, ephemeral.privateKey, 256));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const body = await encryptPayload('x', { keys: { p256dh: base64UrlEncode(uaPubRaw), auth: base64UrlEncode(authSecret) } }, asPublic, sharedSecret);
  // header = salt(16) + rs(4) + idlen(1) + keyid(65) = 86; ciphertext = 2 (1 plaintext + 0x02) + 16 GCM tag = 18.
  assert.equal(body.length, 86 + 18, 'header(86) + ciphertext(2 plaintext + 16 GCM tag)');
  assert.equal(new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), 4096, 'record size');
  assert.equal(body[20], 65, 'keyid length = uncompressed P-256 point');
});
