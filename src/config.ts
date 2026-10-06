/**
 * config.ts — Cấu hình toàn cục cho addon.
 *
 * Port từ config.php. Chỉnh file này để đổi hành vi addon mà không cần sửa code.
 */

export const config = {
  // ── Hiển thị ──────────────────────────────────────────────────────────────

  /** Dòng đầu (đậm) hiển thị trong danh sách stream của Stremio */
  streamTitle: 'Rổ Phim',



  // ── Cache ─────────────────────────────────────────────────────────────────

  /** TTL cache API response (giây) */
  cacheTtl: 300,

  /** Số entry tối đa giữ trong cache L1 (in-isolate) */
  memoryCacheMaxEntries: 200,

  // ── HTTP ──────────────────────────────────────────────────────────────────

  /** Timeout mỗi request upstream (ms) */
  requestTimeoutMs: 15_000,

  /** User-Agent gửi kèm khi fetch trang embed + trả trong proxyHeaders */
  browserUserAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',

  /** User-Agent gửi kèm khi gọi API JSON */
  apiUserAgent: 'Mozilla/5.0 (compatible; StremioAddon/1.0)',
} as const;
