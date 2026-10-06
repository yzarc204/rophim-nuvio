/**
 * manifest.ts — Sinh Stremio addon manifest
 */

export function handleManifest(origin: string) {
  return {
    id: 'thuis.addon',
    version: '3.2.0',
    name: 'Rổ Phim',
    description: 'Rổ Phim',
    logo: `${origin}/logo.png`, // Tự lấy origin để không hardcode host cũ
    resources: ['catalog', 'meta', 'stream', 'subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:', 'thuinuvio:'],
    catalogs: [
      {
        type: 'movie',
        id: 'rothui-reborn-movie',
        name: 'Rổ Phim',
        extra: [{ name: 'search', isRequired: true }],
      },
      {
        type: 'series',
        id: 'rothui-reborn-series',
        name: 'Rổ Phim',
        extra: [{ name: 'search', isRequired: true }],
      },
    ],
  };
}
