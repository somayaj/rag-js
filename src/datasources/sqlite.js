import { BaseDataSource } from './base.js';

/**
 * SQLite Data Source
 * Connects to SQLite database for RAG queries
 */
export class SQLiteDataSource extends BaseDataSource {
  constructor(config = {}) {
    super(config);
    this.dbPath = config.dbPath || ':memory:';
    this.tableName = config.tableName || 'documents';
    this.contentColumn = config.contentColumn || 'content';
    this.idColumn = config.idColumn || 'id';
    this.db = null;
    this.documents = [];
  }

  async initialize() {
    // Dynamic import for better-sqlite3 (optional dependency)
    try {
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);
      
      // Create documents table if it doesn't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          ${this.idColumn} TEXT PRIMARY KEY,
          ${this.contentColumn} TEXT NOT NULL,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create FTS5 virtual table for full-text search
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_fts USING fts5(
          ${this.contentColumn},
          content='${this.tableName}',
          content_rowid='rowid'
        )
      `);
      
      await this.loadDocuments();
      this.initialized = true;
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('better-sqlite3 is required for SQLite data source. Install it with: npm install better-sqlite3');
      }
      throw error;
    }
  }

  async loadDocuments() {
    const rows = this.db.prepare(`SELECT * FROM ${this.tableName}`).all();
    
    this.documents = rows.map(row => ({
      id: String(row[this.idColumn]),
      content: row[this.contentColumn],
      metadata: row.metadata ? JSON.parse(row.metadata) : {}
    }));
    
    return this.documents;
  }

  async search(query, limit = 5) {
    // Use FTS5 for full-text search
    try {
      const stmt = this.db.prepare(`
        SELECT 
          d.${this.idColumn} as id,
          d.${this.contentColumn} as content,
          d.metadata,
          bm25(${this.tableName}_fts) as score
        FROM ${this.tableName}_fts fts
        JOIN ${this.tableName} d ON fts.rowid = d.rowid
        WHERE ${this.tableName}_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `);
      
      const rows = stmt.all(query, limit);
      
      return rows.map(row => ({
        id: String(row.id),
        content: row.content,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        score: Math.abs(row.score) // BM25 returns negative scores
      }));
    } catch (error) {
      // Fallback to LIKE search if FTS fails
      const stmt = this.db.prepare(`
        SELECT 
          ${this.idColumn} as id,
          ${this.contentColumn} as content,
          metadata
        FROM ${this.tableName}
        WHERE ${this.contentColumn} LIKE ?
        LIMIT ?
      `);
      
      const rows = stmt.all(`%${query}%`, limit);
      
      return rows.map((row, index) => ({
        id: String(row.id),
        content: row.content,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        score: 1 / (index + 1)
      }));
    }
  }

  async addDocument(document) {
    const id = document.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (${this.idColumn}, ${this.contentColumn}, metadata)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(id, document.content, JSON.stringify(document.metadata || {}));
    
    // Update FTS index
    const ftsStmt = this.db.prepare(`
      INSERT INTO ${this.tableName}_fts(rowid, ${this.contentColumn})
      SELECT rowid, ${this.contentColumn} FROM ${this.tableName} WHERE ${this.idColumn} = ?
    `);
    
    try {
      ftsStmt.run(id);
    } catch (e) {
      // FTS might fail if already exists, ignore
    }
    
    this.documents.push({
      id,
      content: document.content,
      metadata: document.metadata || {}
    });
    
    return id;
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    await super.close();
  }

  getDocuments() {
    return this.documents;
  }

  getDocumentCount() {
    return this.documents.length;
  }

  /**
   * Execute raw SQL query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Array} - Query results
   */
  query(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }
}

