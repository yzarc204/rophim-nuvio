/**
 * nguonc.ts — Nguồn NguonC (phim.nguonc.com)
 */

import { cachedFetchJson } from '../lib/http.js';
import type { CacheStore } from '../lib/cache.js';
import { stripTags, normalizeEpisodeName, normalizeEpisodeSlug } from '../lib/text.js';
import type { Provider, SearchResult, FilmDetail, FilmInfo, FilmServerEpisode } from './types.js';

const BASE = 'https://phim.nguonc.com/api';

interface NguoncSearchResponse {
  status: string;
  items?: any[];
}

interface NguoncFilmResponse {
  status: string;
  movie?: any;
}

export class NguoncProvider implements Provider {
  prefix = 'nguonc';
  label = 'NguonC';

  constructor(private cache: CacheStore, private ctx: ExecutionContext) {}

  async search(keyword: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({ keyword });
    const data = await cachedFetchJson<NguoncSearchResponse>(
      `${BASE}/films/search?${params}`,
      this.cache,
      this.ctx
    );

    if (!data || data.status !== 'success' || !data.items) return [];

    const results: SearchResult[] = [];
    for (const item of data.items) {
      if (!item.name) continue;
      results.push({
        name: item.name ?? '',
        original_name: item.original_name ?? '',
        slug: item.slug ?? '',
        thumb: item.thumb_url || null,
        poster: item.poster_url || null,
        type: this.resolveType(item.current_episode),
      });
    }
    return results;
  }

  async film(slug: string): Promise<FilmDetail | null> {
    const data = await cachedFetchJson<NguoncFilmResponse>(
      `${BASE}/film/${encodeURIComponent(slug)}`,
      this.cache,
      this.ctx
    );
    if (!data || data.status !== 'success' || !data.movie) return null;

    const movie = data.movie;

    const info: FilmInfo = {
      name: movie.name ?? '',
      original_name: movie.original_name ?? '',
      slug: movie.slug ?? '',
      thumb: movie.thumb_url || null,
      poster: movie.poster_url || null,
      description: stripTags(movie.description ?? ''),
      year: null, // NguonC không trả year trực tiếp
      type: (this.resolveType(movie.current_episode) ?? 'movie') as 'movie' | 'series',
    };

    const servers: FilmServerEpisode[] = [];
    for (const server of movie.episodes ?? []) {
      const serverName = server.server_name ?? 'NguonC';
      for (const ep of server.items ?? []) {
        let name = String(ep.name ?? '').trim();
        let epSlug = String(ep.slug ?? '').trim();

        if (!name && !epSlug) continue;

        name = normalizeEpisodeName(name);
        epSlug = normalizeEpisodeSlug(epSlug);

        const embed = ep.embed ?? '';
        if (!embed) continue;

        servers.push({
          episode_name: name || epSlug,
          episode_slug: epSlug || name,
          server_name: serverName,
          embed_url: embed,
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
    const params = new URLSearchParams({ keyword });
    const data = await cachedFetchJson<NguoncSearchResponse>(
      `${BASE}/films/search?${params}`,
      this.cache,
      this.ctx
    );

    if (!data || data.status !== 'success' || !data.items) return null;

    const nameLower = name.toLowerCase();
    const origLower = originalName.toLowerCase();

    for (const item of data.items) {
      const itemName = String(item.name ?? '').toLowerCase();
      const itemOrig = String(item.original_name ?? '').toLowerCase();
      const slug = item.slug;

      if (!slug) continue;

      if (itemName === nameLower || itemOrig === origLower) return slug;
      if (origLower && itemName === origLower) return slug;
      if (nameLower && itemOrig === nameLower) return slug;
    }

    return null;
  }

  private resolveType(currentEpisode: string | null | undefined): 'movie' | 'series' | null {
    const cur = String(currentEpisode ?? '').toLowerCase().trim();
    if (!cur) return null;
    if (cur === 'full' || cur.startsWith('hoàn tất (1/1)')) return 'movie';
    if (cur.includes('hoàn tất') || cur.includes('/')) return 'series';
    return null;
  }
}
