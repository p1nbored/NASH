// Repository root and the sha256 hex digest that bind Define review inputs.
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const hash = (value) => createHash('sha256').update(value).digest('hex');
