/**
 * embed.ts — Extract the direct HLS (m3u8) URL from a nguonc embed URL.
 * Port từ embed.php
 */

import { config } from '../config.js';
import { cachedFetchText } from './http.js';
import type { CacheStore } from './cache.js';
import { decodeBase64Utf8 } from './text.js';

export interface ExtractedHls {
  url: string;
  referer: string;
  origin: string;
  /** Nếu đã có plaintext m3u8 (vd sau decrypt), không cần fetch lại */
  m3u8Content?: string;
}

export async function extractHlsFromEmbed(
  embedUrl: string,
  cache: CacheStore,
  ctx: ExecutionContext,
  workerOrigin?: string
): Promise<ExtractedHls | null> {
  if (!embedUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(embedUrl);
  } catch (e) {
    return null;
  }

  const embedScheme = parsed.protocol; // "https:"
  const embedHost = parsed.host;
  const embedOrigin = embedHost ? `${embedScheme}//${embedHost}` : 'https://phim.nguonc.com';

  // ── Strategy 1: url= query parameter ─────────────────────────────────────
  for (const key of ['url', 'src', 'source', 'file', 'link', 'stream']) {
    const val = parsed.searchParams.get(key);
    if (val && /\.m3u8/i.test(val)) {
      return { url: val, referer: embedOrigin + '/', origin: embedOrigin };
    }
  }

  // ── Strategy 2: fetch the embed page ──────────────────────────────────────
  const html = await cachedFetchText(embedUrl, cache, ctx, {
    headers: {
      'Accept-Language': 'vi-VN,vi;q=0.9',
      Referer: embedOrigin + '/',
      'User-Agent': config.browserUserAgent,
    },
  });

  if (!html) return null;

  // Strategy 2a: streamc.xyz-style player (AES-GCM encrypted m3u8)
  const streamc = await extractStreamcUrl(parsed, html, cache, ctx, workerOrigin);
  if (streamc) {
    return streamc;
  }

  // Strategy 2b: plain .m3u8 somewhere in the HTML/JS
  const plain = extractM3u8FromHtml(html);
  if (plain) {
    return { url: plain, referer: embedOrigin + '/', origin: embedOrigin };
  }

  return null;
}

/**
 * Derive AES-GCM key từ videoHash theo thuật toán của streamc player:
 *   1. importKey("raw", "stream-derive-v1", HMAC/SHA-256)
 *   2. sign(HMAC_key, encode(videoHash))  → 32-byte raw key
 *   3. importKey("raw", rawKey, AES-GCM)  → AES key
 */
async function deriveStreamcAesKey(videoHash: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    enc.encode('stream-derive-v1'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const rawKey = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(videoHash));
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
}

/**
 * Decrypt nội dung file .m3u8 được mã hoá theo format của streamc:
 *   Header: #EXTM3U\n#ENC-AESGCM;iv=<hex>\n#EXT-X-B65:...\n<base64 ciphertext>
 */
async function decryptStreamcM3u8(encryptedContent: string, videoHash: string): Promise<string | null> {
  const lines = encryptedContent.split('\n');

  let ivHex: string | null = null;
  let cipherB64: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith('#ENC-AESGCM')) {
      const m = line.match(/iv=([0-9a-fA-F]+)/);
      if (m) ivHex = m[1]!;
    }
    if (line.startsWith('#EXT-X-B65')) {
      cipherB64 = lines[i + 1]?.trim() ?? null;
    }
  }

  if (!ivHex || !cipherB64) return null;

  try {
    const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const cipherBytes = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));

    const aesKey = await deriveStreamcAesKey(videoHash);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBytes);
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    return null;
  }
}

async function extractStreamcUrl(
  parsedEmbed: URL,
  html: string,
  cache: CacheStore,
  ctx: ExecutionContext,
  workerOrigin?: string
): Promise<ExtractedHls | null> {
  const match = html.match(/data-obf=["']([A-Za-z0-9+/=]+)["']/);
  if (!match || !match[1]) return null;

  const decoded = decodeBase64Utf8(match[1]);
  if (!decoded) return null;

  let outer: { sUb?: string; hD?: string };
  try {
    outer = JSON.parse(decoded);
    if (!outer.sUb) return null;
  } catch (e) {
    return null;
  }

  // Lấy videoHash (hD) — dùng làm key material cho decrypt
  const videoHash = outer.hD ?? parsedEmbed.searchParams.get('hash') ?? null;

  const sUb = String(outer.sUb);
  const host = parsedEmbed.host;
  if (!host) return null;

  const protocol = parsedEmbed.protocol.replace(':', '');
  // streamURL = /<sUb_base64>?d=1  (không decode, dùng làm path)
  const streamUrl = `${protocol}://${host}/${sUb.replace(/^\/+/, '')}?d=1`;
  const referer = `${protocol}://${host}/`;
  const origin = `${protocol}://${host}`;

  // Fetch encrypted m3u8 với Referer
  const encContent = await cachedFetchText(streamUrl, cache, ctx, {
    headers: {
      Referer: referer,
      Origin: origin,
      'User-Agent': config.browserUserAgent,
    },
  });

  if (!encContent) return null;

  // Nếu file bị encrypt (streamc custom format), decrypt ngay
  if (encContent.includes('#ENC-AESGCM') && videoHash) {
    const plainM3u8 = await decryptStreamcM3u8(encContent, videoHash);
    if (plainM3u8) {
      if (workerOrigin && videoHash) {
        // Tạo URL streamc.png để stream handler dùng trực tiếp — proxy sẽ fetch+decrypt on-demand
        const streamcUrl = `${workerOrigin}/hls/streamc.png?hash=${encodeURIComponent(videoHash)}&sUb=${encodeURIComponent(sUb)}&host=${encodeURIComponent(host)}&origin=${encodeURIComponent(workerOrigin)}`;
        return { url: streamcUrl, referer, origin };
      }
      // Fallback: trả về content inline (chỉ dùng trong same-isolate)
      return { url: streamUrl, referer, origin, m3u8Content: plainM3u8 };
    }
    return null;
  }

  // File không encrypt → trả URL trực tiếp
  return { url: streamUrl, referer, origin };
}

function extractM3u8FromHtml(html: string): string | null {
  // Pattern: any quoted string ending in .m3u8 (with optional query string)
  // PHP: /(https?:\/\/[^\s\'"<>]+\.m3u8[^\s\'"<>]*)/i
  const m3u8Match = html.match(/(https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*)/i);
  if (m3u8Match && m3u8Match[1]) {
    return m3u8Match[1];
  }

  // Fallback: base64-encoded m3u8 URLs
  // Limit to avoid CPU DoS if there are many long base64 strings
  let count = 0;
  const b64Regex = /["']([A-Za-z0-9+/=]{40,})["']/g;
  let b64Match;

  while ((b64Match = b64Regex.exec(html)) !== null) {
    count++;
    if (count > 50) break;

    const decoded = decodeBase64Utf8(b64Match[1] as string);
    if (decoded) {
      const innerMatch = decoded.match(/(https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*)/i);
      if (innerMatch && innerMatch[1]) {
        return innerMatch[1];
      }
    }
  }

  return null;
}

