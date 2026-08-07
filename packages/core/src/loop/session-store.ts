import { Session } from '../types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SessionStore {
  save(session: Session): Promise<void>;
  load(id: string): Promise<Session | null>;
  list(limit?: number): Promise<Session[]>;
  delete(id: string): Promise<void>;
}

export function createSessionStore(basePath: string): SessionStore {
  let initialized = false;

  function ensureDir(): void {
    if (!initialized) {
      fs.mkdirSync(basePath, { recursive: true });
      initialized = true;
    }
  }

  return {
    async save(session) {
      ensureDir();
      const filePath = path.join(basePath, `${session.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    },
    async load(id) {
      ensureDir();
      const filePath = path.join(basePath, `${id}.json`);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    },
    async list(limit = 50) {
      ensureDir();
      const files = fs.readdirSync(basePath)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(basePath, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
        .slice(0, limit);
      return files.map(f => JSON.parse(fs.readFileSync(f, 'utf-8')));
    },
    async delete(id) {
      ensureDir();
      const filePath = path.join(basePath, `${id}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    },
  };
}