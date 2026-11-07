import http from 'node:http';
import { createReadStream, realpathSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { handleApi, isLoopback } from './server/api.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const publicURL = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN) : null;
const web = realpathSync(fileURLToPath(new URL('./web/', import.meta.url)));
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 需要是有效的端口号。');
if (publicURL && (publicURL.protocol !== 'https:' || publicURL.origin !== process.env.PUBLIC_ORIGIN.replace(/\/$/, ''))) {
  throw new Error('PUBLIC_ORIGIN 需要填写对外的 HTTPS 地址，例如 https://chat.example.cn。');
}
if (!isLoopback(host) && !publicURL) throw new Error('对外监听前，请设置 PUBLIC_ORIGIN 并通过 HTTPS 反向代理提供服务。');
if (process.env.FAMILY_ACCESS_CODE &&
    (process.env.FAMILY_ACCESS_CODE.length < 12 || process.env.FAMILY_ACCESS_CODE.length > 512)) {
  throw new Error('FAMILY_ACCESS_CODE 的长度需在 12 到 512 个字符之间。');
}
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const security = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'microphone=(self), camera=(self), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
};

function fail(res, status, msg) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...security });
  res.end(msg);
}

async function staticFile(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return fail(res, 405, '只支持读取页面。');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return fail(res, 400, '地址无效。'); }
  if (pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('\\') || pathname.includes('\0')) {
    return fail(res, 404, '找不到页面。');
  }
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  try {
    const file = await realpath(path.join(web, relative));
    if (!file.startsWith(web + path.sep)) return fail(res, 404, '找不到页面。');
    const info = await stat(file);
    if (!info.isFile()) return fail(res, 404, '找不到页面。');
    res.writeHead(200, {
      ...security, 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(file), res);
  } catch {
    if (!res.headersSent) fail(res, 404, '找不到页面。');
  }
}

export async function serve(req, res) {
  try {
    if (!req.url.startsWith('/') || req.url.startsWith('//') || !req.headers.host) return fail(res, 400, '地址无效。');
    const hostURL = new URL('http://' + req.headers.host);
    const local = !publicURL && isLoopback(hostURL.hostname) && isLoopback(host) &&
      isLoopback((req.socket.remoteAddress || '').replace(/^::ffff:/, ''));
    if (publicURL ? hostURL.host !== publicURL.host : !local) return fail(res, 403, '请使用知伴的访问地址。');
    const url = new URL(req.url, publicURL || hostURL);
    if (url.origin !== (publicURL || hostURL).origin) return fail(res, 400, '地址无效。');
    if (!url.pathname.startsWith('/api/')) return await staticFile(req, res, url);

    const abort = new AbortController();
    res.once('close', () => { if (!res.writableEnded) abort.abort(); });
    const init = { method: req.method, headers: req.headers, signal: abort.signal };
    if (!['GET', 'HEAD'].includes(req.method)) {
      init.body = Readable.toWeb(req);
      init.duplex = 'half';
    }
    const result = await handleApi(new Request(url, init), process.env, { localAccess: local });
    if (res.destroyed) return;
    res.writeHead(result.status, { ...security, ...Object.fromEntries(result.headers) });
    if (result.body) await pipeline(Readable.fromWeb(result.body), res);
    else res.end();
  } catch {
    if (!res.headersSent && !res.destroyed) fail(res, 400, '请求没有送达，请重新打开知伴。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = http.createServer(serve);
  server.requestTimeout = 75_000;
  server.headersTimeout = 20_000;
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '端口已被占用，请检查已经打开的知伴，或通过 PORT 更换端口。' : '服务启动失败，请检查端口及监听地址。');
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const hostname = host.includes(':') ? '[' + host + ']' : host;
    console.log('知伴已启动：' + (publicURL?.origin || 'http://' + hostname + ':' + server.address().port));
  });
}
