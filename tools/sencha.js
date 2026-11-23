#!/usr/bin/env node
// Runs Sencha Cmd (from node_modules) inside web/ with a compatible Java.
// Sencha Cmd 7.2 needs Java 8-14: it uses the Nashorn JavaScript engine, which Java 15+ removed.
// Usage: node tools/sencha.js app build production
'use strict';
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cmdBin = path.join(root, 'node_modules', '@sencha', 'cmd', 'bin', 'sencha');
const isWin = process.platform === 'win32';

if (!fs.existsSync(cmdBin)) {
  console.error('Sencha Cmd is not installed. Run "npm install" in the project folder first.');
  process.exit(1);
}
try {
  require('./cmd-setup').ensureSenchaCmd(); // one-time download of the platform binaries (see cmd-setup.js)
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

function javaMajor(javaExe) {
  const r = spawnSync(javaExe, ['-version'], { encoding: 'utf8' });
  if (r.error) return null;
  const m = /version "(\d+)(?:\.(\d+))?/.exec((r.stderr || '') + (r.stdout || ''));
  if (!m) return null;
  const major = Number(m[1]);
  return major === 1 ? Number(m[2]) : major; // "1.8.0_x" -> 8
}

function candidates() {
  const list = [];
  const add = home => { if (home) list.push(home); };
  add(process.env.GT_JAVA_HOME);
  add(process.env.JAVA_HOME);
  const dirs = isWin
    ? ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java', 'C:\\Program Files\\Zulu', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Amazon Corretto', 'C:\\Program Files\\AdoptOpenJDK']
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', '/opt/java'];
  dirs.forEach(d => {
    try { fs.readdirSync(d).forEach(n => { const h = path.join(d, n); add(fs.existsSync(path.join(h, 'Contents', 'Home')) ? path.join(h, 'Contents', 'Home') : h); }); } catch (e) { /* missing */ }
  });
  return list;
}

let javaHome = null;
for (const home of candidates()) {
  const exe = path.join(home, 'bin', isWin ? 'java.exe' : 'java');
  if (!fs.existsSync(exe)) continue;
  const major = javaMajor(exe);
  if (major && major >= 8 && major <= 14) { javaHome = home; break; }
}

const env = Object.assign({}, process.env);
if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = path.join(javaHome, 'bin') + path.delimiter + env.PATH;
  console.log(`Using Java at ${javaHome}`);
} else {
  const sys = javaMajor('java');
  if (!(sys && sys >= 8 && sys <= 14)) {
    console.error([
      '',
      `Sencha Cmd 7.2 needs Java 8, 11 or 14 (found: ${sys ? 'Java ' + sys : 'no Java'}).`,
      'Install the free Eclipse Temurin JDK 11 (https://adoptium.net/temurin/releases/?version=11),',
      'then run this command again. If it is installed in an unusual folder, set GT_JAVA_HOME to that folder.',
      ''
    ].join('\n'));
    process.exit(1);
  }
}

const child = spawn(process.execPath, [cmdBin].concat(process.argv.slice(2)), { cwd: path.join(root, 'web'), env, stdio: 'inherit' });
child.on('exit', code => process.exit(code || 0));
