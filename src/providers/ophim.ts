/**
 * ophim.ts — Nguồn OPhim
 */

import { cachedFetchJson } from '../lib/http.js';
import type { CacheStore } from '../lib/cache.js';
import { stripTags, normalizeEpisodeName, normalizeEpisodeSlug } from '../lib/text.js';
import type { Provider, SearchResult, FilmDetail, FilmInfo, FilmServerEpisode } from './types.js';

const BASE = 'https://ophim1.com';

interface OphimApiResponse {
  status: string;
  data?: {
    APP_DOMAIN_CDN_IMAGE?: string;
    items?: any[];
    item?: any;
  };
}

export class OPhimProvider implements Provider {
  prefix = 'ophim';
  label = 'OPhim';

  constructor(private cache: CacheStore, private ctx: ExecutionContext) {}

  async search(keyword: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({ keyword });
    const data = await cachedFetchJson<OphimApiResponse>(`${BASE}/v1/api/tim-kiem?${params}`, this.cache, this.ctx);

    if (!data || data.status !== 'success' || !data.data?.items) return [];

    const cdnImage = data.data.APP_DOMAIN_CDN_IMAGE ?? '';
    const results: SearchResult[] = [];

    for (const item of data.data.items) {
      if (!item.name) continue;

      const thumb = this.fullUrl(item.thumb_url ?? '', cdnImage);
      const poster = this.fullUrl(item.poster_url ?? '', cdnImage);

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

  async film(slug: string): Promise<FilmDetail | null> {
    const data = await cachedFetchJson<OphimApiResponse>(`${BASE}/v1/api/phim/${encodeURIComponent(slug)}`, this.cache, this.ctx);
    if (!data || data.status !== 'success' || !data.data?.item) return null;

    const item = data.data.item;
    const cdnImage = data.data.APP_DOMAIN_CDN_IMAGE ?? '';

    const info: FilmInfo = {
      name: item.name ?? '',
      original_name: item.origin_name ?? '',
      slug: item.slug ?? '',
      thumb: this.fullUrl(item.thumb_url ?? '', cdnImage) || null,
      poster: this.fullUrl(item.poster_url ?? '', cdnImage) || null,
      description: stripTags(item.content ?? ''),
      year: item.year ? Number(item.year) : null,
      type: (this.resolveType(item.type, item.episode_current) ?? 'movie') as 'movie' | 'series',
    };

    const servers: FilmServerEpisode[] = [];
    for (const server of item.episodes ?? []) {
      const serverName = server.server_name ?? 'OPhim';
      for (const ep of server.server_data ?? []) {
        let name = String(ep.name ?? '').trim();
        let epSlug = String(ep.slug ?? '').trim();

        if (!name && !epSlug) continue;

        name = normalizeEpisodeName(name);
        epSlug = normalizeEpisodeSlug(epSlug);

        const m3u8 = ep.link_m3u8 ?? '';
        const embed = ep.link_embed ?? '';

        if (!m3u8 && !embed) continue;

        servers.push({
          episode_name: name || epSlug,
          episode_slug: epSlug || name,
          server_name: serverName,
          m3u8_url: m3u8,
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

  private async findSlugBySearch(keyword: string, name: string, originalName: string): Promise<string | null> {
    const params = new URLSearchParams({ keyword });
    const data = await cachedFetchJson<OphimApiResponse>(`${BASE}/v1/api/tim-kiem?${params}`, this.cache, this.ctx);

    if (!data || data.status !== 'success' || !data.data?.items) return null;

    const nameLower = name.toLowerCase();
    const origLower = originalName.toLowerCase();

    for (const item of data.data.items) {
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

  private resolveType(apiType: string | null | undefined, episodeCurrent: string | null | undefined): 'movie' | 'series' | null {
    const t = String(apiType ?? '').toLowerCase();
    if (['phimbo', 'tvshows', 'series'].includes(t)) return 'series';
    if (['phimle', 'hoathinh', 'single', 'movie'].includes(t)) return 'movie';

    const cur = String(episodeCurrent ?? '').toLowerCase().trim();
    if (cur === '' || cur === 'full') return 'movie';
    return 'series';
  }

  private fullUrl(url: string, cdnImage: string): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    const base = cdnImage || BASE;
    return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }
}
