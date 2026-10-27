// Runs the game server and the Vite dev client together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  ['server', ['run', 'dev', '-w', '@fungus/server']],
  ['client', ['run', 'dev', '-w', '@fungus/client']],
].map(([name, args]) => {
  const p = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => {
    console.log(`[${name}] exited${code ? ` with code ${code}` : ''}`);
    stop(code ?? 0);
  });
  return p;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
