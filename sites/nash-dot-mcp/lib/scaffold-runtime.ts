import { env } from 'cloudflare:workers';
import { createScaffoldStorage } from './scaffold-storage';

export function scaffoldStorage() {
  if (!env.DB) throw new Error('Local scaffold D1 binding unavailable');
  return createScaffoldStorage(env.DB);
}
