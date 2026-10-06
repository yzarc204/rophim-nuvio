/**
 * providers/types.ts
 */

export interface SearchResult {
  name: string;
  original_name: string;
  slug: string;
  thumb: string | null;
  poster: string | null;
  type: 'movie' | 'series' | null;
}

export interface EpisodeSubtitle {
  id: string;
  url: string;
  lang: string;
}

export interface FilmServerEpisode {
  episode_name: string;
  episode_slug: string;
  server_name: string;
  m3u8_url?: string;
  embed_url?: string;
  _referer?: string;
  _subtitles?: EpisodeSubtitle[];
}

export interface FilmInfo {
  name: string;
  original_name: string;
  slug: string;
  thumb: string | null;
  poster: string | null;
  description: string;
  year: number | null;
  type: 'movie' | 'series';
}

export interface FilmDetail {
  info: FilmInfo;
  servers: FilmServerEpisode[];
}

export interface Provider {
  prefix: string;
  label: string;
  search(keyword: string): Promise<SearchResult[]>;
  film(slug: string): Promise<FilmDetail | null>;
  // OPhim / VSMov có fallback search bằng name nếu slug không khớp
  filmByName?(name: string, originalName?: string): Promise<FilmDetail | null>;
}
