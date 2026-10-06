/**
 * stream.ts
 */

import type { CacheStore } from '../lib/cache.js';
import { ID_PREFIX, parseId, parseStremioId } from '../lib/id.js';
import { extractHlsFromEmbed, extractHlsFromPlayembed } from '../lib/embed.js';
import { getProviders } from '../providers/registry.js';
import { KKPhimProvider } from '../providers/kkphim.js';
import { MotchillProvider } from '../providers/motchill.js';
import type { FilmServerEpisode } from '../providers/types.js';

/**
 * Wrap một URL m3u8 qua HLS proxy của worker.
 * Dùng cho các nguồn yêu cầu Referer (như nguonc) vì Nuvio không hỗ trợ proxyHeaders.
 */
function wrapHlsUrl(m3u8Url: string, workerOrigin: string): string {
  return `${workerOrigin}/hls/playlist.png?url=${encodeURIComponent(m3u8Url)}&origin=${encodeURIComponent(workerOrigin)}`;
}

export async function handleStream(_type: string, id: string, cache: CacheStore, ctx: ExecutionContext, workerOrigin: string) {
  // Luồng 1: ID từ catalog
  if (id.startsWith(ID_PREFIX)) {
    const { provider, slug, episode } = parseId(id);
    if (!slug || !provider) return { streams: [] };
    return fetchStreamsCatalog(provider, slug, episode, cache, ctx, workerOrigin);
  }

  // Luồng 2: ID từ IMDB/TMDB
  const parsed = parseStremioId(id);
  const kkphim = new KKPhimProvider(cache, ctx);
  let meta = null;

  if (parsed.imdbId) {
    meta = await kkphim.findByImdb(parsed.imdbId);
  }
  if (!meta && parsed.tmdbId) {
    meta = await kkphim.findByTmdb(parsed.tmdbType, parsed.tmdbId);
  }

  if (!meta) return { streams: [] };

  const slug = meta.slug;
  const name = meta.name;
  const origName = meta.original_name;
  const episodeSlug = parsed.season !== null && parsed.episode !== null ? String(parsed.episode) : null;

  return fetchStreamsById(slug, name, origName, episodeSlug, cache, ctx, workerOrigin);
}

/**
 * Lọc tập theo episodeSlug
 */
function filterEpisodes(servers: FilmServerEpisode[], episodeSlug: string | null): FilmServerEpisode[] {
  if (episodeSlug === null) return servers;
  return servers.filter(
    (ep) => (ep.episode_slug ?? '') === episodeSlug || (ep.episode_name ?? '') === episodeSlug
  );
}

/**
 * Xác định episode key của tập ĐẦU TIÊN trong danh sách servers.
 * Dùng khi ấn Play trực tiếp cho series mà không chọn tập cụ thể (id không kèm
 * episode) — servers được provider trả về theo đúng thứ tự gốc (tập 1 → N),
 * nên item đầu tiên đại diện cho tập 1.
 */
function firstEpisodeKey(servers: FilmServerEpisode[]): string | null {
  const first = servers[0];
  if (!first) return null;
  return first.episode_slug || first.episode_name || null;
}

/**
 * Xử lý streams trả về từ provider: m3u8 direct hoặc qua embed resolver
 */
async function buildStreams(
  label: string,
  servers: FilmServerEpisode[],
  poster: string | null,
  cache: CacheStore,
  ctx: ExecutionContext,
  workerOrigin: string,
  filmName: string = ''
) {
  const streams = [];

  // Lần lượt (cần giữ thứ tự server)
  for (const ep of servers) {
    const epName = ep.episode_name ?? '';
    const serverName = ep.server_name ?? label;

    let finalName = filmName || label;
    const isFull = epName.toLowerCase() === 'full' || epName.toLowerCase() === 'tập full';
    if (!isFull && epName) {
      finalName += ' - Tập ' + epName;
    }

    let finalTitle = label;
    if (serverName !== label) {
      finalTitle += ' · ' + serverName;
    }

    const stream: any = {
      name: finalName,
      title: finalTitle,
    };

    // Gắn sub trực tiếp vào stream object (chuẩn Stremio: Stream.subtitles = [{id,url,lang}])
    // để client (vd: Nuvio) nhận được sub ngay trong response /stream, không cần tự gọi
    // thêm resource /subtitles riêng (resource này có thể không được gọi với id không có imdb/tmdb).
    if (ep._subtitles && ep._subtitles.length > 0) {
      stream.subtitles = ep._subtitles;
    }

    if (ep.m3u8_url) {
      if (ep._referer) {
        // Nguồn yêu cầu Referer → wrap qua HLS proxy thay vì dùng proxyHeaders
        // (Nuvio không hỗ trợ proxyHeaders, proxy phía worker tự gắn Referer khi fetch)
        stream.url = wrapHlsUrl(ep.m3u8_url, workerOrigin);
      } else {
        stream.url = ep.m3u8_url;
      }
      if (poster) stream.thumbnail = poster;
      streams.push(stream);
      continue;
    }

    if (ep.embed_url) {
      const isPlayembed = ep.embed_url.includes('playembed.vip');

      const resolved = isPlayembed
        ? await extractHlsFromPlayembed(ep.embed_url, cache, ctx)
        : await extractHlsFromEmbed(ep.embed_url, cache, ctx, workerOrigin);

      if (!resolved) continue;

      if (resolved.url.includes('/hls/streamc.png')) {
        // URL đã là streamc proxy endpoint (tự chứa hash+sUb) → dùng thẳng
        stream.url = resolved.url;
      } else if (resolved.m3u8Content) {
        // Inline m3u8 content (playembed hoặc streamc fallback) → cache + wrap proxy
        cache.put('streamc_plain:' + resolved.url, resolved.m3u8Content, ctx);
        stream.url = `${workerOrigin}/hls/playlist.png?url=${encodeURIComponent(resolved.url)}&origin=${encodeURIComponent(workerOrigin)}&ref=${encodeURIComponent(resolved.referer)}`;
      } else {
        // URL m3u8 thông thường → wrap qua proxy để gắn Referer
        stream.url = wrapHlsUrl(resolved.url, workerOrigin);
      }
      if (poster) stream.thumbnail = poster;
      streams.push(stream);
    }
  }

  return streams;
}

/**
 * Fetch catalog (primary provider đầu tiên)
 *
 * Khi episodeKey === null (Nuvio ấn Play thẳng cho series, không chọn tập
 * cụ thể → id không kèm episode) chỉ áp dụng cho catalog Rổ Phim:
 * chỉ trả về tập ĐẦU TIÊN của mỗi nguồn thay vì toàn bộ danh sách tập, để
 * tránh trả nguyên list stream lẫn lộn nhiều tập khi người dùng chỉ muốn xem
 * tập 1.
 */
async function fetchStreamsCatalog(
  primaryPrefix: string,
  slug: string,
  episodeKey: string | null,
  cache: CacheStore,
  ctx: ExecutionContext,
  workerOrigin: string
) {
  const allProviders = getProviders(cache, ctx);
  const primary = allProviders.find((p) => p.prefix === primaryPrefix);
  const others = allProviders.filter((p) => p.prefix !== primaryPrefix);
  const order = primary ? [primary, ...others] : others;

  // Gọi TẤT CẢ các provider SONG SONG, nhưng kết quả append theo thứ tự đã định
  const results = await Promise.allSettled(
    order.map(async (p) => {
      const film = await p.film(slug);
      if (!film) return { p, built: [] };

      // Không chọn tập cụ thể → chỉ lấy tập đầu tiên của MỖI nguồn (không phải
      // toàn bộ danh sách), vì mỗi nguồn có thể đánh số/slug tập khác nhau.
      const effectiveKey = episodeKey ?? firstEpisodeKey(film.servers ?? []);
      const servers = filterEpisodes(film.servers ?? [], effectiveKey);
      const poster = film.info.poster ?? film.info.thumb ?? null;
      const built = await buildStreams(p.label, servers, poster, cache, ctx, workerOrigin, film.info.name);
      return { p, built };
    })
  );

  let streams: any[] = [];
  for (let i = 0; i < order.length; i++) {
    const res = results[i];
    if (res?.status === 'fulfilled') {
      streams = streams.concat(res.value.built);
    }
  }

  return { streams };
}

/**
 * Fetch bằng ID IMDB/TMDB
 */
async function fetchStreamsById(
  slug: string,
  name: string,
  originalName: string,
  episodeSlug: string | null,
  cache: CacheStore,
  ctx: ExecutionContext,
  workerOrigin: string
) {
  const providers = getProviders(cache, ctx);

  // Gọi TẤT CẢ các provider chính SONG SONG
  const results = await Promise.allSettled(
    providers.map(async (p) => {
      let film = await p.film(slug);
      if (!film && typeof p.filmByName === 'function') {
        film = await p.filmByName(name, originalName);
      }
      if (!film) return { p, built: [] };

      const servers = filterEpisodes(film.servers ?? [], episodeSlug);
      const poster = film.info.poster ?? film.info.thumb ?? null;
      const built = await buildStreams(p.label, servers, poster, cache, ctx, workerOrigin, film.info.name);
      return { p, built };
    })
  );

  let streams: any[] = [];
  for (let i = 0; i < providers.length; i++) {
    const res = results[i];
    if (res?.status === 'fulfilled') {
      streams = streams.concat(res.value.built);
    }
  }

  // Chỉ fetch Motchill khi các provider chính tìm được phim (streams > 0)
  // để tránh tìm sai phim khi search by name
  if (streams.length > 0) {
    try {
      const motchill = new MotchillProvider(cache, ctx);
      const motchillEps = await motchill.getStreams(name, originalName, episodeSlug);
      if (motchillEps.length > 0) {
        const motchillStreams = await buildStreams('Motchill', motchillEps, null, cache, ctx, workerOrigin, name);
        streams = streams.concat(motchillStreams);
      }
    } catch {
      // Lỗi Motchill không ảnh hưởng đến kết quả chính
    }
  }

  return { streams };
}
