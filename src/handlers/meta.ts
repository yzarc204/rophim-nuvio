/**
 * meta.ts
 */

import type { CacheStore } from '../lib/cache.js';
import { parseId } from '../lib/id.js';
import { getProviders } from '../providers/registry.js';
import type { FilmDetail } from '../providers/types.js';

export async function handleMeta(type: string, id: string, cache: CacheStore, ctx: ExecutionContext) {
  const { provider, slug } = parseId(id);
  if (!slug || !provider) return { meta: null };

  const film = await fetchFilmByProvider(provider, slug, cache, ctx);
  if (!film) return { meta: null };

  const info = film.info;
  const poster = info.poster ?? info.thumb ?? null;

  const meta: any = {
    id,
    type,
    name: info.name ?? '',
    poster,
    background: info.thumb ?? poster,
    description: info.description ?? '',
  };

  if (info.year) {
    meta.releaseInfo = String(info.year);
  }

  if (type === 'series') {
    const seen = new Set<string>();
    const videos = [];

    for (const ep of film.servers) {
      const epSlug = ep.episode_slug ?? '';
      const epName = ep.episode_name ?? '';
      const key = epSlug || epName;

      if (!key || seen.has(key)) continue;
      seen.add(key);

      const numMatch = epName.match(/\d+/);
      const epNum = numMatch ? parseInt(numMatch[0], 10) : 0;

      videos.push({
        id: `${id}:${key}`,
        title: epName ? `Tập ${epName}` : key,
        season: 1,
        episode: epNum > 0 ? epNum : videos.length + 1,
        released: new Date().toISOString(),
        thumbnail: poster,
      });
    }

    meta.videos = videos;
  }

  return { meta };
}

/**
 * Fetch film theo provider đã biết từ ID, nếu lỗi thì fallback (tuần tự)
 */
async function fetchFilmByProvider(
  primaryPrefix: string,
  slug: string,
  cache: CacheStore,
  ctx: ExecutionContext
): Promise<FilmDetail | null> {
  const allProviders = getProviders(cache, ctx);

  // Đưa provider chính lên đầu, giữ thứ tự các provider còn lại
  const primary = allProviders.find((p) => p.prefix === primaryPrefix);
  const others = allProviders.filter((p) => p.prefix !== primaryPrefix);
  const order = primary ? [primary, ...others] : others;

  // Lấy meta phải làm tuần tự, vì chỉ cần 1 thằng có là return ngay (không nên bắn 3 request cùng lúc)
  for (const p of order) {
    try {
      const film = await p.film(slug);
      if (film) return film;
    } catch (e) {}
  }

  return null;
}
