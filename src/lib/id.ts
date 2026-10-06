/**
 * id.ts — Parse/build ID của addon.
 *
 * Port 1-1 từ helpers.php + parseStremioId() trong stream.php.
 *
 * ID format: thuinuvio:{provider}:{slug}[:{episodeKey}]
 *   thuinuvio:kkphim:tham-tu-lung-danh-conan
 *   thuinuvio:kkphim:tham-tu-lung-danh-conan:tap-1
 */

export const ID_PREFIX = 'thuinuvio:';

export function makeId(provider: string, slug: string): string {
  return ID_PREFIX + provider + ':' + slug;
}

export interface ParsedId {
  provider: string | null;
  slug: string | null;
  episode: string | null;
}

/**
 * Parse thuinuvio ID → {provider, slug, episode}
 *
 * PHP dùng explode(':', $rest, 3) — limit 3 nghĩa là phần thứ 3 giữ nguyên
 * mọi dấu ':' còn lại. String.split() không có limit tương đương nên tách tay.
 */
export function parseId(id: string): ParsedId {
  if (!id.startsWith(ID_PREFIX)) {
    return { provider: null, slug: null, episode: null };
  }

  const rest = id.slice(ID_PREFIX.length);

  const firstColon = rest.indexOf(':');
  if (firstColon === -1) {
    // Chỉ có {provider}, không có slug
    return { provider: rest || null, slug: null, episode: null };
  }

  const provider = rest.slice(0, firstColon);
  const afterProvider = rest.slice(firstColon + 1);

  const secondColon = afterProvider.indexOf(':');
  if (secondColon === -1) {
    return {
      provider: provider || null,
      slug: afterProvider || null,
      episode: null,
    };
  }

  const slug = afterProvider.slice(0, secondColon);
  const episode = afterProvider.slice(secondColon + 1);

  return {
    provider: provider || null,
    slug: slug || null,
    // PHP: $parts[2] ?? null — chuỗi rỗng vẫn là chuỗi rỗng, không thành null
    episode: episode,
  };
}

export type TmdbType = 'movie' | 'tv';

export interface ParsedStremioId {
  imdbId: string | null;
  tmdbType: TmdbType;
  tmdbId: string | null;
  season: number | null;
  episode: number | null;
}

/**
 * Parse Stremio stream ID (IMDB/TMDB) từ addon khác.
 *
 *   "tt1234567"           → imdb=tt1234567, type=movie
 *   "tt1234567:1:3"       → imdb=tt1234567, type=tv, s=1, e=3
 *   "tmdb:movie:299534"   → tmdb=299534, type=movie
 *   "tmdb:tv:283022:1:3"  → tmdb=283022, type=tv, s=1, e=3
 */
export function parseStremioId(id: string): ParsedStremioId {
  if (id.startsWith('tmdb:')) {
    const parts = id.split(':');
    const rawType = parts[1] ?? 'movie';
    const tmdbType: TmdbType = rawType === 'tv' ? 'tv' : 'movie';
    return {
      imdbId: null,
      tmdbType,
      tmdbId: parts[2] ?? null,
      season: parts[3] !== undefined ? toInt(parts[3]) : null,
      episode: parts[4] !== undefined ? toInt(parts[4]) : null,
    };
  }

  if (id.startsWith('tt')) {
    const parts = id.split(':');
    const season = parts[1] !== undefined ? toInt(parts[1]) : null;
    const episode = parts[2] !== undefined ? toInt(parts[2]) : null;
    return {
      imdbId: parts[0] ?? null,
      // Giống PHP: đoán type từ việc có season hay không
      tmdbType: season !== null ? 'tv' : 'movie',
      tmdbId: null,
      season,
      episode,
    };
  }

  return {
    imdbId: null,
    tmdbType: 'movie',
    tmdbId: null,
    season: null,
    episode: null,
  };
}

/** Tương đương (int) cast của PHP: parse prefix số, không parse được → 0 */
function toInt(value: string): number {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}
