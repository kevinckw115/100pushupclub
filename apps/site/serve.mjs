import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const types = { html: 'text/html', css: 'text/css', mjs: 'text/javascript', json: 'application/json' };
createServer(async (req, res) => {
  try {
    let path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') path = '/index.html';
    else if (/^\/(support|policies|delete-account)\/?$/.test(path)) path = path.replace(/\/$/, '') + '/index.html';
    if (!/^\/(index\.html|404\.html|style\.css|tokens\.css|config\.json|client\.mjs|deletion\.mjs|(support|policies|delete-account)\/index\.html)$/.test(path)) { res.writeHead(404); res.end('Not found'); return; }
    const data = await readFile(new URL('./dist' + path, import.meta.url));
    res.writeHead(200, { 'Content-Type': types[path.split('.').pop()], 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT ?? 8082), '127.0.0.1');
