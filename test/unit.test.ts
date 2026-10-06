import { describe, it, expect } from 'vitest';
import { stripTags, normalizeEpisodeName, normalizeEpisodeSlug } from '../src/lib/text.js';
import { parseId, parseStremioId, makeId } from '../src/lib/id.js';

describe('text.ts', () => {
  it('stripTags removes HTML and decodes basic entities', () => {
    expect(stripTags('<b>Hello</b>')).toBe('Hello');
    expect(stripTags('<p>a</p><br/> b')).toBe('a b');
    expect(stripTags('Qu&quot;ote&#39;')).toBe('Qu"ote\'');
    expect(stripTags('A&nbsp;B')).toBe('A B');
  });

  it('normalizeEpisodeName strips prefix and leading zeros', () => {
    expect(normalizeEpisodeName('Tập 01')).toBe('1');
    expect(normalizeEpisodeName('tập 002')).toBe('2');
    expect(normalizeEpisodeName('Tập 10')).toBe('10');
    expect(normalizeEpisodeName('Full')).toBe('Full');
    expect(normalizeEpisodeName('Tập Đặc Biệt')).toBe('Đặc Biệt');
  });

  it('normalizeEpisodeSlug handles standard and VSMov formats', () => {
    expect(normalizeEpisodeSlug('tap-01')).toBe('1');
    expect(normalizeEpisodeSlug('tap-10')).toBe('10');
    expect(normalizeEpisodeSlug('tap-full')).toBe('full');
    expect(normalizeEpisodeSlug('tap-dac-biet')).toBe('dac-biet');
  });
});

describe('id.ts', () => {
  it('makeId creates correct prefix', () => {
    expect(makeId('kkphim', 'abc')).toBe('thuinuvio:kkphim:abc');
  });

  it('parseId extracts provider, slug, and episode', () => {
    expect(parseId('thuinuvio:kkphim:tham-tu-conan')).toEqual({
      provider: 'kkphim',
      slug: 'tham-tu-conan',
      episode: null,
    });

    expect(parseId('thuinuvio:vsmov:tham-tu-conan:tap-1')).toEqual({
      provider: 'vsmov',
      slug: 'tham-tu-conan',
      episode: 'tap-1',
    });

    expect(parseId('thuinuvio:ophim')).toEqual({
      provider: 'ophim',
      slug: null,
      episode: null,
    });

    expect(parseId('invalid')).toEqual({
      provider: null,
      slug: null,
      episode: null,
    });
  });

  it('parseStremioId handles IMDB and TMDB IDs', () => {
    expect(parseStremioId('tt1234567')).toEqual({
      imdbId: 'tt1234567',
      tmdbType: 'movie', // Đoán từ việc không có season
      tmdbId: null,
      season: null,
      episode: null,
    });

    expect(parseStremioId('tt1234567:1:3')).toEqual({
      imdbId: 'tt1234567',
      tmdbType: 'tv', // Có season => tv
      tmdbId: null,
      season: 1,
      episode: 3,
    });

    expect(parseStremioId('tmdb:movie:1234')).toEqual({
      imdbId: null,
      tmdbType: 'movie',
      tmdbId: '1234',
      season: null,
      episode: null,
    });

    expect(parseStremioId('tmdb:tv:1234:2:5')).toEqual({
      imdbId: null,
      tmdbType: 'tv',
      tmdbId: '1234',
      season: 2,
      episode: 5,
    });
  });
});
