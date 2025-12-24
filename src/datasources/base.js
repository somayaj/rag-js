/**
 * Base Data Source class
 * All data source implementations should extend this class
 */
export class BaseDataSource {
  constructor(config = {}) {
    this.config = config;
    this.initialized = false;
  }

  /**
   * Initialize the data source connection
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Load all documents from the data source
   * @returns {Promise<Array<{id: string, content: string, metadata: Object}>>}
   */
  async loadDocuments() {
    throw new Error('loadDocuments() must be implemented by subclass');
  }

  /**
   * Search documents by query (text-based)
   * @param {string} query - Search query
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array<{id: string, content: string, metadata: Object, score: number}>>}
   */
  async search(query, limit = 5) {
    throw new Error('search() must be implemented by subclass');
  }

  /**
   * Add a document to the data source
   * @param {Object} document - Document to add
   * @returns {Promise<string>} - Document ID
   */
  async addDocument(document) {
    throw new Error('addDocument() must be implemented by subclass');
  }

  /**
   * Close the data source connection
   * @returns {Promise<void>}
   */
  async close() {
    this.initialized = false;
  }

  /**
   * Get data source info
   * @returns {Object}
   */
  getInfo() {
    return {
      type: this.constructor.name,
      initialized: this.initialized,
      config: { ...this.config, apiKey: this.config.apiKey ? '***' : undefined }
    };
  }
}

