/**
 * search.ts
 */

import type { CacheStore } from '../lib/cache.js';
import { makeId } from '../lib/id.js';
import { getProviders } from '../providers/registry.js';

export async function handleSearch(type: string, query: string, cache: CacheStore, ctx: ExecutionContext) {
  if (!query.trim()) return { metas: [] };

  const providers = getProviders(cache, ctx);

  // Chạy tìm kiếm ở tất cả provider SONG SONG thay vì tuần tự
  const results = await Promise.allSettled(
    providers.map((p) => p.search(query).then((res) => ({ provider: p, res })))
  );

  const seen = new Set<string>();
  const metas = [];

  // Vòng lặp theo ĐÚNG THỨ TỰ ban đầu của provider
  for (let i = 0; i < providers.length; i++) {
    const pResult = results[i];
    if (pResult?.status !== 'fulfilled') continue;

    const { provider, res } = pResult.value;

    for (const item of res) {
      const slug = item.slug;
      if (!slug) continue;
      if (item.type === null) continue;
      if (item.type !== type) continue;

      if (seen.has(slug)) continue;
      seen.add(slug);

      const meta: any = {
        id: makeId(provider.prefix, slug),
        type,
        name: item.name ?? '',
      };

      const poster = item.poster ?? item.thumb ?? null;
      if (poster) meta.poster = poster;

      metas.push(meta);
    }
  }

  return { metas };
}
