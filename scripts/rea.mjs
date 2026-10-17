#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] ?? 'inspect';
const args = process.argv.slice(3);
const supported = version => {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return (major === 22 && minor >= 19) || (major === 24 && minor >= 11) || major >= 26;
};
function findNode() {
  if (supported(process.version)) return process.execPath;
  const candidates = [join(root, '.tools/node/bin/node')];
  const nvm = join(homedir(), '.nvm/versions/node');
  if (existsSync(nvm)) candidates.push(...readdirSync(nvm).filter(supported).sort().reverse().map(v => join(nvm, v, 'bin/node')));
  candidates.push('/opt/homebrew/opt/node@22/bin/node', '/usr/local/opt/node@22/bin/node');
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const result = spawnSync(path, ['--version'], { encoding: 'utf8' });
    if (result.status === 0 && supported(result.stdout.trim())) return path;
  }
  throw new Error('REA requires Node 22.19+, 24.11+, or 26+. Run nvm use in this project.');
}

const env = { ...process.env };
const tools = join(root, '.tools');
if (existsSync(tools)) {
  const entries = readdirSync(tools);
  const ghidra = entries.find(name => /^ghidra_12\.1\.4.*PUBLIC$/.test(name));
  const jdk = entries.find(name => /^jdk-21/.test(name) && existsSync(join(tools, name, 'Contents/Home/bin/javac')));
  if (!env.GHIDRA_INSTALL_DIR && ghidra) env.GHIDRA_INSTALL_DIR = join(tools, ghidra);
  if (jdk) env.JAVA_HOME = join(tools, jdk, 'Contents/Home');
}
env.REA_GHIDRA_STARTUP_TIMEOUT_MS ??= '600000';
const target = resolve(root, args[0] ?? 'references/original/game/DinoIsland.exe');
let cliArgs;
switch (command) {
  case 'doctor': cliArgs = ['doctor', '--provider', 'ghidra', '--format', 'json']; break;
  case 'inspect': cliArgs = ['inspect-artifact', target, '--format', 'json']; break;
  case 'analyze': cliArgs = ['analyze', target, '--provider', 'ghidra', '--format', 'json']; break;
  case 'search': {
    const pattern = args[0] ?? '.mesh';
    const searchTarget = resolve(root, args[1] ?? 'references/original/game/DinoIsland.exe');
    cliArgs = ['search', searchTarget, pattern, '--provider', 'ghidra', '--format', 'json'];
    break;
  }
  case 'decompile': {
    if (!args[0]) throw new Error('Usage: node scripts/rea.mjs decompile <address> [target]');
    cliArgs = ['decompile', resolve(root, args[1] ?? 'references/original/game/DinoIsland.exe'), args[0], '--provider', 'ghidra', '--format', 'json'];
    break;
  }
  default: cliArgs = [command, ...args];
}

const output = spawnSync(findNode(), [join(root, 'node_modules/rea-agents/scripts/rea.mjs'), ...cliArgs], {
  cwd: root,
  env,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: 660000,
});
const outputDirectory = join(root, 'research/raw');
mkdirSync(outputDirectory, { recursive: true });
const filename = `${command.replace(/[^a-z-]/gi, '')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(join(outputDirectory, filename), output.stdout || JSON.stringify({ error: output.error?.message, stderr: output.stderr, status: output.status }, null, 2));
if (output.stdout) process.stdout.write(output.stdout);
if (output.stderr) process.stderr.write(output.stderr);
if (output.error) console.error(output.error.message);
process.exitCode = output.status ?? 1;
