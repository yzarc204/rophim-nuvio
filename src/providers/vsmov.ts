/**
 * vsmov.ts — Nguồn VSMov
 */

import { cachedFetchJson, cachedFetchText } from '../lib/http.js';
import type { CacheStore } from '../lib/cache.js';
import { stripTags, normalizeEpisodeName, normalizeEpisodeSlug } from '../lib/text.js';
import { config } from '../config.js';
import type { Provider, SearchResult, FilmDetail, FilmInfo, FilmServerEpisode, EpisodeSubtitle } from './types.js';

const BASE = 'https://vsmov.com/api';

// Map code từ VSMOV → ISO 639-1 (2-letter) mà Stremio/Nuvio nhận diện đúng
const VSMOV_LANG_MAP: Record<string, string> = {
  vie: 'vi',
  vi: 'vi',
  viet: 'vi',
  eng: 'en',
  en: 'en',
  chi: 'zh',
  zh: 'zh',
  kor: 'ko',
  ko: 'ko',
  jpn: 'ja',
  ja: 'ja',
  tha: 'th',
  th: 'th',
};

interface VsmovApiResponse {
  status: boolean;
  items?: any[];
  movie?: any;
  episodes?: any[];
}

export class VsmovProvider implements Provider {
  prefix = 'vsmov';
  label = 'VSMov';

  constructor(private cache: CacheStore, private ctx: ExecutionContext) {}

  async search(keyword: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({ keyword });
    const data = await cachedFetchJson<VsmovApiResponse>(`${BASE}/tim-kiem?${params}`, this.cache, this.ctx);

    if (!data || data.status !== true || !data.items) return [];

    const results: SearchResult[] = [];
    for (const item of data.items) {
      if (!item.name) continue;

      results.push({
        name: item.name ?? '',
        original_name: item.origin_name ?? '',
        slug: item.slug ?? '',
        thumb: item.thumb_url || null,
        poster: item.poster_url || null,
        type: this.resolveType(item.type, item.episode_current),
      });
    }
    return results;
  }

  async film(slug: string): Promise<FilmDetail | null> {
    const data = await cachedFetchJson<VsmovApiResponse>(`${BASE}/phim/${encodeURIComponent(slug)}`, this.cache, this.ctx);
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
      const serverName = server.server_name ?? 'VSMov';
      for (const ep of server.server_data ?? []) {
        let name = String(ep.name ?? '').trim();
        let epSlug = String(ep.slug ?? '').trim();

        if (!name && !epSlug) continue;

        name = normalizeEpisodeName(name);
        epSlug = normalizeEpisodeSlug(epSlug);

        let embedUrl = ep.link_embed ?? '';
        let m3u8Url = ep.link_m3u8 ?? '';

        // VSMov: convert embed URL → direct m3u8
        if (!m3u8Url && embedUrl) {
          m3u8Url = this.embedToM3u8(embedUrl);
        }

        if (!m3u8Url && !embedUrl) continue;

        let referer = '';
        let embedOrigin = '';
        if (embedUrl) {
          try {
            const u = new URL(embedUrl);
            referer = `${u.protocol}//${u.host}/`;
            embedOrigin = `${u.protocol}//${u.host}`;
          } catch (e) {}
        }

        // Extract subtitles from embed page
        const subtitles = embedUrl
          ? await this.extractSubtitles(embedUrl, embedOrigin, referer)
          : [];

        servers.push({
          episode_name: name || epSlug,
          episode_slug: epSlug || name,
          server_name: serverName,
          m3u8_url: m3u8Url,
          embed_url: embedUrl,
          _referer: referer,
          _subtitles: subtitles.length > 0 ? subtitles : undefined,
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
    const data = await cachedFetchJson<VsmovApiResponse>(`${BASE}/tim-kiem?${params}`, this.cache, this.ctx);

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

  private async extractSubtitles(embedUrl: string, embedOrigin: string, referer: string): Promise<EpisodeSubtitle[]> {
    const html = await cachedFetchText(embedUrl, this.cache, this.ctx, {
      headers: {
        'Accept-Language': 'vi-VN,vi;q=0.9',
        Referer: referer || embedOrigin + '/',
        'User-Agent': config.browserUserAgent,
      },
    });
    if (!html) return [];

    // HTML chứa: subtitles: [{"name":"vie ...","url":"/video/.../subtitle/xxx.vtt","code":"vie"}]
    // Tìm đúng key "subtitles:" trong playerOptions (tránh match nhầm CSS class hay attribute)
    // Dùng indexOf + bracket-counting thay vì regex lazy (tránh cắt sớm khi có nested ']' trong string)
    const keyMatch = html.match(/\bsubtitles\s*:/);
    if (!keyMatch || keyMatch.index === undefined) return [];
    const arrStart = html.indexOf('[', keyMatch.index);
    if (arrStart === -1) return [];

    // Tìm vị trí ']' đóng matching — đếm bracket depth
    let depth = 0;
    let arrEnd = -1;
    for (let i = arrStart; i < html.length; i++) {
      const ch = html[i];
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { arrEnd = i; break; }
      }
    }
    if (arrEnd === -1) return [];

    let parsed: any[];
    try {
      parsed = JSON.parse(html.slice(arrStart, arrEnd + 1));
    } catch {
      return [];
    }

    const results: EpisodeSubtitle[] = [];
    for (const sub of parsed) {
      const rawUrl: string = String(sub.url ?? '').trim();
      if (!rawUrl) continue;

      // URL có thể là relative path → prepend origin
      const fullUrl = rawUrl.startsWith('http') ? rawUrl : `${embedOrigin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;

      // Ưu tiên `code` (vd: "vie", "eng") trước, fallback sang phần đầu của `name` nếu không có
      const rawCode = String(sub.code ?? '').trim() || String(sub.name ?? '').trim().split(/\s+/)[0] || 'vie';
      const code = rawCode.slice(0, 3).toLowerCase();
      const lang = VSMOV_LANG_MAP[code] ?? code;

      results.push({ id: `vsmov-sub-${lang}-${results.length}`, url: fullUrl, lang });
    }
    return results;
  }

  private embedToM3u8(embedUrl: string): string {
    const match = embedUrl.match(/^(https?:\/\/[^\/]+)\/video\/([a-f0-9\-]{36})$/i);
    if (!match) return '';
    return `${match[1]}/stream/${match[2]}/master.m3u8`;
  }

  private resolveType(apiType: string | null | undefined, episodeCurrent: string | null | undefined): 'movie' | 'series' | null {
    const t = String(apiType ?? '').toLowerCase();

    if (['phimbo', 'tvshows', 'series'].includes(t)) return 'series';
    if (['phimle', 'hoathinh', 'single', 'movie'].includes(t)) return 'movie';

    const cur = String(episodeCurrent ?? '').toLowerCase().trim();
    if (cur === 'full' || cur === '') return null; // Không chắc
    if (cur.includes('hoàn tất') || cur.includes('tập')) return 'series';

    return null;
  }
}
