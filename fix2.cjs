const fs = require('fs');
let content = fs.readFileSync('./src/handlers/stream.ts', 'utf8');

content = content.replace(
  /const epName = ep.episode_name \?\? '';\n    const serverName = ep.server_name \?\? label;\n    let title = filmName \|\| label;\n    if \(serverName !== label\) title \+= ' · ' \+ serverName;\n    \n    const isFull = epName.toLowerCase\(\) === 'full' \|\| epName.toLowerCase\(\) === 'tập full';\n    if \(!isFull && epName\) \{\n      title \+= ' - Tập ' \+ epName;\n    \}/g,
  `const epName = ep.episode_name ?? '';
    let title = filmName || label;
    
    const isFull = epName.toLowerCase() === 'full' || epName.toLowerCase() === 'tập full';
    if (!isFull && epName) {
      title += ' - Tập ' + epName;
    }`
);

fs.writeFileSync('./src/handlers/stream.ts', content, 'utf8');
console.log("Done");
