const fs = require('fs');
let content = fs.readFileSync('./src/handlers/stream.ts', 'utf8');

// We will replace the inner logic of the buildStreams loop
content = content.replace(
  /const epName = ep.episode_name \?\? '';\n    let title = filmName \|\| label;\n    \n    const isFull = epName.toLowerCase\(\) === 'full' \|\| epName.toLowerCase\(\) === 'tập full';\n    if \(!isFull && epName\) \{\n      title \+= ' - Tập ' \+ epName;\n    \}\n\n    const stream: any = \{\n      name: title1,\n      title,\n    \};/g,
  `const epName = ep.episode_name ?? '';
    const serverName = ep.server_name ?? label;

    let finalName = filmName || label;
    const isFull = epName.toLowerCase() === 'full' || epName.toLowerCase() === 'tập full';
    if (!isFull && epName) {
      finalName += ' - Tập ' + epName;
    }

    let finalTitle = label;
    if (serverName !== label) {
      finalTitle += ' · ' + serverName;
    }

    const stream: any = {
      name: finalName,
      title: finalTitle,
    };`
);

fs.writeFileSync('./src/handlers/stream.ts', content, 'utf8');
console.log("Done");
