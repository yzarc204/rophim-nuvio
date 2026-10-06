/**
 * subtitle.ts — Trả subtitle cho Stremio subtitle addon protocol
 *
 * Stremio gọi: GET /subtitles/{type}/{id}.json
 * Response: { subtitles: [{ id, url, lang }] }
 *
 * VSMov không hỗ trợ IMDB/TMDB ID trực tiếp.
 * Với thuinuvio: ID → dùng provider + slug từ ID.
 * Với IMDB/TMDB ID → KKPhim resolve slug, rồi VSMov ăn theo slug đó
 *   (giống fetchStreamsById trong stream.ts).
 */

import type { CacheStore } from '../lib/cache.js';
import { ID_PREFIX, parseId, parseStremioId } from '../lib/id.js';
import { getProviders } from '../providers/registry.js';
import { KKPhimProvider } from '../providers/kkphim.js';
import { VsmovProvider } from '../providers/vsmov.js';
import type { EpisodeSubtitle, FilmServerEpisode, Provider } from '../providers/types.js';

export async function handleSubtitle(
  _type: string,
  id: string,
  cache: CacheStore,
  ctx: ExecutionContext
): Promise<{ subtitles: EpisodeSubtitle[] }> {
  if (id.startsWith(ID_PREFIX)) {
    return fetchSubtitlesCatalog(id, cache, ctx);
  }
  return fetchSubtitlesByStremioId(id, cache, ctx);
}

/**
 * Luồng 1: thuinuvio:{provider}:slug[:tap-N]
 *
 * QUAN TRỌNG: id chỉ mang tên provider "chính" (thường là provider đầu tiên
 * khớp lúc search — vd kkphim), nhưng catalog "Rổ Phim" fallback qua
 * NHIỀU nguồn (KKPhim → OPhim → VSMov → NguonC) và hiện chỉ VSMov có sub rời.
 * Nếu chỉ gọi đúng 1 provider theo prefix trong id (như trước đây) thì với
 * id dạng thuinuvio:kkphim:... sub sẽ luôn rỗng dù bản VSMov của phim đó có sub.
 * => Phải mirror đúng logic fetchStreamsCatalog trong stream.ts: gọi TẤT CẢ
 * provider (cùng slug), gộp sub từ mọi nguồn lại.
 *
 * Khi episode === null (Nuvio ấn Play thẳng cho series, không chọn tập cụ
 * thể) chỉ lấy sub của tập ĐẦU TIÊN mỗi nguồn — khớp với fetchStreamsCatalog
 * trong stream.ts (cùng lúc đó chỉ trả HLS tập 1), tránh lẫn sub nhiều tập.
 */
async function fetchSubtitlesCatalog(
  id: string,
  cache: CacheStore,
  ctx: ExecutionContext
): Promise<{ subtitles: EpisodeSubtitle[] }> {
  const { provider: primaryPrefix, slug, episode } = parseId(id);
  if (!slug || !primaryPrefix) return { subtitles: [] };

  const allProviders = getProviders(cache, ctx);
  const primary = allProviders.find((p) => p.prefix === primaryPrefix);
  const others = allProviders.filter((p) => p.prefix !== primaryPrefix);
  const order: Provider[] = primary ? [primary, ...others] : others;

  const results = await Promise.allSettled(order.map((p) => p.film(slug)));

  let servers: FilmServerEpisode[] = [];
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value) {
      const effectiveKey = episode ?? firstEpisodeKey(res.value.servers ?? []);
      servers = servers.concat(filterEpisodes(res.value.servers ?? [], effectiveKey));
    }
  }

  return { subtitles: collectSubtitles(servers) };
}

/**
 * Luồng 2: IMDB/TMDB ID (tt..., tmdb:...)
 * Mirror đúng logic stream.ts fetchStreamsById:
 * - KKPhim resolve IMDB/TMDB → slug + name
 * - VSMov thử p.film(slug) trước (ăn theo slug KKPhim nếu trùng)
 * - Nếu không có → filmByName(name, originalName)
 */
async function fetchSubtitlesByStremioId(
  id: string,
  cache: CacheStore,
  ctx: ExecutionContext
): Promise<{ subtitles: EpisodeSubtitle[] }> {
  const parsed = parseStremioId(id);
  const kkphim = new KKPhimProvider(cache, ctx);
  let meta = null;

  if (parsed.imdbId) meta = await kkphim.findByImdb(parsed.imdbId);
  if (!meta && parsed.tmdbId) meta = await kkphim.findByTmdb(parsed.tmdbType, parsed.tmdbId);
  if (!meta) return { subtitles: [] };

  const episodeSlug =
    parsed.season !== null && parsed.episode !== null ? String(parsed.episode) : null;

  // Chỉ VSMov có sub — không cần chạy hết mọi provider
  const vsmov = new VsmovProvider(cache, ctx);

  let film = await vsmov.film(meta.slug);
  if (!film && typeof vsmov.filmByName === 'function') {
    film = await vsmov.filmByName(meta.name, meta.original_name);
  }
  if (!film) return { subtitles: [] };

  const servers = filterEpisodes(film.servers ?? [], episodeSlug);
  return { subtitles: collectSubtitles(servers) };
}

function filterEpisodes(
  servers: FilmServerEpisode[],
  episodeKey: string | null
): FilmServerEpisode[] {
  if (episodeKey === null) return servers;
  return servers.filter(
    (ep) => (ep.episode_slug ?? '') === episodeKey || (ep.episode_name ?? '') === episodeKey
  );
}

/**
 * Tập ĐẦU TIÊN trong danh sách servers (theo đúng thứ tự provider trả về).
 * Mirror hàm cùng tên trong stream.ts — dùng khi id không kèm episode.
 */
function firstEpisodeKey(servers: FilmServerEpisode[]): string | null {
  const first = servers[0];
  if (!first) return null;
  return first.episode_slug || first.episode_name || null;
}

function collectSubtitles(servers: FilmServerEpisode[]): EpisodeSubtitle[] {
  const seen = new Set<string>();
  const subs: EpisodeSubtitle[] = [];
  for (const ep of servers) {
    for (const sub of ep._subtitles ?? []) {
      if (!seen.has(sub.url)) {
        seen.add(sub.url);
        subs.push(sub);
      }
    }
  }
  return subs;
}
