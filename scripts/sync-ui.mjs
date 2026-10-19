import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'ui');
const files = (await readdir(source)).filter(file => !file.endsWith('.md'));
for (const service of ['joke-service', 'submit-service', 'moderate-service']) {
  const destination = path.join(root, service, 'public');
  await mkdir(destination, { recursive: true });
  for (const file of files) await copyFile(path.join(source, file), path.join(destination, file));
}
console.log(`Synced ${files.length} shared UI assets to all three services.`);
