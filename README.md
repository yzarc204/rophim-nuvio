# Rổ Phim (Nuvio-Rothui Worker)

Rổ Phim. Đây là một Stremio Addon được xây dựng trên nền tảng Cloudflare Workers.

## Tính năng
- **Hỗ trợ nội dung**: Tìm kiếm phim lẻ (Movies) và phim bộ (Series).
- **Tài nguyên Stremio (Resources)**: Cung cấp `catalog` (tìm kiếm), `meta` (thông tin phim), `stream` (link xem phim) và `subtitles` (phụ đề).
- **HLS Proxy**: Tích hợp HLS Proxy sử dụng các đuôi file ảo (`.png`) cho playlist, segment và streamc nhằm tránh cơ chế tự động quét của Cloudflare.
- **Tối ưu hóa (Cache)**: Tích hợp hệ thống lưu trữ `TwoTierCache` xuyên suốt giúp cải thiện tốc độ tải.

## Công nghệ sử dụng
- **Ngôn ngữ**: TypeScript
- **Nền tảng chạy**: Cloudflare Workers
- **Công cụ dòng lệnh**: Wrangler
- **Kiểm thử**: Vitest

## Cài đặt và Phát triển

Đảm bảo bạn đã cài đặt Node.js và npm.

1. **Cài đặt các gói phụ thuộc**:
   ```bash
   npm install
   ```

2. **Chạy server thử nghiệm ở Local**:
   ```bash
   npm run dev
   ```
   Addon sẽ chạy ở môi trường cục bộ thông qua `wrangler dev`.

3. **Deploy lên Cloudflare**:
   ```bash
   npm run deploy
   ```

## Cấu trúc thư mục chính
- `public/`: Thư mục chứa các tệp tĩnh như `logo.png` (sử dụng Cloudflare Assets binding).
- `src/index.ts`: Entrypoint (Router chính) điều hướng các request đến đúng handlers.
- `src/handlers/`: Các file xử lý logic cho Stremio Addon:
  - `manifest.ts`: Khai báo manifest cấu hình của addon.
  - `search.ts`: Xử lý tìm kiếm catalog.
  - `meta.ts`: Trả về chi tiết siêu dữ liệu (metadata).
  - `stream.ts`: Trả về các luồng (streams).
  - `subtitle.ts`: Trả về phụ đề tương ứng.
  - `hls-proxy.ts`: Proxy stream video qua Cloudflare mượt mà.
- `src/lib/`: Chứa các tiện ích, ví dụ như module bộ nhớ đệm (cache).

## Cấu hình
Các thông số cấu hình của Cloudflare Worker được nằm tại `wrangler.jsonc` (tên worker là `nuvio-rothui`). Dự án không sử dụng Cloudflare KV/D1 trong cấu hình hiện tại mà chủ yếu thực thi proxy trực tiếp.
