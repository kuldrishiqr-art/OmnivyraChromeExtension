/**
 * API CLIENT - Standalone, no external dependencies
 * 
 * Handles all HTTP communication with backend API.
 * Used only by service worker.
 */

class APIClient {
  constructor(baseURL = 'https://api.omnivyra.io') {
    this.baseURL = baseURL;
    this.timeout = 30000; // 30 seconds
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second base delay
  }

  /**
   * Make HTTP request with built-in retry
   */
  async request(method, endpoint, data = null, headers = {}) {
    let lastError;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await this._request(method, endpoint, data, headers);
      } catch (error) {
        lastError = error;
        
        // Don't retry if it's a 4xx error (client error)
        if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        // Exponential backoff
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Single request attempt
   */
  async _request(method, endpoint, data = null, headers = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    // Add abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    options.signal = controller.signal;

    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          statusCode: response.status,
          message: errorData.message || response.statusText,
          data: errorData
        };
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }

      throw error;
    }
  }

  /**
   * Send queued events to backend
   */
  async sendEvents(events, token) {
    if (!events || events.length === 0) {
      return { success: true, synced: 0 };
    }

    try {
      const result = await this.request('POST', '/events/batch', {
        events: events.map(e => ({
          ...e,
          timestamp: e.timestamp || Date.now()
        })),
        clientId: 'omnivyra-extension',
        batchId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }, {
        'Authorization': `Bearer ${token}`
      });

      return {
        success: true,
        synced: result.synced || events.length,
        confirmationId: result.id
      };
    } catch (error) {
      console.error('[APIClient] Send events failed:', error);
      return {
        success: false,
        error: error.message,
        synced: 0
      };
    }
  }

  /**
   * Fetch commands from backend
   */
  async getCommands(token) {
    try {
      const result = await this.request('GET', '/commands/pending', null, {
        'Authorization': `Bearer ${token}`
      });

      return {
        success: true,
        commands: result.commands || [],
        ackId: result.id
      };
    } catch (error) {
      console.error('[APIClient] Get commands failed:', error);
      return {
        success: false,
        error: error.message,
        commands: []
      };
    }
  }

  /**
   * Validate session token
   */
  async validateToken(token) {
    try {
      const result = await this.request('POST', '/auth/validate', {}, {
        'Authorization': `Bearer ${token}`
      });

      return {
        success: true,
        valid: result.valid !== false,
        expiresAt: result.expiresAt
      };
    } catch (error) {
      console.error('[APIClient] Token validation failed:', error);
      return {
        success: false,
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Health check / ping
   */
  async ping() {
    try {
      const result = await this.request('GET', '/health', null);
      return { success: true, status: result.status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof window !== 'undefined') {
  window.APIClient = APIClient;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = APIClient;
}
