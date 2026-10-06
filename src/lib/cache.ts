/**
 * cache.ts — Giao diện bộ nhớ đệm
 *
 * Workers không có sys_get_temp_dir(). Cache API (L2) là cách chuẩn, nhưng nó
 * có thể bị chặn trên workers.dev subdomain. Do đó dùng thêm in-memory Map (L1)
 * để fallback.
 */

import { config } from '../config.js';

export interface CacheEntry {
  body: string;
  expiresAt: number; // Date.now() + TTL (ms)
}

export interface CacheStore {
  /** Lấy giá trị từ cache (hoặc null nếu hết hạn/không có) */
  get(key: string): Promise<string | null>;
  /** Ghi giá trị vào cache không làm chậm request (qua ctx.waitUntil) */
  put(key: string, body: string, ctx: ExecutionContext): void;
}

/** Prefix URL ảo cho Cache API key vì nó chỉ nhận request chuẩn HTTP */
const CACHE_NAMESPACE = 'https://cache.internal/';

export class TwoTierCache implements CacheStore {
  // L1: In-memory map (dùng chung cho toàn isolate)
  private l1 = new Map<string, CacheEntry>();
  private readonly maxL1Entries = config.memoryCacheMaxEntries;
  private readonly ttlSec = config.cacheTtl;

  constructor() {}

  async get(key: string): Promise<string | null> {
    const now = Date.now();

    // 1. Thử L1 (nhanh nhất)
    const mem = this.l1.get(key);
    if (mem) {
      if (now < mem.expiresAt) return mem.body;
      this.l1.delete(key);
    }

    // 2. Thử L2 (Cache API)
    try {
      const cache = caches.default;
      const req = new Request(CACHE_NAMESPACE + encodeURIComponent(key));
      const res = await cache.match(req);

      if (res && res.ok) {
        // Kiểm tra header Cache-Control: max-age có hiệu lực
        const body = await res.text();

        // Ghi ngược lại L1 để lần sau đọc nhanh hơn
        this.writeL1(key, body);
        return body;
      }
    } catch (e) {
      // Bỏ qua lỗi (ví dụ: Cache API không khả dụng trên workers.dev)
    }

    return null;
  }

  put(key: string, body: string, ctx: ExecutionContext): void {
    // 1. Ghi L1 ngay lập tức (đồng bộ)
    this.writeL1(key, body);

    // 2. Ghi L2 ngầm (không đợi)
    try {
      const cache = caches.default;
      const req = new Request(CACHE_NAMESPACE + encodeURIComponent(key));
      const res = new Response(body, {
        headers: {
          'Cache-Control': `public, max-age=${this.ttlSec}`,
        },
      });

      // waitUntil để worker không bị sleep khi đang ghi cache
      ctx.waitUntil(cache.put(req, res).catch(() => {}));
    } catch (e) {
      // Lỗi thì thôi (do giới hạn môi trường)
    }
  }

  private writeL1(key: string, body: string): void {
    if (this.l1.size >= this.maxL1Entries) {
      // LRU thô sơ: xóa entry đầu tiên
      const firstKey = this.l1.keys().next().value;
      if (firstKey) this.l1.delete(firstKey);
    }

    this.l1.set(key, {
      body,
      expiresAt: Date.now() + this.ttlSec * 1000,
    });
  }
}
