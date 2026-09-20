import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env', '.env.local']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const { handleRequest } = await import('./routes.mjs');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4174);
const server = http.createServer(handleRequest);
server.requestTimeout = 120000;
server.headersTimeout = 15000;
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请在 .env 修改 PORT。` : `服务启动失败：${error.code || error.name}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Offerbiu 已启动：http://${host}:${port}/`);
  console.log(`工作台：http://${host}:${port}/workspace/`);
  console.log('持久化数据库：storage/offerbiu.sqlite。按 Ctrl+C 停止。');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
