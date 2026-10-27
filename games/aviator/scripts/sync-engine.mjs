// CRA cannot import from outside src/, so copy the shared engine in before start/build.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '../../../packages/crash-engine/src');
const to = join(here, '../src/engine');
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('synced crash-engine ->', to);
