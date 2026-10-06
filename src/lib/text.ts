/**
 * text.ts — Xử lý chuỗi (thay strip_tags, preg_replace)
 */

/**
 * Loại bỏ toàn bộ thẻ HTML khỏi chuỗi (giống strip_tags của PHP).
 * Sẽ giải mã entity HTML cơ bản (khác với PHP giữ nguyên entity).
 */
export function stripTags(html: string): string {
  if (!html) return '';
  const text = html.replace(/<[^>]*>/g, ' ');
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chuẩn hóa tên tập phim.
 * "Tập 01" -> "1"
 * "tập 2" -> "2"
 */
export function normalizeEpisodeName(name: string): string {
  let cleaned = name.trim();
  // Strip "Tập"/"tập"
  cleaned = cleaned.replace(/^[tT]ập\s*/, '');
  // Bỏ số 0 đứng đầu nếu đằng sau là số (01 -> 1, 002 -> 2)
  cleaned = cleaned.replace(/^0+(?=\d)/, '');
  return cleaned.trim();
}

/**
 * Chuẩn hóa slug tập phim.
 * "tap-01" -> "1"
 * "tap-11" -> "11"
 * "tap-full" -> "full"
 */
export function normalizeEpisodeSlug(slug: string): string {
  let cleaned = slug.trim();
  // VSMov format "tap-full" -> "full"
  cleaned = cleaned.replace(/^tap-/i, '');
  // Format "tap-01" -> "1" (chỉ số 0 đầu chuỗi đứng trước số)
  cleaned = cleaned.replace(/^0+(\d+)$/i, '$1');
  return cleaned;
}

/**
 * Giải mã base64 (chống lỗi crash của atob với input hỏng)
 */
export function decodeBase64Utf8(encoded: string): string | null {
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return null;
  }
}
