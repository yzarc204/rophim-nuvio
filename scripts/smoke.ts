/**
 * smoke.ts — Kiểm tra cơ bản
 * Dùng thay test.php cũ. Chạy: npm run smoke
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';

async function fetchJson(path: string): Promise<any> {
  const url = `${BASE_URL}${path}`;
  console.log(`\n\x1b[36mGET ${url}\x1b[0m`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`\x1b[31mHTTP ${res.status} ${res.statusText}\x1b[0m`);
    return null;
  }
  const data = await res.json();
  return data;
}

async function run() {
  console.log(`Smoke test target: ${BASE_URL}`);

  // 1. Manifest
  const manifest = await fetchJson('/manifest.json');
  console.log('Manifest:', manifest?.id, manifest?.version, '- Resources:', manifest?.resources);

  // 2. Search
  const search = await fetchJson('/catalog/movie/rothui-reborn-movie/search=conan.json');
  console.log(`Search 'conan': Found ${search?.metas?.length ?? 0} results`);

  if (search?.metas?.length > 0) {
    const first = search.metas[0];
    console.log('  -> First:', first.id, '|', first.name);

    // 3. Meta (ID nội bộ)
    const meta = await fetchJson(`/meta/movie/${encodeURIComponent(first.id)}.json`);
    console.log(`Meta '${first.id}':`, meta?.meta?.name, '- Type:', meta?.meta?.type);

    // 4. Stream (ID nội bộ)
    const stream = await fetchJson(`/stream/movie/${encodeURIComponent(first.id)}.json`);
    console.log(`Streams '${first.id}': Found ${stream?.streams?.length ?? 0}`);
    if (stream?.streams?.length > 0) {
      console.log('  -> [0]:', stream.streams[0].title);
      console.log('     url:', stream.streams[0].url.substring(0, 100) + '...');
    }
  }

  // 5. Stream (ID TMDB - fallback)
  // Venom: Let There Be Carnage (2021) - TMDB 580489
  const tmdb = await fetchJson('/stream/movie/tmdb:movie:580489.json');
  console.log(`Streams 'tmdb:movie:580489': Found ${tmdb?.streams?.length ?? 0}`);
  if (tmdb?.streams?.length > 0) {
    console.log('  -> [0]:', tmdb.streams[0].title);
    console.log('     url:', tmdb.streams[0].url.substring(0, 100) + '...');
  }
}

run().catch(console.error);
