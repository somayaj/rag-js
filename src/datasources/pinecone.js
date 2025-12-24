import { BaseDataSource } from './base.js';

/**
 * Pinecone Data Source
 * Connects to Pinecone vector database for RAG queries
 */
export class PineconeDataSource extends BaseDataSource {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey;
    this.indexName = config.indexName;
    this.namespace = config.namespace || '';
    this.dimension = config.dimension || 384;
    this.client = null;
    this.index = null;
    this.documents = new Map(); // Local cache of documents
  }

  async initialize() {
    if (!this.apiKey) {
      throw new Error('Pinecone API key is required');
    }

    if (!this.indexName) {
      throw new Error('Pinecone index name is required');
    }

    try {
      const { Pinecone } = await import('@pinecone-database/pinecone');
      
      this.client = new Pinecone({
        apiKey: this.apiKey
      });

      this.index = this.client.index(this.indexName);
      
      // Verify connection by describing index
      const description = await this.client.describeIndex(this.indexName);
      this.dimension = description.dimension || this.dimension;
      
      this.initialized = true;
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('@pinecone-database/pinecone is required. Install it with: npm install @pinecone-database/pinecone');
      }
      throw error;
    }
  }

  async loadDocuments() {
    // Pinecone doesn't support listing all vectors efficiently
    // Documents should be loaded from another source and indexed
    return Array.from(this.documents.values());
  }

  /**
   * Search using vector similarity
   * Note: This requires embeddings to be generated externally
   * @param {Array<number>} vector - Query vector
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} - Search results
   */
  async searchByVector(vector, limit = 5) {
    const queryResponse = await this.index.namespace(this.namespace).query({
      vector,
      topK: limit,
      includeMetadata: true
    });

    return queryResponse.matches.map(match => ({
      id: match.id,
      content: match.metadata?.content || '',
      metadata: match.metadata || {},
      score: match.score
    }));
  }

  /**
   * Text-based search (requires embedding function to be set)
   * @param {string} query - Search query
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} - Search results
   */
  async search(query, limit = 5) {
    // If embedding function is available, use it
    if (this.embeddingFunction) {
      const vector = await this.embeddingFunction(query);
      return this.searchByVector(vector, limit);
    }

    // Fallback: search local cache
    const queryLower = query.toLowerCase();
    const results = [];
    
    for (const [id, doc] of this.documents) {
      if (doc.content.toLowerCase().includes(queryLower)) {
        results.push({ ...doc, id, score: 1 });
      }
    }
    
    return results.slice(0, limit);
  }

  /**
   * Add a document with its vector embedding
   * @param {Object} document - Document with content and metadata
   * @param {Array<number>} vector - Vector embedding
   * @returns {Promise<string>} - Document ID
   */
  async addDocumentWithVector(document, vector) {
    const id = document.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.index.namespace(this.namespace).upsert([{
      id,
      values: vector,
      metadata: {
        content: document.content,
        ...document.metadata
      }
    }]);

    this.documents.set(id, {
      content: document.content,
      metadata: document.metadata || {}
    });

    return id;
  }

  /**
   * Add a document (requires embedding function to be set)
   * @param {Object} document - Document to add
   * @returns {Promise<string>} - Document ID
   */
  async addDocument(document) {
    if (!this.embeddingFunction) {
      throw new Error('Embedding function must be set to add documents. Use addDocumentWithVector() or setEmbeddingFunction()');
    }

    const vector = await this.embeddingFunction(document.content);
    return this.addDocumentWithVector(document, vector);
  }

  /**
   * Set the embedding function for text-to-vector conversion
   * @param {Function} fn - Async function that converts text to vector
   */
  setEmbeddingFunction(fn) {
    this.embeddingFunction = fn;
  }

  /**
   * Delete vectors by IDs
   * @param {Array<string>} ids - Vector IDs to delete
   */
  async deleteDocuments(ids) {
    await this.index.namespace(this.namespace).deleteMany(ids);
    ids.forEach(id => this.documents.delete(id));
  }

  /**
   * Delete all vectors in namespace
   */
  async deleteAll() {
    await this.index.namespace(this.namespace).deleteAll();
    this.documents.clear();
  }

  async close() {
    this.client = null;
    this.index = null;
    await super.close();
  }

  getDocuments() {
    return Array.from(this.documents.entries()).map(([id, doc]) => ({
      id,
      ...doc
    }));
  }

  getDocumentCount() {
    return this.documents.size;
  }

  /**
   * Get index statistics
   * @returns {Promise<Object>} - Index stats
   */
  async getStats() {
    return await this.index.describeIndexStats();
  }
}

