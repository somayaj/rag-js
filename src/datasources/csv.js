import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { BaseDataSource } from './base.js';

/**
 * CSV Data Source
 * Loads and indexes CSV files for RAG queries
 */
export class CSVDataSource extends BaseDataSource {
  constructor(config = {}) {
    super(config);
    this.filePath = config.filePath;
    this.contentColumn = config.contentColumn || null; // Column to use as main content
    this.idColumn = config.idColumn || null; // Column to use as document ID
    this.delimiter = config.delimiter || ',';
    this.documents = [];
  }

  async initialize() {
    if (!this.filePath) {
      throw new Error('CSV file path is required');
    }

    if (!existsSync(this.filePath)) {
      throw new Error(`CSV file not found: ${this.filePath}`);
    }

    await this.loadDocuments();
    this.initialized = true;
  }

  async loadDocuments() {
    const fileContent = await readFile(this.filePath, 'utf-8');
    
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      delimiter: this.delimiter,
      trim: true
    });

    this.documents = records.map((record, index) => {
      // Determine document ID
      const id = this.idColumn && record[this.idColumn] 
        ? String(record[this.idColumn]) 
        : `doc_${index}`;

      // Determine content - either specific column or all columns combined
      let content;
      if (this.contentColumn && record[this.contentColumn]) {
        content = record[this.contentColumn];
      } else {
        // Combine all columns into content
        content = Object.entries(record)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');
      }

      return {
        id,
        content,
        metadata: { ...record, source: this.filePath, rowIndex: index }
      };
    });

    return this.documents;
  }

  async search(query, limit = 5) {
    // Simple text-based search (will be enhanced by RAG engine with embeddings)
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/);

    const scored = this.documents.map(doc => {
      const contentLower = doc.content.toLowerCase();
      
      // Calculate simple relevance score
      let score = 0;
      
      // Exact phrase match
      if (contentLower.includes(queryLower)) {
        score += 10;
      }
      
      // Individual term matches
      for (const term of queryTerms) {
        if (term.length > 2) {
          const regex = new RegExp(term, 'gi');
          const matches = contentLower.match(regex);
          if (matches) {
            score += matches.length;
          }
        }
      }

      return { ...doc, score };
    });

    return scored
      .filter(doc => doc.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async addDocument(document) {
    const id = document.id || `doc_${this.documents.length}`;
    const newDoc = {
      id,
      content: document.content,
      metadata: { ...document.metadata, source: this.filePath }
    };
    
    this.documents.push(newDoc);
    
    // Optionally persist to CSV
    if (this.config.autoPersist) {
      await this.persistToCSV();
    }
    
    return id;
  }

  async persistToCSV() {
    if (!this.documents.length) return;
    
    // Get all unique keys from metadata
    const allKeys = new Set();
    this.documents.forEach(doc => {
      Object.keys(doc.metadata).forEach(key => {
        if (key !== 'source' && key !== 'rowIndex') {
          allKeys.add(key);
        }
      });
    });
    
    const headers = Array.from(allKeys);
    const rows = [headers.join(this.delimiter)];
    
    for (const doc of this.documents) {
      const row = headers.map(h => {
        const val = doc.metadata[h] || '';
        // Escape quotes and wrap in quotes if contains delimiter
        if (String(val).includes(this.delimiter) || String(val).includes('"')) {
          return `"${String(val).replace(/"/g, '""')}"`;
        }
        return val;
      });
      rows.push(row.join(this.delimiter));
    }
    
    await writeFile(this.filePath, rows.join('\n'), 'utf-8');
  }

  getDocuments() {
    return this.documents;
  }

  getDocumentCount() {
    return this.documents.length;
  }
}

