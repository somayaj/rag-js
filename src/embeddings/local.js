/**
 * Local Embeddings using TF-IDF
 * A simple, fast embedding solution that doesn't require external APIs
 */
export class LocalEmbeddings {
  constructor(config = {}) {
    this.dimension = config.dimension || 384;
    this.vocabulary = new Map();
    this.idf = new Map();
    this.documentCount = 0;
    this.initialized = false;
  }

  /**
   * Initialize embeddings (build vocabulary from documents)
   * @param {Array<string>} documents - Array of document texts
   */
  async initialize(documents = []) {
    if (documents.length > 0) {
      await this.buildVocabulary(documents);
    }
    this.initialized = true;
  }

  /**
   * Build vocabulary and IDF from documents
   * @param {Array<string>} documents - Array of document texts
   */
  async buildVocabulary(documents) {
    const docFreq = new Map();
    this.documentCount = documents.length;

    // Tokenize all documents and count document frequencies
    for (const doc of documents) {
      const tokens = this.tokenize(doc);
      const uniqueTokens = new Set(tokens);
      
      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
        
        if (!this.vocabulary.has(token)) {
          this.vocabulary.set(token, this.vocabulary.size);
        }
      }
    }

    // Calculate IDF for each term
    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((this.documentCount + 1) / (df + 1)) + 1);
    }
  }

  /**
   * Tokenize text into terms
   * @param {string} text - Input text
   * @returns {Array<string>} - Array of tokens
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1);
  }

  /**
   * Generate embedding for text
   * @param {string} text - Input text
   * @returns {Promise<Array<number>>} - Embedding vector
   */
  async embed(text) {
    const tokens = this.tokenize(text);
    const tf = new Map();

    // Calculate term frequency
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // Normalize TF
    const maxTf = Math.max(...tf.values(), 1);
    
    // Create sparse TF-IDF vector
    const sparse = new Map();
    for (const [term, freq] of tf) {
      const normalizedTf = freq / maxTf;
      const idfValue = this.idf.get(term) || Math.log(this.documentCount + 2);
      const tfidf = normalizedTf * idfValue;
      
      if (this.vocabulary.has(term)) {
        sparse.set(this.vocabulary.get(term), tfidf);
      }
    }

    // Convert to dense vector using hashing trick
    const vector = new Array(this.dimension).fill(0);
    
    for (const [term, freq] of tf) {
      const hash = this.hashString(term);
      const index = Math.abs(hash) % this.dimension;
      const sign = hash >= 0 ? 1 : -1;
      const idfValue = this.idf.get(term) || 1;
      vector[index] += sign * (freq / maxTf) * idfValue;
    }

    // L2 normalize
    return this.normalize(vector);
  }

  /**
   * Generate embeddings for multiple texts
   * @param {Array<string>} texts - Array of texts
   * @returns {Promise<Array<Array<number>>>} - Array of embedding vectors
   */
  async embedBatch(texts) {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  /**
   * Simple string hash function
   * @param {string} str - Input string
   * @returns {number} - Hash value
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * L2 normalize a vector
   * @param {Array<number>} vector - Input vector
   * @returns {Array<number>} - Normalized vector
   */
  normalize(vector) {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return vector;
    return vector.map(val => val / norm);
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {Array<number>} a - First vector
   * @param {Array<number>} b - Second vector
   * @returns {number} - Cosine similarity
   */
  cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimension');
    }
    
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }
    
    return dotProduct; // Vectors are already normalized
  }

  /**
   * Find most similar documents
   * @param {Array<number>} queryVector - Query embedding
   * @param {Array<{id: string, vector: Array<number>}>} documents - Documents with embeddings
   * @param {number} topK - Number of results
   * @returns {Array<{id: string, score: number}>} - Top similar documents
   */
  findSimilar(queryVector, documents, topK = 5) {
    const scores = documents.map(doc => ({
      id: doc.id,
      score: this.cosineSimilarity(queryVector, doc.vector)
    }));

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  getDimension() {
    return this.dimension;
  }

  getVocabularySize() {
    return this.vocabulary.size;
  }
}

