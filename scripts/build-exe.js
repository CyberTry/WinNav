'use strict';

/**
 * 将 WinNav 打包为独立的 WinNav.exe（无需安装 Node.js）。
 *
 * 流程：
 * 1. esbuild 把 src/server.js 及全部依赖打包为单文件 dist/winnav.cjs
 * 2. node --experimental-sea-config 生成 preload blob
 * 3. 复制当前 node.exe 为 WinNav.exe，用 postject 注入 blob
 * 4. 产出 dist/winnav-portable/（WinNav.exe + public/ + .env.example）
 *
 * 运行：npm run build:exe
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function run(cmd, args) {
  console.log('> ' + cmd + ' ' + args.join(' '));
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/** 查找 Windows SDK 的 signtool（用于移除 node.exe 的 Authenticode 签名） */
function findSigntool() {
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (fs.existsSync(kits)) {
    const versions = fs.readdirSync(kits).sort().reverse();
    for (const ver of versions) {
      const p = path.join(kits, ver, 'x64', 'signtool.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function main() {
  fs.mkdirSync(dist, { recursive: true });
  const bundle = path.join(dist, 'winnav.cjs');
  const blob = path.join(dist, 'winnav.blob');
  const exe = path.join(dist, 'winnav-portable', 'WinNav.exe');

  // 1. esbuild 打包为单文件 CJS bundle（builtin 模块保留外部引用）
  run(process.execPath, [
    require.resolve('esbuild/bin/esbuild'),
    path.join(root, 'src', 'server.js'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--outfile=' + bundle
  ]);

  // 2. 生成 SEA preload blob
  run(process.execPath, ['--experimental-sea-config', path.join(root, 'sea-config.json')]);

  // 3. 复制 node.exe 并注入 blob
  const portable = path.join(dist, 'winnav-portable');
  fs.mkdirSync(portable, { recursive: true });
  fs.copyFileSync(process.execPath, exe);

  // 移除 node.exe 的 Authenticode 签名，否则 postject 无法改写 fuse 哨兵
  const signtool = findSigntool();
  if (signtool) {
    run(signtool, ['remove', '/s', exe]);
  } else {
    console.warn('警告：未找到 signtool，未签名 node.exe 上的注入可能失败');
  }

  // postject 哨兵 fuse 随 Node 版本变化（24.x 为 fce680ab...），从当前 node.exe 中动态探测
  const nodeBuf = fs.readFileSync(process.execPath);
  const marker = Buffer.from('NODE_SEA_FUSE_');
  const at = nodeBuf.indexOf(marker);
  if (at < 0) throw new Error('当前 node.exe 中未找到 SEA fuse 哨兵，无法打包');
  const fuse = nodeBuf.slice(at, at + marker.length + 32).toString('latin1');

  run(process.execPath, [
    require.resolve('postject/dist/cli.js'),
    exe,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    fuse
  ]);

  // 4. 携带静态资源与 .env 模板
  copyDir(path.join(root, 'public'), path.join(portable, 'public'));
  const envExample = path.join(root, '.env.example');
  if (fs.existsSync(envExample)) fs.copyFileSync(envExample, path.join(portable, '.env.example'));

  // 5. 携带已编译的启动器（先执行 scripts 中的 dotnet publish 或手动复制）
  const launcherPdb = path.join(portable, 'WinNavLauncher.pdb');
  if (fs.existsSync(launcherPdb)) fs.rmSync(launcherPdb);

  const size = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
  console.log('\n完成：dist/winnav-portable/WinNav.exe（' + size + ' MB）');
  console.log('将整个 winnav-portable 目录拷贝到任意 Windows 机器即可运行，无需安装 Node.js。');
}

main();
