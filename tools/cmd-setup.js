#!/usr/bin/env node
// Finishes the Sencha Cmd install without npm lifecycle scripts.
//
// Why: Sencha's npm packages run install scripts that spawn "npm.cmd" without a shell. Node.js 18.20.2+,
// 20.12.2+ and 22+ refuse that on Windows (spawn EINVAL, a security fix), so a plain "npm install" fails.
// This project sets ignore-scripts=true in .npmrc and does the one step that matters here instead:
// download the platform-specific Sencha Cmd binaries into node_modules/@sencha/cmd/dist.
// (The skipped "activate" scripts only try to register a trial licence and are not needed to build.)
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cmdHome = path.join(root, 'node_modules', '@sencha', 'cmd');

function isReady() {
  return fs.existsSync(path.join(cmdHome, 'dist', 'sencha.jar')) || fs.existsSync(path.join(cmdHome, 'dist', 'sencha')) || fs.existsSync(path.join(cmdHome, 'dist', 'sencha.exe'));
}

function hasJavaOnPath() {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['java'], { encoding: 'utf8', shell: process.platform === 'win32' });
  return r.status === 0;
}

/** Same package choice as Sencha's own platform-install.js. */
function platformPackage() {
  const pkg = require(path.join(cmdHome, 'package.json'));
  const platform = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform] || process.platform;
  const x64 = process.arch === 'x64' || process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
  let name = `@sencha/cmd-${platform}`;
  if (platform === 'windows') {
    name += `-${x64 ? '64' : '32'}-jre`; // self-contained installer; the build itself still uses Java 8-14 (see tools/sencha.js)
  } else if (!hasJavaOnPath()) {
    if (platform === 'linux') { throw new Error('Sencha Cmd on Linux needs Java on the PATH. Install a JDK 11 first.'); }
    name += '-jre';
  } else if (platform === 'linux') {
    name += `-${x64 ? '64' : '32'}`;
  }
  return { name, version: pkg.version };
}

/** Runs npm without spawning npm.cmd directly (works on every Node/Windows combination). */
function npm(args, cwd) {
  const cli = process.env.npm_execpath;
  const r = cli && /\.c?js$/.test(cli)
    ? spawnSync(process.execPath, [cli].concat(args), { cwd, stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { throw new Error('npm ' + args.join(' ') + ' failed'); }
}

function ensureSenchaCmd() {
  if (!fs.existsSync(cmdHome)) {
    throw new Error('node_modules/@sencha/cmd is missing. Run "npm install" first.');
  }
  if (isReady()) { return; }
  const { name, version } = platformPackage();
  console.log(`[setup] Installing ${name}@${version} (Sencha Cmd binaries, about 100-190 MB, one time only)...`);
  // Runs inside node_modules/@sencha/cmd, so the project's .npmrc does not apply: pass the registry explicitly.
  npm(['install', `${name}@${version}`, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock',
    '--@sencha:registry=https://registry.npmjs.org/'], cmdHome);
  const installer = path.join(cmdHome, 'node_modules', name, 'install.js');
  if (fs.existsSync(installer)) {
    require(installer)(cmdHome);
  }
  if (!isReady()) {
    throw new Error('Sencha Cmd binaries were not installed into ' + path.join(cmdHome, 'dist'));
  }
  console.log('[setup] Sencha Cmd is ready.');
}

module.exports = { ensureSenchaCmd };

if (require.main === module) {
  try { ensureSenchaCmd(); } catch (e) { console.error('[setup] ' + e.message); process.exit(1); }
}
