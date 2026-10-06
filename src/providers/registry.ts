/**
 * registry.ts — Quản lý instance các providers.
 */

import type { CacheStore } from '../lib/cache.js';
import type { Provider } from './types.js';
import { KKPhimProvider } from './kkphim.js';
import { OPhimProvider } from './ophim.js';
import { VsmovProvider } from './vsmov.js';
import { NguoncProvider } from './nguonc.js';
import { VodPhimProvider } from './vodphim.js';

/**
 * Trả về danh sách providers theo đúng thứ tự ưu tiên.
 * KKPhim -> OPhim -> VSMov -> NguonC -> VodPhim (fallback cuối cùng)
 */
export function getProviders(cache: CacheStore, ctx: ExecutionContext): Provider[] {
  return [
    new KKPhimProvider(cache, ctx),
    new OPhimProvider(cache, ctx),
    new VsmovProvider(cache, ctx),
    new NguoncProvider(cache, ctx),
    new VodPhimProvider(cache, ctx),
  ];
}

export function getProviderByPrefix(prefix: string, cache: CacheStore, ctx: ExecutionContext): Provider | null {
  for (const provider of getProviders(cache, ctx)) {
    if (provider.prefix === prefix) return provider;
  }
  return null;
}
