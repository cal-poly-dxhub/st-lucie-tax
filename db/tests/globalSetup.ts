import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function globalSetup() {
  const resetScript = resolve(__dirname, '..', 'reset.sh');
  execSync(`bash ${resetScript}`, { stdio: 'inherit' });
}
