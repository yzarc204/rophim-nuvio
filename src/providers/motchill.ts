/**
 * motchill.ts — Nguồn Motchill (chỉ dùng cho stream, không dùng cho catalog/meta)
 *
 * Flow:
 *  1. search(keyword) → fetch trang HTML search → parse slug phim khớp nhất
 *  2. getMovieId(slug) → fetch trang chi tiết `/phim/<slug>` → extract movieId nội bộ
 *  3. getEpisodes(movieId) → gọi baseapi → trả về servers/episodes với m3u8
 */

import { cachedFetchText, cachedFetchJson } from '../lib/http.js';
import type { CacheStore } from '../lib/cache.js';
import type { FilmServerEpisode } from './types.js';

const BASE = 'https://motchillm.fm';

interface MotchillEpisodeItem {
  id: string;
  movie_id: string;
  server: string;
  name: string;
  slug: string;
  type: 'm3u8' | 'embed';
  link: string;
  subtitles: string | null;
}

interface MotchillServer {
  name: string;
  count: number;
  items: MotchillEpisodeItem[];
}

interface MotchillEpisodesResponse {
  status: string;
  movie_id: number;
  total: number;
  servers: MotchillServer[];
}

export class MotchillProvider {
  readonly prefix = 'motchill';
  readonly label = 'Motchill';

  constructor(private cache: CacheStore, private ctx: ExecutionContext) {}

  /**
   * Tìm slug Motchill theo keyword, trả về slug khớp tên nhất.
   * So khớp name/originalName với các phim trong kết quả search.
   */
  async findSlug(name: string, originalName: string): Promise<string | null> {
    const keyword = encodeURIComponent(name);
    const html = await cachedFetchText(
      `${BASE}/search?q=${keyword}`,
      this.cache,
      this.ctx
    );
    if (!html) return null;

    // Kết quả search xuất hiện dạng href="/phim/<slug>" trong RSC payload
    const slugs: string[] = [...html.matchAll(/\/phim\/([a-z0-9][a-z0-9\-]*\d+)/g)]
      .map((m) => m[1])
      .filter((s): s is string => s !== undefined);

    if (slugs.length === 0) return null;

    // Thử khớp tên trong HTML — so sánh slug với name/originalName đã normalize
    const nameLower = name.toLowerCase().trim();
    const origLower = (originalName ?? '').toLowerCase().trim();

    for (const slug of slugs) {
      // Slug dạng "chuyen-tinh-ma-quai-1784388756" — bỏ phần số cuối để so sánh
      const slugText = slug.replace(/-\d+$/, '').replace(/-/g, ' ');

      if (nameLower && slugText.includes(nameLower)) return slug;
      if (origLower && slugText.includes(origLower)) return slug;
    }

    // Thử search lại bằng originalName nếu name không khớp
    if (originalName && originalName !== name) {
      const keyword2 = encodeURIComponent(originalName);
      const html2 = await cachedFetchText(
        `${BASE}/search?q=${keyword2}`,
        this.cache,
        this.ctx
      );
      if (html2) {
        const slugs2: string[] = [...html2.matchAll(/\/phim\/([a-z0-9][a-z0-9\-]*\d+)/g)]
          .map((m) => m[1])
          .filter((s): s is string => s !== undefined);
        if (slugs2.length > 0) return slugs2[0] ?? null;
      }
    }

    // Fallback: trả về slug đầu tiên
    return slugs[0] ?? null;
  }

  /**
   * Lấy movieId nội bộ từ trang chi tiết phim.
   * HTML chứa RSC payload với pattern: movieId\":\"<id>
   */
  async getMovieId(slug: string): Promise<string | null> {
    const html = await cachedFetchText(
      `${BASE}/phim/${encodeURIComponent(slug)}`,
      this.cache,
      this.ctx
    );
    if (!html) return null;

    // Pattern trong Next.js RSC payload: movieId\":\"81838\"
    const match = html.match(/movieId\\":\\"(\d+)\\"/);
    if (match?.[1]) return match[1];

    // Fallback: escaped JSON trong attribute
    const match2 = html.match(/movieId":"(\d+)"/);
    if (match2?.[1]) return match2[1];

    return null;
  }

  /**
   * Gọi baseapi để lấy danh sách tập + m3u8.
   */
  async getEpisodes(movieId: string): Promise<MotchillServer[]> {
    const data = await cachedFetchJson<MotchillEpisodesResponse>(
      `${BASE}/baseapi/episodes?movie_id=${encodeURIComponent(movieId)}`,
      this.cache,
      this.ctx
    );
    if (!data || data.status !== 'success' || !Array.isArray(data.servers)) {
      return [];
    }
    return data.servers;
  }

  /**
   * Tìm + fetch toàn bộ episodes cho một phim theo tên.
   * Trả về FilmServerEpisode[] đã normalize, chỉ lấy type=m3u8.
   *
   * @param episodeNumber  Số tập cần lọc (VD: "1", "2"). Null = phim lẻ (lấy tất cả).
   */
  async getStreams(
    name: string,
    originalName: string,
    episodeNumber: string | null
  ): Promise<FilmServerEpisode[]> {
    const slug = await this.findSlug(name, originalName);
    if (!slug) return [];

    const movieId = await this.getMovieId(slug);
    if (!movieId) return [];

    const servers = await this.getEpisodes(movieId);
    if (servers.length === 0) return [];

    const episodes: FilmServerEpisode[] = [];

    for (const server of servers) {
      // Chỉ lấy type=m3u8
      const m3u8Items = server.items.filter((item) => item.type === 'm3u8');

      for (const item of m3u8Items) {
        if (!item.link) continue;

        // Normalize episode number từ name ("Tập 01" → "1", "1" → "1")
        const epNum = normalizeMotchillEpName(item.name);

        // Lọc theo tập nếu được yêu cầu
        if (episodeNumber !== null && epNum !== episodeNumber) continue;

        episodes.push({
          episode_name: epNum,
          episode_slug: epNum,
          server_name: `Motchill · ${server.name}`,
          m3u8_url: item.link,
        });
      }
    }

    return episodes;
  }
}

/**
 * Normalize tên tập của Motchill.
 * "Tập 01" → "1", "Tập 1" → "1", "1" → "1", "01" → "1"
 */
function normalizeMotchillEpName(name: string): string {
  let s = String(name ?? '').trim();
  // Bỏ prefix "Tập "
  s = s.replace(/^[tT]ập\s*/u, '');
  // Bỏ số 0 đứng đầu (01 → 1)
  s = s.replace(/^0+(?=\d)/, '');
  return s.trim() || name.trim();
}
