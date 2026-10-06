/**
 * index.ts — Router chính cho Cloudflare Worker
 */

import { TwoTierCache } from './lib/cache.js';
import { handleManifest } from './handlers/manifest.js';
import { handleSearch } from './handlers/search.js';
import { handleMeta } from './handlers/meta.js';
import { handleStream } from './handlers/stream.js';
import { handleSubtitle } from './handlers/subtitle.js';
import { handleHlsPlaylist, handleHlsSegment, handleHlsStreamc } from './handlers/hls-proxy.js';

// Cache là singleton xuyên suốt 1 isolate
const cacheStore = new TwoTierCache();

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Gửi CORS headers
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    const path = url.pathname.replace(/^\/+/, '');

    // 1. Phục vụ assets tĩnh (logo.png) từ binding trước
    if (path === 'logo.png') {
      return env.ASSETS.fetch(request);
    }

    // 1b. HLS proxy — 2 endpoint đuôi .png để tránh Cloudflare quét
    if (path === 'hls/playlist.png') {
      return handleHlsPlaylist(request, cacheStore, ctx);
    }
    if (path === 'hls/segment.png') {
      return handleHlsSegment(request);
    }
    if (path === 'hls/streamc.png') {
      return handleHlsStreamc(request);
    }

    // JSON response helper
    const jsonResponse = (data: any, pretty = false) => {
      return new Response(JSON.stringify(data, null, pretty ? 2 : undefined), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        },
      });
    };

    // 2. manifest.json
    if (path === 'manifest.json') {
      const origin = `${url.protocol}//${url.host}`;
      return jsonResponse(handleManifest(origin), true);
    }

    // 3. /catalog/{type}/{id}/search={query}.json
    const searchMatch = path.match(/^catalog\/([^/]+)\/([^/]+)\/search=(.+)\.json$/);
    if (searchMatch) {
      const type = decodeURIComponent(searchMatch[1]!);
      // Catalog id của Stremio không dùng tới, query là searchMatch[3]
      const query = decodeURIComponent(searchMatch[3]!);
      const res = await handleSearch(type, query, cacheStore, ctx);
      return jsonResponse(res);
    }

    // 4. /catalog/{type}/{id}.json (bỏ qua, chỉ search)
    const catalogMatch = path.match(/^catalog\/([^/]+)\/([^/]+)\.json$/);
    if (catalogMatch) {
      return jsonResponse({ metas: [] });
    }

    // 5. /meta/{type}/{id}.json
    const metaMatch = path.match(/^meta\/([^/]+)\/(.+)\.json$/);
    if (metaMatch) {
      const type = decodeURIComponent(metaMatch[1]!);
      const id = decodeURIComponent(metaMatch[2]!);
      const res = await handleMeta(type, id, cacheStore, ctx);
      return jsonResponse(res);
    }

    // 6. /stream/{type}/{id}.json
    const streamMatch = path.match(/^stream\/([^/]+)\/(.+)\.json$/);
    if (streamMatch) {
      const type = decodeURIComponent(streamMatch[1]!);
      const id = decodeURIComponent(streamMatch[2]!);
      const origin = `${url.protocol}//${url.host}`;
      const res = await handleStream(type, id, cacheStore, ctx, origin);
      return jsonResponse(res);
    }

    // 7. /subtitles/{type}/{id}.json
    const subtitleMatch = path.match(/^subtitles\/([^/]+)\/(.+)\.json$/);
    if (subtitleMatch) {
      const type = decodeURIComponent(subtitleMatch[1]!);
      const id = decodeURIComponent(subtitleMatch[2]!);
      const res = await handleSubtitle(type, id, cacheStore, ctx);
      return jsonResponse(res);
    }

    // Not found
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
} satisfies ExportedHandler<Env>;
