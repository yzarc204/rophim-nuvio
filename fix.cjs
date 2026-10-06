const fs = require('fs');
let content = fs.readFileSync('./src/handlers/stream.ts', 'utf8');

// Undo the bad replacement
content = content.replace(/workerOrigin: string,\n  filmName: string = ''/g, 'workerOrigin: string');

// Only update buildStreams definition
content = content.replace(
  /async function buildStreams\(\n  label: string,\n  servers: FilmServerEpisode\[\],\n  poster: string \| null,\n  cache: CacheStore,\n  ctx: ExecutionContext,\n  workerOrigin: string\n\)/g,
  `async function buildStreams(
  label: string,
  servers: FilmServerEpisode[],
  poster: string | null,
  cache: CacheStore,
  ctx: ExecutionContext,
  workerOrigin: string,
  filmName: string = ''
)`
);

// Update logic inside buildStreams
content = content.replace(
  /const epName = ep.episode_name \?\? '';\n    const serverName = ep.server_name \?\? label;\n    let title = label;\n    if \(serverName !== label\) title \+= ' · ' \+ serverName;\n    if \(epName\) title \+= ' - Tập ' \+ epName;/g,
  `const epName = ep.episode_name ?? '';
    const serverName = ep.server_name ?? label;
    let title = filmName || label;
    if (serverName !== label) title += ' · ' + serverName;
    
    const isFull = epName.toLowerCase() === 'full' || epName.toLowerCase() === 'tập full';
    if (!isFull && epName) {
      title += ' - Tập ' + epName;
    }`
);

// Update fetchStreamsCatalog call
content = content.replace(
  /const built = await buildStreams\(p.label, servers, poster, cache, ctx, workerOrigin\);/g,
  `const built = await buildStreams(p.label, servers, poster, cache, ctx, workerOrigin, film.info.name);`
);

// We need to revert the fetchStreamsById call to use `film.info.name || name` but wait, `film.info.name` might not be accessible safely if `film` is null, but we have `if (!film) return`. So `film` is guaranteed to be non-null.
// The replace above will update both fetchStreamsCatalog and fetchStreamsById which is fine.

// Update Motchill call
content = content.replace(
  /const motchillStreams = await buildStreams\('Motchill', motchillEps, null, cache, ctx, workerOrigin\);/g,
  `const motchillStreams = await buildStreams('Motchill', motchillEps, null, cache, ctx, workerOrigin, name);`
);

fs.writeFileSync('./src/handlers/stream.ts', content, 'utf8');
console.log("Done");
