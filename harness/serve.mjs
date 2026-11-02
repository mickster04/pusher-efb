// Tiny static server for the mock harness. No dependencies. Serves the project root on 127.0.0.1:8765.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT) || 8765;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.writeHead(302, { location: '/harness/index.html' }).end(); return; }
  const rel = normalize(decodeURIComponent(url.pathname));
  const file = join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403).end('no'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log('harness at http://127.0.0.1:' + port + '/'));
