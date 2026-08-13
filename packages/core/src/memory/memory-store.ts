import { MemoryEntry } from '../types.js';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs';

export interface MemoryStore {
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<MemoryEntry>;
  search(projectPath: string, query: string, options?: { type?: string; limit?: number }): Promise<MemoryEntry[]>;
  list(projectPath: string): Promise<MemoryEntry[]>;
  delete(projectPath: string, id: string): Promise<void>;
  getByType(projectPath: string, type: MemoryEntry['type']): Promise<MemoryEntry[]>;
}

export async function createMemoryStore(dbPath: string): Promise<MemoryStore> {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  let db: SqlJsDatabase;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Try to enable WAL mode (sql.js may not support this, but it won't hurt)
  try { db.run('PRAGMA journal_mode = WAL'); } catch { /* not supported in sql.js */ }

  // Create schema
  db.run(`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    project_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_path)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(project_path, type)');

  // Persist after schema creation
  saveDb();

  function saveDb(): void {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }

  function queryAll(sql: string, params: any[] = []): any[] {
    const stmt = db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  function rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      type: row.type as MemoryEntry['type'],
      content: row.content,
      source: row.source,
      projectPath: row.project_path,
      createdAt: new Date(row.created_at),
      lastAccessedAt: new Date(row.last_accessed_at),
    };
  }

  const add = ((entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<MemoryEntry> => {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.run(
      'INSERT INTO memories (id, type, content, source, project_path, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, entry.type, entry.content, entry.source, entry.projectPath, now, now]
    );
    saveDb();
    return Promise.resolve({
      id,
      ...entry,
      createdAt: new Date(now),
      lastAccessedAt: new Date(now),
    });
  }) as MemoryStore['add'];

  const search = ((projectPath: string, query: string, options?: { type?: string; limit?: number }): Promise<MemoryEntry[]> => {
    const limit = options?.limit ?? 10;
    let sql = 'SELECT * FROM memories WHERE project_path = ? AND content LIKE ?';
    const params: any[] = [projectPath, `%${query}%`];

    if (options?.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    sql += ' ORDER BY last_accessed_at DESC LIMIT ?';
    params.push(limit);

    const rows = queryAll(sql, params);

    // Update last_accessed_at for all returned rows
    if (rows.length > 0) {
      const now = new Date().toISOString();
      for (const row of rows) {
        db.run('UPDATE memories SET last_accessed_at = ? WHERE id = ?', [now, row.id]);
        row.last_accessed_at = now;
      }
      saveDb();
    }

    return Promise.resolve(rows.map(rowToEntry));
  }) as MemoryStore['search'];

  const list = ((projectPath: string): Promise<MemoryEntry[]> => {
    const rows = queryAll(
      'SELECT * FROM memories WHERE project_path = ? ORDER BY last_accessed_at DESC',
      [projectPath]
    );
    return Promise.resolve(rows.map(rowToEntry));
  }) as MemoryStore['list'];

  const _delete = ((projectPath: string, id: string): Promise<void> => {
    db.run('DELETE FROM memories WHERE id = ? AND project_path = ?', [id, projectPath]);
    saveDb();
    return Promise.resolve();
  }) as MemoryStore['delete'];

  const getByType = ((projectPath: string, type: MemoryEntry['type']): Promise<MemoryEntry[]> => {
    const rows = queryAll(
      'SELECT * FROM memories WHERE project_path = ? AND type = ? ORDER BY last_accessed_at DESC',
      [projectPath, type]
    );
    return Promise.resolve(rows.map(rowToEntry));
  }) as MemoryStore['getByType'];

  return { add, search, list, delete: _delete, getByType };
}
