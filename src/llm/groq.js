import Groq from 'groq-sdk';

/**
 * Groq LLM Integration
 * Uses Groq's fast inference API for language model queries
 */
export class GroqLLM {
  constructor(config = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'llama-3.3-70b-versatile';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens || 2048;
    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
    this.client = null;
  }

  /**
   * Initialize the Groq client
   */
  async initialize() {
    if (!this.apiKey) {
      throw new Error('Groq API key is required');
    }

    this.client = new Groq({ apiKey: this.apiKey });
  }

  /**
   * Get default system prompt for RAG
   * @returns {string} - Default system prompt
   */
  getDefaultSystemPrompt() {
    return `You are a helpful AI assistant that answers questions based on the provided context.

Instructions:
- Answer questions accurately based ONLY on the context provided
- If the context doesn't contain enough information to answer, say so clearly
- Be concise but thorough in your responses
- If asked about something not in the context, acknowledge the limitation
- Cite specific parts of the context when relevant
- Format your response clearly with proper structure when appropriate`;
  }

  /**
   * Set custom system prompt
   * @param {string} prompt - System prompt
   */
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  /**
   * Generate a response based on query and context
   * @param {string} query - User's question
   * @param {Array<{content: string, metadata: Object}>} context - Retrieved context documents
   * @param {Object} options - Additional options
   * @returns {Promise<string>} - Generated response
   */
  async generateResponse(query, context = [], options = {}) {
    if (!this.client) {
      await this.initialize();
    }

    // Format context into a string
    const contextStr = context.map((doc, i) => {
      const source = doc.metadata?.source || `Document ${i + 1}`;
      return `[${source}]\n${doc.content}`;
    }).join('\n\n---\n\n');

    const userMessage = contextStr 
      ? `Context:\n${contextStr}\n\nQuestion: ${query}`
      : `Question: ${query}`;

    const messages = [
      { role: 'system', content: options.systemPrompt || this.systemPrompt },
      { role: 'user', content: userMessage }
    ];

    // Add conversation history if provided
    if (options.history && Array.isArray(options.history)) {
      messages.splice(1, 0, ...options.history);
    }

    const completion = await this.client.chat.completions.create({
      model: options.model || this.model,
      messages,
      temperature: options.temperature ?? this.temperature,
      max_tokens: options.maxTokens || this.maxTokens,
      stream: false
    });

    return completion.choices[0]?.message?.content || '';
  }

  /**
   * Generate a streaming response
   * @param {string} query - User's question
   * @param {Array} context - Retrieved context documents
   * @param {Object} options - Additional options
   * @returns {AsyncGenerator<string>} - Stream of response chunks
   */
  async *generateStreamingResponse(query, context = [], options = {}) {
    if (!this.client) {
      await this.initialize();
    }

    const contextStr = context.map((doc, i) => {
      const source = doc.metadata?.source || `Document ${i + 1}`;
      return `[${source}]\n${doc.content}`;
    }).join('\n\n---\n\n');

    const userMessage = contextStr 
      ? `Context:\n${contextStr}\n\nQuestion: ${query}`
      : `Question: ${query}`;

    const messages = [
      { role: 'system', content: options.systemPrompt || this.systemPrompt },
      { role: 'user', content: userMessage }
    ];

    const stream = await this.client.chat.completions.create({
      model: options.model || this.model,
      messages,
      temperature: options.temperature ?? this.temperature,
      max_tokens: options.maxTokens || this.maxTokens,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Simple completion without RAG context
   * @param {string} prompt - Prompt text
   * @param {Object} options - Additional options
   * @returns {Promise<string>} - Generated response
   */
  async complete(prompt, options = {}) {
    if (!this.client) {
      await this.initialize();
    }

    const completion = await this.client.chat.completions.create({
      model: options.model || this.model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: options.temperature ?? this.temperature,
      max_tokens: options.maxTokens || this.maxTokens
    });

    return completion.choices[0]?.message?.content || '';
  }

  /**
   * List available models
   * @returns {Promise<Array>} - List of models
   */
  async listModels() {
    if (!this.client) {
      await this.initialize();
    }

    const models = await this.client.models.list();
    return models.data;
  }

  /**
   * Get model info
   * @returns {Object} - Model configuration
   */
  getConfig() {
    return {
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens
    };
  }

  /**
   * Update configuration
   * @param {Object} config - New configuration
   */
  updateConfig(config) {
    if (config.model) this.model = config.model;
    if (config.temperature !== undefined) this.temperature = config.temperature;
    if (config.maxTokens) this.maxTokens = config.maxTokens;
    if (config.systemPrompt) this.systemPrompt = config.systemPrompt;
  }
}

