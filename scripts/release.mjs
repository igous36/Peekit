// 发版打包（2026-11-18，自动更新）：签名打包 + 生成 latest.json。
//
//   npm run release                         打包（带更新签名）并生成 latest.json
//   npm run release -- --skip-build         只重新生成 latest.json（已经打过包）
//   npm run release -- --notes notes.md     把更新说明写进 latest.json
//   npm run release -- --base-url URL       安装包的下载地址前缀（本地测试用；默认是 GitHub Release）
//
// 私钥：环境变量 TAURI_SIGNING_PRIVATE_KEY（路径或内容），没设就读 ~/.tauri/peekit-updater.key。
// 私钥丢了，已经装上的版本就再也收不到更新（公钥写在 tauri.conf.json 里），务必备份。
//
// 打完把这三个文件传到 GitHub Release：
//   src-tauri/target/release/bundle/nsis/Peekit_<版本>_x64-setup.exe
//   src-tauri/target/release/bundle/msi/Peekit_<版本>_x64_zh-CN.msi
//   src-tauri/target/release/bundle/latest.json
// 正式版读 releases/latest/download/latest.json，所以正式版要设成 Latest。
//
// 测试版更新通道（2026-11-21）：测试版（0.2.0-beta.2 这种版本号）打包时把更新地址换成
// releases/download/beta/latest.json（tag 叫 beta 的那个预发布 Release，只放一个 latest.json），查不到再退回正式版的地址。
// 所以每次发测试版、正式版，都要把 latest.json 也传一份到 beta 这个 Release（--clobber 覆盖），
// 装了测试版的人才能收到下一个测试版和正式版。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo = 'https://github.com/igous36/Peekit';
/** 更新地址：正式版（Latest 的 Release）、测试版通道（tag 叫 beta 的 Release） */
const STABLE_FEED = `${repo}/releases/latest/download/latest.json`;
const BETA_FEED = `${repo}/releases/download/beta/latest.json`;
const baseUrl = (opt('--base-url') ?? `${repo}/releases/download/v${version}`).replace(/\/$/, '');
const bundle = join(root, 'src-tauri', 'target', 'release', 'bundle');
const files = {
  nsis: join(bundle, 'nsis', `Peekit_${version}_x64-setup.exe`),
  msi: join(bundle, 'msi', `Peekit_${version}_x64_zh-CN.msi`),
};

if (!args.includes('--skip-build')) {
  const env = { ...process.env };
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    const keyPath = join(homedir(), '.tauri', 'peekit-updater.key');
    if (!existsSync(keyPath)) {
      console.error(`找不到更新签名私钥：没有设 TAURI_SIGNING_PRIVATE_KEY，${keyPath} 也不存在`);
      process.exit(1);
    }
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, 'utf8').trim();
  }
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
  env.CARGO_BUILD_JOBS ??= '4';
  const configs = ['--config', 'src-tauri/tauri.updater.conf.json'];
  // 测试版另给一份配置（--config 是合并进去的，没写的项照旧）：
  // - MSI 的版本号只能是数字（major.minor.patch.build）：取预发布号末尾的数字当第四段
  // - 更新地址先查测试版通道，查不到再查正式版
  const pre = /^(\d+\.\d+\.\d+)-(?:.*?)(\d+)?$/.exec(version);
  if (pre) {
    const preConf = join(root, 'src-tauri', 'target', 'prerelease.conf.json');
    mkdirSync(dirname(preConf), { recursive: true });
    const wixVersion = `${pre[1]}.${pre[2] ?? 0}`;
    writeFileSync(preConf, JSON.stringify({
      bundle: { windows: { wix: { version: wixVersion } } },
      plugins: { updater: { endpoints: [BETA_FEED, STABLE_FEED] } },
    }));
    configs.push('--config', preConf);
    console.log(`测试版：MSI 版本号用 ${wixVersion}，更新地址先查测试版通道`);
  }
  console.log(`打包 Peekit ${version}（带更新签名）…`);
  const r = spawnSync('npx', ['tauri', 'build', ...configs], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** 安装包旁边的 .sig（打包时生成） */
function signature(file) {
  const sig = `${file}.sig`;
  if (!existsSync(sig)) {
    console.error(`缺少签名文件 ${sig}：打包时没带私钥？`);
    process.exit(1);
  }
  return readFileSync(sig, 'utf8').trim();
}

const name = (file) => file.split(/[\\/]/).pop();
const nsis = { signature: signature(files.nsis), url: `${baseUrl}/${encodeURIComponent(name(files.nsis))}` };
const msi = { signature: signature(files.msi), url: `${baseUrl}/${encodeURIComponent(name(files.msi))}` };
const notesFile = opt('--notes');
const manifest = {
  version,
  notes: notesFile ? readFileSync(notesFile, 'utf8').trim() : '',
  pub_date: new Date().toISOString(),
  // 按安装方式选包：NSIS 装的用 exe，MSI 装的用 msi；只认 windows-x86_64 的旧版本走 exe
  platforms: {
    'windows-x86_64': nsis,
    'windows-x86_64-nsis': nsis,
    'windows-x86_64-msi': msi,
  },
};
const out = join(bundle, 'latest.json');
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`已生成 ${out}`);
console.log(`上传到 Release v${version}：\n  ${files.nsis}\n  ${files.msi}\n  ${out}`);
console.log(`再把 latest.json 传一份到测试版通道：gh release upload beta "${out}" --clobber`);
