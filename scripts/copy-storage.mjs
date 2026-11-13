import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const names = ['offerbiu.sqlite', 'offerbiu.sqlite-wal', 'offerbiu.sqlite-shm', '.encryption-key'];

export function copyStorage(from, to) {
  const source = path.resolve(from);
  const target = path.resolve(to);
  if (source === target) throw new Error('源目录和目标目录相同。');
  const database = path.join(source, 'offerbiu.sqlite');
  const key = path.join(source, '.encryption-key');
  if (!fs.existsSync(database) || !fs.statSync(database).isFile()) throw new Error('源目录没有 offerbiu.sqlite。');
  if (!fs.existsSync(key) || !fs.statSync(key).isFile()) throw new Error('源目录没有 .encryption-key。请与数据库一起复制，否则个人 API 密钥无法解密。');
  fs.mkdirSync(target, { recursive: true });
  if (fs.existsSync(path.join(target, 'offerbiu.sqlite'))) throw new Error('目标目录已有数据库。为避免覆盖，请换一个空目录。');
  const copied = [];
  for (const name of names) {
    const file = path.join(source, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const dest = path.join(target, name);
    fs.copyFileSync(file, dest);
    fs.chmodSync(dest, 0o600);
    copied.push(name);
  }
  return { source, target, copied };
}

function main() {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };
  const from = option('--from');
  const to = option('--to');
  if (!from || !to) {
    console.error('用法: node scripts/copy-storage.mjs --from <现有数据目录> --to <新目录>');
    console.error('只复制，不删除源目录。确认新目录可登录后，再设置 OFFERBIU_STORAGE 并重启。要还原，把 OFFERBIU_STORAGE 改回原目录。');
    process.exitCode = 1;
    return;
  }
  const result = copyStorage(from, to);
  console.log(JSON.stringify({
    ...result,
    next: `OFFERBIU_STORAGE=${result.target}`,
    revert: `停止服务后取消 OFFERBIU_STORAGE，或指回 ${result.source}`,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
