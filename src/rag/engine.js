/**
 * RAG Engine
 * Orchestrates the retrieval-augmented generation pipeline
 */
export class RAGEngine {
  constructor(config = {}) {
    this.dataSource = config.dataSource;
    this.llm = config.llm;
    this.embeddings = config.embeddings;
    this.topK = config.topK || 5;
    this.similarityThreshold = config.similarityThreshold || 0.3;
    this.documentVectors = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the RAG engine
   */
  async initialize() {
    if (!this.dataSource) {
      throw new Error('Data source is required');
    }

    if (!this.llm) {
      throw new Error('LLM is required');
    }

    // Initialize data source
    if (!this.dataSource.initialized) {
      await this.dataSource.initialize();
    }

    // Initialize LLM
    await this.llm.initialize();

    // Initialize embeddings and build index
    if (this.embeddings) {
      const documents = this.dataSource.getDocuments();
      const texts = documents.map(d => d.content);
      
      await this.embeddings.initialize(texts);
      
      // Generate embeddings for all documents
      await this.buildVectorIndex();
    }

    this.initialized = true;
  }

  /**
   * Build vector index for all documents
   */
  async buildVectorIndex() {
    const documents = this.dataSource.getDocuments();
    
    for (const doc of documents) {
      const vector = await this.embeddings.embed(doc.content);
      this.documentVectors.set(doc.id, {
        ...doc,
        vector
      });
    }
  }

  /**
   * Add a document to the index
   * @param {Object} document - Document to add
   * @returns {Promise<string>} - Document ID
   */
  async addDocument(document) {
    const id = await this.dataSource.addDocument(document);
    
    if (this.embeddings) {
      const vector = await this.embeddings.embed(document.content);
      this.documentVectors.set(id, {
        id,
        content: document.content,
        metadata: document.metadata || {},
        vector
      });
    }
    
    return id;
  }

  /**
   * Retrieve relevant documents for a query
   * @param {string} query - Search query
   * @param {number} topK - Number of documents to retrieve
   * @returns {Promise<Array>} - Retrieved documents with scores
   */
  async retrieve(query, topK = this.topK) {
    // Use vector similarity if embeddings are available
    if (this.embeddings && this.documentVectors.size > 0) {
      return this.retrieveByVector(query, topK);
    }
    
    // Fallback to data source's search
    return this.dataSource.search(query, topK);
  }

  /**
   * Retrieve documents using vector similarity
   * @param {string} query - Search query
   * @param {number} topK - Number of documents to retrieve
   * @returns {Promise<Array>} - Retrieved documents with scores
   */
  async retrieveByVector(query, topK) {
    const queryVector = await this.embeddings.embed(query);
    
    const documents = Array.from(this.documentVectors.values());
    const similarities = this.embeddings.findSimilar(
      queryVector,
      documents,
      topK * 2 // Get more candidates for filtering
    );

    // Filter by threshold and limit
    const results = [];
    for (const { id, score } of similarities) {
      if (score >= this.similarityThreshold && results.length < topK) {
        const doc = this.documentVectors.get(id);
        results.push({
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata,
          score
        });
      }
    }

    // If no results pass threshold, return top results anyway
    if (results.length === 0 && similarities.length > 0) {
      for (const { id, score } of similarities.slice(0, topK)) {
        const doc = this.documentVectors.get(id);
        results.push({
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata,
          score
        });
      }
    }

    return results;
  }

  /**
   * Query the RAG system
   * @param {string} query - User's question
   * @param {Object} options - Query options
   * @returns {Promise<Object>} - Response with answer and sources
   */
  async query(query, options = {}) {
    if (!this.initialized) {
      throw new Error('RAG engine not initialized. Call initialize() first.');
    }

    const topK = options.topK || this.topK;
    
    // Retrieve relevant documents
    const retrievedDocs = await this.retrieve(query, topK);

    // Generate response
    const answer = await this.llm.generateResponse(query, retrievedDocs, {
      history: options.history,
      systemPrompt: options.systemPrompt,
      temperature: options.temperature
    });

    return {
      answer,
      sources: retrievedDocs.map(doc => ({
        id: doc.id,
        content: doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
        metadata: doc.metadata,
        score: doc.score
      })),
      query
    };
  }

  /**
   * Query with streaming response
   * @param {string} query - User's question
   * @param {Object} options - Query options
   * @returns {AsyncGenerator} - Stream of response chunks
   */
  async *queryStream(query, options = {}) {
    if (!this.initialized) {
      throw new Error('RAG engine not initialized. Call initialize() first.');
    }

    const topK = options.topK || this.topK;
    
    // Retrieve relevant documents
    const retrievedDocs = await this.retrieve(query, topK);

    // Yield sources first
    yield {
      type: 'sources',
      sources: retrievedDocs.map(doc => ({
        id: doc.id,
        content: doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
        metadata: doc.metadata,
        score: doc.score
      }))
    };

    // Stream response
    const stream = this.llm.generateStreamingResponse(query, retrievedDocs, options);
    
    for await (const chunk of stream) {
      yield { type: 'content', content: chunk };
    }

    yield { type: 'done' };
  }

  /**
   * Get engine statistics
   * @returns {Object} - Engine stats
   */
  getStats() {
    return {
      initialized: this.initialized,
      documentCount: this.documentVectors.size || this.dataSource?.getDocumentCount() || 0,
      topK: this.topK,
      similarityThreshold: this.similarityThreshold,
      dataSourceType: this.dataSource?.constructor.name,
      llmModel: this.llm?.model,
      embeddingDimension: this.embeddings?.getDimension()
    };
  }

  /**
   * Update configuration
   * @param {Object} config - New configuration
   */
  updateConfig(config) {
    if (config.topK) this.topK = config.topK;
    if (config.similarityThreshold !== undefined) {
      this.similarityThreshold = config.similarityThreshold;
    }
  }

  /**
   * Refresh the index (reload documents from data source)
   */
  async refresh() {
    await this.dataSource.loadDocuments();
    
    if (this.embeddings) {
      const documents = this.dataSource.getDocuments();
      const texts = documents.map(d => d.content);
      await this.embeddings.buildVocabulary(texts);
      await this.buildVectorIndex();
    }
  }

  /**
   * Close all connections
   */
  async close() {
    if (this.dataSource) {
      await this.dataSource.close();
    }
    this.initialized = false;
  }
}

