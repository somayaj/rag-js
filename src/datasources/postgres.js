import { BaseDataSource } from './base.js';

/**
 * PostgreSQL Data Source
 * Connects to PostgreSQL database for RAG queries
 */
export class PostgresDataSource extends BaseDataSource {
  constructor(config = {}) {
    super(config);
    this.host = config.host || 'localhost';
    this.port = config.port || 5432;
    this.user = config.user || 'postgres';
    this.password = config.password;
    this.database = config.database;
    this.tableName = config.tableName || 'documents';
    this.contentColumn = config.contentColumn || 'content';
    this.idColumn = config.idColumn || 'id';
    this.pool = null;
    this.documents = [];
  }

  async initialize() {
    try {
      const pg = await import('pg');
      const { Pool } = pg.default || pg;
      
      this.pool = new Pool({
        host: this.host,
        port: this.port,
        user: this.user,
        password: this.password,
        database: this.database
      });

      // Test connection
      await this.pool.query('SELECT NOW()');

      // Create documents table if it doesn't exist
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          ${this.idColumn} TEXT PRIMARY KEY,
          ${this.contentColumn} TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create GIN index for full-text search
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS ${this.tableName}_content_idx 
        ON ${this.tableName} USING GIN (to_tsvector('english', ${this.contentColumn}))
      `);

      await this.loadDocuments();
      this.initialized = true;
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('pg is required for PostgreSQL data source. Install it with: npm install pg');
      }
      throw error;
    }
  }

  async loadDocuments() {
    const result = await this.pool.query(`SELECT * FROM ${this.tableName}`);
    
    this.documents = result.rows.map(row => ({
      id: String(row[this.idColumn]),
      content: row[this.contentColumn],
      metadata: row.metadata || {}
    }));
    
    return this.documents;
  }

  async search(query, limit = 5) {
    // Use PostgreSQL full-text search with ranking
    const result = await this.pool.query(`
      SELECT 
        ${this.idColumn} as id,
        ${this.contentColumn} as content,
        metadata,
        ts_rank(to_tsvector('english', ${this.contentColumn}), plainto_tsquery('english', $1)) as score
      FROM ${this.tableName}
      WHERE to_tsvector('english', ${this.contentColumn}) @@ plainto_tsquery('english', $1)
      ORDER BY score DESC
      LIMIT $2
    `, [query, limit]);

    if (result.rows.length === 0) {
      // Fallback to ILIKE search
      const fallbackResult = await this.pool.query(`
        SELECT 
          ${this.idColumn} as id,
          ${this.contentColumn} as content,
          metadata
        FROM ${this.tableName}
        WHERE ${this.contentColumn} ILIKE $1
        LIMIT $2
      `, [`%${query}%`, limit]);

      return fallbackResult.rows.map((row, index) => ({
        id: String(row.id),
        content: row.content,
        metadata: row.metadata || {},
        score: 1 / (index + 1)
      }));
    }

    return result.rows.map(row => ({
      id: String(row.id),
      content: row.content,
      metadata: row.metadata || {},
      score: parseFloat(row.score)
    }));
  }

  async addDocument(document) {
    const id = document.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.pool.query(`
      INSERT INTO ${this.tableName} (${this.idColumn}, ${this.contentColumn}, metadata)
      VALUES ($1, $2, $3)
      ON CONFLICT (${this.idColumn}) DO UPDATE SET
        ${this.contentColumn} = EXCLUDED.${this.contentColumn},
        metadata = EXCLUDED.metadata
    `, [id, document.content, JSON.stringify(document.metadata || {})]);

    this.documents.push({
      id,
      content: document.content,
      metadata: document.metadata || {}
    });

    return id;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
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
   * @returns {Object} - Query result
   */
  async query(sql, params = []) {
    return await this.pool.query(sql, params);
  }
}

