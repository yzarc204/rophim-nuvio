/**
 * hls-proxy.ts — Proxy HLS playlist và segment cho các nguồn yêu cầu Referer.
 *
 * 2 endpoint, đuôi .png để tránh Cloudflare quét:
 *
 *   GET /hls/playlist.png?url=<encoded-m3u8-url>&origin=<worker-origin>[&ref=<referer>]
 *     → Phục vụ playlist .m3u8 (từ cache nếu có, từ upstream nếu không),
 *       rewrite các URI segment trỏ sang endpoint segment.
 *
 *   GET /hls/segment.png?url=<encoded-segment-url>[&ref=<encoded-referer>]
 *     → Tải segment từ nguồn với Referer phù hợp, stream về client.
 */

import { config } from '../config.js';
import type { CacheStore } from '../lib/cache.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function upstreamHeaders(referer: string): HeadersInit {
  const origin = referer.replace(/\/$/, '').replace(/(https?:\/\/[^/]+).*/, '$1');
  return {
    'User-Agent': config.browserUserAgent,
    Referer: referer,
    Origin: origin,
  };
}

function refererOf(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return 'https://nguonc.com/';
  }
}

function resolveUri(uri: string, playlistUrl: string): string {
  if (/^https?:\/\//i.test(uri)) return uri;
  try {
    return new URL(uri, playlistUrl).toString();
  } catch {
    return uri;
  }
}

/**
 * Rewrite playlist:
 *  - Sub-playlist (.m3u8) → trỏ sang endpoint playlist (đệ quy)
 *  - Segment (*.png, *.ts, *.m4s…) → trỏ sang endpoint segment với Referer đúng
 */
function rewritePlaylist(
  content: string,
  playlistUrl: string,
  workerOrigin: string,
  segmentReferer: string
): string {
  const lines = content.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed !== '' && !trimmed.startsWith('#')) {
      const absUri = resolveUri(trimmed, playlistUrl);
      const isSubPlaylist = /\.m3u8(\?|$)/i.test(absUri);

      if (isSubPlaylist) {
        out.push(
          `${workerOrigin}/hls/playlist.png?url=${encodeURIComponent(absUri)}&origin=${encodeURIComponent(workerOrigin)}&ref=${encodeURIComponent(segmentReferer)}`
        );
      } else {
        // Proxy segment với đúng Referer
        out.push(
          `${workerOrigin}/hls/segment.png?url=${encodeURIComponent(absUri)}&ref=${encodeURIComponent(segmentReferer)}`
        );
      }
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
  } as const;
}

function errorResponse(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ─── Handler: playlist ────────────────────────────────────────────────────────

/**
 * GET /hls/playlist.png?url=<m3u8>&origin=<worker-origin>[&ref=<referer>]
 *
 * Nếu cache có key "streamc_plain:<url>" thì dùng content đó (đã decrypt),
 * ngược lại fetch upstream và rewrite.
 */
export async function handleHlsPlaylist(
  request: Request,
  cache: CacheStore,
  _ctx: ExecutionContext
): Promise<Response> {
  const reqUrl = new URL(request.url);
  const rawUrl = reqUrl.searchParams.get('url');
  const workerOrigin = reqUrl.searchParams.get('origin') ?? `${reqUrl.protocol}//${reqUrl.host}`;
  const rawRef = reqUrl.searchParams.get('ref');

  if (!rawUrl) return errorResponse('Missing url param');

  let playlistUrl: string;
  try {
    playlistUrl = decodeURIComponent(rawUrl);
    new URL(playlistUrl); // validate
  } catch {
    return errorResponse('Invalid url param');
  }

  // Referer: từ param nếu có, ngược lại tự suy từ URL
  const segmentReferer = rawRef ? decodeURIComponent(rawRef) : refererOf(playlistUrl);

  // Kiểm tra cache trước (streamc plaintext đã decrypt)
  const cacheKey = 'streamc_plain:' + playlistUrl;
  const cached = await cache.get(cacheKey);
  if (cached) {
    const rewritten = rewritePlaylist(cached, playlistUrl, workerOrigin, segmentReferer);
    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        ...corsHeaders(),
      },
    });
  }

  // Fetch từ upstream
  try {
    const upstream = await fetch(playlistUrl, {
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      headers: upstreamHeaders(segmentReferer),
    });

    if (!upstream.ok) {
      return new Response(`Upstream error ${upstream.status}`, {
        status: 502,
        headers: corsHeaders(),
      });
    }

    const text = await upstream.text();
    const rewritten = rewritePlaylist(text, playlistUrl, workerOrigin, segmentReferer);

    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        ...corsHeaders(),
      },
    });
  } catch {
    return new Response('Proxy fetch failed', { status: 502, headers: corsHeaders() });
  }
}

// ─── Handler: segment ─────────────────────────────────────────────────────────

/**
 * GET /hls/segment.png?url=<segment-url>[&ref=<encoded-referer>]
 */
export async function handleHlsSegment(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const rawUrl = reqUrl.searchParams.get('url');
  const rawRef = reqUrl.searchParams.get('ref');

  if (!rawUrl) return errorResponse('Missing url param');

  let segUrl: string;
  try {
    segUrl = decodeURIComponent(rawUrl);
    new URL(segUrl); // validate
  } catch {
    return errorResponse('Invalid url param');
  }

  // Referer: từ param nếu có, ngược lại tự suy từ URL segment
  const referer = rawRef ? decodeURIComponent(rawRef) : refererOf(segUrl);

  try {
    const upstream = await fetch(segUrl, {
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      headers: upstreamHeaders(referer),
    });

    if (!upstream.ok) {
      return new Response(`Upstream error ${upstream.status}`, {
        status: 502,
        headers: corsHeaders(),
      });
    }

    const contentType = upstream.headers.get('Content-Type') ?? 'application/octet-stream';

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        ...corsHeaders(),
      },
    });
  } catch {
    return new Response('Proxy fetch failed', { status: 502, headers: corsHeaders() });
  }
}

// ─── Handler: streamc decrypt-on-demand ───────────────────────────────────────

/**
 * GET /hls/streamc.png?hash=<videoHash>&sUb=<sUb_base64>&host=<embed_host>&origin=<worker-origin>
 *
 * Fetch + decrypt m3u8 streamc on-demand, trả về playlist chuẩn với segment URLs
 * đã được rewrite qua proxy segment.
 */
export async function handleHlsStreamc(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const videoHash = reqUrl.searchParams.get('hash');
  const sUb = reqUrl.searchParams.get('sUb');
  const embedHost = reqUrl.searchParams.get('host');
  const workerOrigin = reqUrl.searchParams.get('origin') ?? `${reqUrl.protocol}//${reqUrl.host}`;

  if (!videoHash || !sUb || !embedHost) return errorResponse('Missing params');

  const protocol = 'https';
  const streamUrl = `${protocol}://${embedHost}/${sUb}?d=1`;
  const referer = `${protocol}://${embedHost}/`;
  const origin = `${protocol}://${embedHost}`;

  try {
    const res = await fetch(streamUrl, {
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      headers: { 'User-Agent': config.browserUserAgent, Referer: referer, Origin: origin },
    });
    if (!res.ok) return new Response(`Upstream ${res.status}`, { status: 502, headers: corsHeaders() });

    const enc = await res.text();
    if (!enc.includes('#ENC-AESGCM')) {
      // Không encrypt — rewrite thẳng
      const plain = rewritePlaylist(enc, streamUrl, workerOrigin, referer);
      return new Response(plain, { status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', ...corsHeaders() } });
    }

    // Decrypt
    const plain = await decryptStreamcContent(enc, videoHash);
    if (!plain) return new Response('Decrypt failed', { status: 502, headers: corsHeaders() });

    // Segments nằm ở indoss15.amass15.top — dùng referer của embed
    const rewritten = rewritePlaylist(plain, streamUrl, workerOrigin, referer);
    return new Response(rewritten, {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', ...corsHeaders() },
    });
  } catch (e) {
    return new Response('Proxy error', { status: 502, headers: corsHeaders() });
  }
}

async function decryptStreamcContent(encContent: string, videoHash: string): Promise<string | null> {
  const lines = encContent.split('\n');
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
    const cipher = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));

    const enc = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey(
      'raw', enc.encode('stream-derive-v1'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const rawKey = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(videoHash));
    const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
