/**
 * kkphim.ts — Nguồn KKPhim
 */

import { cachedFetchJson } from '../lib/http.js';
import type { CacheStore } from '../lib/cache.js';
import { stripTags, normalizeEpisodeName, normalizeEpisodeSlug } from '../lib/text.js';
import type { Provider, SearchResult, FilmDetail, FilmInfo, FilmServerEpisode } from './types.js';

const BASE = 'https://phimapi.com';

interface KKApiSearchResponse {
  status: string;
  data?: { items?: any[] };
}

interface KKApiFilmResponse {
  status: boolean;
  movie?: any;
  episodes?: any[];
}

interface KkApiLookupResponse {
  status: boolean;
  movie?: any;
}

export class KKPhimProvider implements Provider {
  prefix = 'kkphim';
  label = 'KKPhim';

  constructor(private cache: CacheStore, private ctx: ExecutionContext) {}

  async search(keyword: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({ keyword, limit: '10' });
    const data = await cachedFetchJson<KKApiSearchResponse>(
      `${BASE}/v1/api/tim-kiem?${params}`,
      this.cache,
      this.ctx
    );

    if (!data || data.status !== 'success' || !data.data?.items) {
      return [];
    }

    const results: SearchResult[] = [];
    for (const item of data.data.items) {
      if (!item.name) continue;

      let thumb = item.thumb_url ?? item.poster_url ?? '';
      let poster = item.poster_url ?? item.thumb_url ?? '';

      thumb = this.fullImageUrl(thumb);
      poster = this.fullImageUrl(poster);

      results.push({
        name: item.name ?? '',
        original_name: item.origin_name ?? '',
        slug: item.slug ?? '',
        thumb: thumb || null,
        poster: poster || null,
        type: this.resolveType(item.type, item.episode_current),
      });
    }

    return results;
  }

  async findByImdb(imdbId: string): Promise<{ slug: string; name: string; original_name: string } | null> {
    const data = await cachedFetchJson<KkApiLookupResponse>(
      `${BASE}/imdb/title/${encodeURIComponent(imdbId)}`,
      this.cache,
      this.ctx
    );
    return this.extractSlugAndName(data);
  }

  async findByTmdb(
    type: 'movie' | 'tv',
    tmdbId: string
  ): Promise<{ slug: string; name: string; original_name: string } | null> {
    const data = await cachedFetchJson<KkApiLookupResponse>(
      `${BASE}/tmdb/${type}/${encodeURIComponent(tmdbId)}`,
      this.cache,
      this.ctx
    );
    return this.extractSlugAndName(data);
  }

  private extractSlugAndName(data: KkApiLookupResponse | null): {
    slug: string;
    name: string;
    original_name: string;
  } | null {
    if (!data || data.status !== true || !data.movie?.slug) return null;
    return {
      slug: data.movie.slug,
      name: data.movie.name ?? '',
      original_name: data.movie.origin_name ?? '',
    };
  }

  async film(slug: string): Promise<FilmDetail | null> {
    const data = await cachedFetchJson<KKApiFilmResponse>(
      `${BASE}/phim/${encodeURIComponent(slug)}`,
      this.cache,
      this.ctx
    );
    if (!data || data.status !== true || !data.movie) {
      return null;
    }

    const movie = data.movie;
    const info: FilmInfo = {
      name: movie.name ?? '',
      original_name: movie.origin_name ?? '',
      slug: movie.slug ?? '',
      thumb: this.fullImageUrl(movie.thumb_url ?? movie.poster_url ?? '') || null,
      poster: this.fullImageUrl(movie.poster_url ?? movie.thumb_url ?? '') || null,
      description: stripTags(movie.content ?? movie.description ?? ''),
      year: movie.year ? Number(movie.year) : null,
      // API detail trả về là chuẩn nhất nên force cast theo resolveType
      type: (this.resolveType(movie.type, movie.episode_current) ?? 'movie') as 'movie' | 'series',
    };

    const servers: FilmServerEpisode[] = [];
    for (const server of data.episodes ?? []) {
      const serverName = server.server_name ?? 'KKPhim';
      for (const ep of server.server_data ?? []) {
        let name = String(ep.name ?? '').trim();
        let epSlug = String(ep.slug ?? '').trim();

        if (!name && !epSlug) continue;

        name = normalizeEpisodeName(name);
        epSlug = normalizeEpisodeSlug(epSlug);

        const embedUrl = ep.link_embed ?? '';
        const m3u8Url = ep.link_m3u8 ?? '';

        if (!embedUrl && !m3u8Url) continue;

        servers.push({
          episode_name: name || epSlug,
          episode_slug: epSlug || name,
          server_name: serverName,
          embed_url: embedUrl,
          m3u8_url: m3u8Url,
        });
      }
    }

    return { info, servers };
  }

  private resolveType(apiType: string | null | undefined, episodeCurrent: string | null | undefined): 'movie' | 'series' | null {
    const t = String(apiType ?? '').toLowerCase();

    if (['phimbo', 'tvshows'].includes(t)) return 'series';
    if (['phimle', 'hoathinh', 'single'].includes(t)) return 'movie';

    const cur = String(episodeCurrent ?? '').toLowerCase().trim();
    if (cur === 'full' || cur === '') return 'movie';

    return 'series';
  }

  private fullImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return `https://phimapi.com/uploads/movies/${url}`;
  }
}
