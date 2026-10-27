// Runs the game server and the Vite dev client together; Ctrl+C stops both.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';

// A pull that adds a package needs `npm install` before anything can run.
const needed = ['@fungus/engine', '@fungus/protocol', '@fungus/server', '@fungus/client', 'tsx', 'vite', 'ws'];
const missing = needed.filter((m) => !existsSync(join(root, 'node_modules', m)));
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Run \`npm install\` first, then \`npm run dev\` again.`);
  process.exit(1);
}

const procs = [
  ['server', ['run', 'dev', '-w', '@fungus/server']],
  ['client', ['run', 'dev', '-w', '@fungus/client']],
].map(([name, args]) => {
  const p = spawn('npm', args, { cwd: root, stdio: 'inherit', shell: win });
  p.on('exit', (code) => {
    if (!stopping) console.log(`[${name}] exited${code ? ` with code ${code}` : ''}`);
    stop(code ?? 0);
  });
  return p;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    if (p.exitCode !== null || !p.pid) continue;
    // On Windows, killing npm leaves vite/tsx running underneath; take down the whole tree.
    if (win) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
