/**
 * http.ts — Giao tiếp mạng thay cho curlGet()
 */

import { config } from '../config.js';
import type { CacheStore } from './cache.js';

/**
 * Fetch HTTP và cache kết quả dạng chuỗi (text).
 * Giống hệt curlGet() trong helpers.php.
 */
export async function cachedFetchText(
  url: string,
  cache: CacheStore,
  ctx: ExecutionContext,
  options?: RequestInit
): Promise<string | null> {
  const cacheKey = url;
  const cached = await cache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  try {
    const signal = AbortSignal.timeout(config.requestTimeoutMs);
    const res = await fetch(url, {
      ...options,
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json,*/*',
        'User-Agent': config.apiUserAgent,
        ...options?.headers,
      },
      // Không thể disable SSL/TLS verify trong Workers API
      // Khác với CURLOPT_SSL_VERIFYPEER => false trong PHP
    });

    if (!res.ok) {
      return null;
    }

    const body = await res.text();

    // Cache content dài hợp lệ (> 100 char để loại trừ trang lỗi rỗng)
    if (body.length > 100) {
      cache.put(cacheKey, body, ctx);
    }

    return body;
  } catch (err) {
    // Lỗi mạng hoặc timeout => trả null (giống curlGet)
    return null;
  }
}

/**
 * Fetch HTTP, parse JSON, có cache.
 */
export async function cachedFetchJson<T>(
  url: string,
  cache: CacheStore,
  ctx: ExecutionContext,
  options?: RequestInit
): Promise<T | null> {
  const text = await cachedFetchText(url, cache, ctx, {
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent': config.apiUserAgent,
      ...options?.headers,
    },
  });

  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    return null;
  }
}
