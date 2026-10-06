/**
 * vodphim.ts — Nguồn VodPhim (api.xink.pro)
 *
 * Stream được lấy từ playembed.vip thông qua decode XOR và CDN proxy.
 * Đây là nguồn fallback cuối cùng (sau VSMov).
 */

import { cachedFetchJson } from '../lib/http.js';
import type { CacheStore } from '../lib/cache.js';
import { stripTags, normalizeEpisodeName, normalizeEpisodeSlug } from '../lib/text.js';
import type { Provider, SearchResult, FilmDetail, FilmInfo, FilmServerEpisode } from './types.js';

const BASE = 'https://api.xink.pro/api/content';

interface VodPhimSearchResponse {
  status: boolean;
  items?: VodPhimItem[];
  pagination?: { totalItems: number };
}

interface VodPhimItem {
  _id?: string;
  name?: string;
  slug?: string;
  origin_name?: string;
  type?: string;
  thumb_url?: string;
  poster_url?: string;
  episode_current?: string;
}

interface VodPhimDetailResponse {
  status: boolean;
  movie?: VodPhimMovie;
  episodes?: VodPhimServer[];
}

interface VodPhimMovie extends VodPhimItem {
  content?: string;
  year?: number | string;
  lang?: string;
  quality?: string;
}

interface VodPhimServer {
  server_name?: string;
  server_data?: VodPhimEpisode[];
}

interface VodPhimEpisode {
  episode_id?: string;
  name?: string;
  slug?: string;
  filename?: string;
  link_embed?: string;
}

export class VodPhimProvider implements Provider {
  prefix = 'vodphim';
  label = 'VodPhim';

  constructor(private cache: CacheStore, private ctx: ExecutionContext) {}

  async search(keyword: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: keyword, page: '1', limit: '24' });
    const data = await cachedFetchJson<VodPhimSearchResponse>(
      `${BASE}/tim-kiem?${params}`,
      this.cache,
      this.ctx
    );

    if (!data || data.status !== true || !data.items) return [];

    return data.items
      .filter((item) => item.name && item.slug)
      .map((item) => ({
        name: item.name ?? '',
        original_name: item.origin_name ?? '',
        slug: item.slug ?? '',
        thumb: item.thumb_url || null,
        poster: item.poster_url || null,
        type: this.resolveType(item.type, item.episode_current),
      }));
  }

  async film(slug: string): Promise<FilmDetail | null> {
    const data = await cachedFetchJson<VodPhimDetailResponse>(
      `${BASE}/phim/${encodeURIComponent(slug)}`,
      this.cache,
      this.ctx
    );

    if (!data || data.status !== true || !data.movie) return null;

    const movie = data.movie;
    const info: FilmInfo = {
      name: movie.name ?? '',
      original_name: movie.origin_name ?? '',
      slug: movie.slug ?? '',
      thumb: movie.thumb_url || null,
      poster: movie.poster_url || null,
      description: stripTags(movie.content ?? ''),
      year: movie.year ? Number(movie.year) : null,
      type: (this.resolveType(movie.type, movie.episode_current) ?? 'movie') as 'movie' | 'series',
    };

    const servers: FilmServerEpisode[] = [];

    for (const server of data.episodes ?? []) {
      const serverName = server.server_name ?? 'VodPhim';

      for (const ep of server.server_data ?? []) {
        const embedUrl = ep.link_embed?.trim() ?? '';
        if (!embedUrl) continue;

        const rawName = ep.name ?? ep.slug ?? '';
        const rawSlug = ep.slug ?? ep.name ?? '';
        if (!rawName && !rawSlug) continue;

        const episodeName = normalizeEpisodeName(String(rawName));
        const episodeSlug = normalizeEpisodeSlug(String(rawSlug));

        servers.push({
          episode_name: episodeName || episodeSlug,
          episode_slug: episodeSlug || episodeName,
          server_name: serverName,
          embed_url: embedUrl,
        });
      }
    }

    return { info, servers };
  }

  async filmByName(name: string, originalName: string = ''): Promise<FilmDetail | null> {
    let slug = await this.findSlugBySearch(name, name, originalName);

    if (!slug && originalName && originalName !== name) {
      slug = await this.findSlugBySearch(originalName, name, originalName);
    }

    if (!slug) return null;
    return this.film(slug);
  }

  private async findSlugBySearch(
    keyword: string,
    name: string,
    originalName: string
  ): Promise<string | null> {
    const params = new URLSearchParams({ q: keyword, page: '1', limit: '24' });
    const data = await cachedFetchJson<VodPhimSearchResponse>(
      `${BASE}/tim-kiem?${params}`,
      this.cache,
      this.ctx
    );

    if (!data || data.status !== true || !data.items) return null;

    const nameLower = name.toLowerCase();
    const origLower = originalName.toLowerCase();

    for (const item of data.items) {
      const itemName = String(item.name ?? '').toLowerCase();
      const itemOrig = String(item.origin_name ?? '').toLowerCase();
      const slug = item.slug;

      if (!slug) continue;

      if (itemName === nameLower || itemOrig === origLower) return slug;
      if (origLower && itemName === origLower) return slug;
      if (nameLower && itemOrig === nameLower) return slug;
    }

    return null;
  }

  private resolveType(
    apiType: string | null | undefined,
    episodeCurrent: string | null | undefined
  ): 'movie' | 'series' | null {
    const t = String(apiType ?? '').toLowerCase();

    if (['tv', 'phimbo', 'tvshows', 'series'].includes(t)) return 'series';
    if (['movie', 'phimle', 'hoathinh', 'single'].includes(t)) return 'movie';

    const cur = String(episodeCurrent ?? '').toLowerCase().trim();
    if (cur === 'full' || cur === '') return null;
    if (cur.includes('hoàn tất') || cur.includes('tập')) return 'series';

    return null;
  }
}
