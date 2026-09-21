import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.css': 'text/css' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    let data;
    let extension = path.extname(file);
    try { data = await readFile(file); }
    catch { data = await readFile(path.join(root, 'index.html')); extension = '.html'; }
    res.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    res.end(data);
  } catch { res.writeHead(500).end(); }
}).listen(8081, '127.0.0.1', () => console.log('Browser preview: http://127.0.0.1:8081'));
