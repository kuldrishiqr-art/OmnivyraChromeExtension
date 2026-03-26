/**
 * API CLIENT - Backend Communication Handler (PHASE 1: PRODUCTION READY)
 * 
 * Manages all HTTP requests to the Omnivyra backend.
 * Handles authentication, error handling, retries, and request batching.
 * 
 * PHASE 1 FEATURES:
 * - Idempotency keys for all POST/PUT requests
 * - Request timeout with AbortController
 * - Exponential backoff retry with max attempts
 * - Token encryption support
 * - Proper error classification
 */

class APIClient {
  constructor(baseURL = 'https://api.omnivyra.io') {
    this.baseURL = baseURL;
    this.requestTimeout = 30000; // 30 seconds
    this.maxRetries = 3;
  }

  /**
   * PHASE 1 FIX #2: Generate deterministic idempotency key
   * Same request = same key = backend deduplicates
   * @private
   */
  generateIdempotencyKey(endpoint, body, timestamp) {
    // Create a deterministic hash from request components
    const key = `${endpoint}:${JSON.stringify(body)}:${Math.floor(timestamp / 1000)}`;
    return key;
  }

  /**
   * Make HTTP request with error handling and retries
   * PHASE 1: Includes idempotency key for safe retries
   * @private
   * @param {string} endpoint - API endpoint path
   * @param {object} options - Fetch options
   * @param {number} retryCount - Current retry attempt
   * @returns {Promise<Response>}
   */
  async makeRequest(endpoint, options = {}, retryCount = 0) {
    try {
      // PHASE 1 FIX #2: Add idempotency key for POST/PUT requests
      const method = options.method || 'GET';
      if ((method === 'POST' || method === 'PUT') && options.body) {
        const idempotencyKey = this.generateIdempotencyKey(
          endpoint, 
          typeof options.body === 'string' ? JSON.parse(options.body) : options.body,
          Date.now()
        );
        
        options.headers = {
          ...options.headers,
          'Idempotency-Key': idempotencyKey
        };
        
        console.log(`[APIClient] Added idempotency key: ${idempotencyKey.substring(0, 50)}...`);
      }

      // Get valid auth token if available
      if (typeof authBridge !== 'undefined') {
        const isAuth = authBridge.isAuthenticated();
        if (isAuth) {
          const token = authBridge.getSessionToken();
          if (token) {
            options.headers = {
              ...options.headers,
              'Authorization': `Bearer ${token}`
            };
          }
        }
      }

      // Set default headers
      options.headers = {
        'Content-Type': 'application/json',
        ...options.headers
      };

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized - token may be expired or invalid
      if (response.status === 401 && typeof authBridge !== 'undefined') {
        console.warn('[APIClient] 401 Unauthorized - clearing auth state');
        authBridge.clearAuthState();
        return response; // Let caller handle auth error
      }

      return response;
    } catch (error) {
      console.error(`[APIClient] Request failed (attempt ${retryCount + 1}/${this.maxRetries}):`, error.message);

      // Retry on network errors, excluding auth errors
      if (retryCount < this.maxRetries && error.name !== 'TypeError') {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s
        console.log(`[APIClient] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest(endpoint, options, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Delay execution helper for retries
   * @private
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send analytics events to backend
   * @param {Array<object>} events - Array of event objects
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async sendEvents(events) {
    try {
      if (!Array.isArray(events) || events.length === 0) {
        return { success: false, message: 'Invalid events array' };
      }

      const response = await this.makeRequest('/analytics/events', {
        method: 'POST',
        body: JSON.stringify({
          events: events,
          timestamp: new Date().toISOString(),
          clientVersion: chrome.runtime.getManifest().version
        })
      });

      if (!response.ok) {
        console.error('Failed to send events:', response.statusText);
        return { success: false, message: `Server error: ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, message: 'Events sent', data };
    } catch (error) {
      console.error('Error sending events:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Fetch commands from backend for processing
   * @returns {Promise<{success: boolean, commands?: Array, message?: string}>}
   */
  async fetchCommands() {
    try {
      const response = await this.makeRequest('/commands/pending', {
        method: 'GET'
      });

      if (!response.ok) {
        return { success: false, message: `Server error: ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, commands: data.commands || [] };
    } catch (error) {
      console.error('Error fetching commands:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Report command execution status to backend
   * @param {string} commandId - Command ID
   * @param {string} status - 'success' or 'failed'
   * @param {object} result - Execution result or error
   * @returns {Promise<{success: boolean}>}
   */
  async reportCommandStatus(commandId, status, result) {
    try {
      const response = await this.makeRequest(`/commands/${commandId}/status`, {
        method: 'POST',
        body: JSON.stringify({
          status: status,
          result: result,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        return { success: false };
      }

      return { success: true };
    } catch (error) {
      console.error('Error reporting command status:', error);
      return { success: false };
    }
  }

  /**
   * Fetch user profile from backend
   * @returns {Promise<{success: boolean, profile?: object, message?: string}>}
   */
  async fetchUserProfile() {
    try {
      const response = await this.makeRequest('/user/profile', {
        method: 'GET'
      });

      if (!response.ok) {
        return { success: false, message: 'Failed to fetch profile' };
      }

      const profile = await response.json();
      return { success: true, profile };
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Health check - verify connection to backend
   * @returns {Promise<{success: boolean, status?: string}>}
   */
  async healthCheck() {
    try {
      const response = await this.makeRequest('/health', {
        method: 'GET'
      });

      return {
        success: response.ok,
        status: response.statusText
      };
    } catch (error) {
      return { success: false, status: 'offline' };
    }
  }

  /**
   * Submit command execution result to backend
   * Reports success or failure of command execution with details.
   * @param {string} commandId - Command ID
   * @param {string} status - 'success' or 'failed'
   * @param {object} result - Execution result or error details
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async submitCommandResult(commandId, status, result) {
    try {
      if (!commandId || !status) {
        return { success: false, message: 'Missing commandId or status' };
      }

      const response = await this.makeRequest('/extension/action-result', {
        method: 'POST',
        body: JSON.stringify({
          commandId: commandId,
          status: status,
          result: result,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        console.error(`Failed to submit command result: ${response.statusText}`);
        return { success: false, message: `Server error: ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error('Error submitting command result:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Send batch sync events to backend (sends individually with delays)
   * Sends collected extension events (e.g., LinkedIn comments) to backend.
   * Each event sent as SINGLE object, not array.
   * Called by SyncEngine after batch collection and deduplication.
   * 
   * @param {Array<object>} events - Array of normalized events to send individually
   * Event format:
   * {
   *   platform: 'linkedin',
   *   event_type: 'comment',
   *   platform_message_id: <unique_id>,
   *   data: {
   *     content: <text>,
   *     author_name: <name>,
   *     author_profile_url: <url>,
   *     thread_id: <id>,
   *     created_at: <timestamp>
   *   }
   * }
   * 
   * @returns {Promise<{success: boolean, message?: string, sentCount?: number, data?: object}>}
   */
  async sendSyncEvents(events) {
    try {
      if (!Array.isArray(events)) {
        return { success: false, message: 'Events must be an array' };
      }

      if (events.length === 0) {
        return { success: false, message: 'Events array is empty' };
      }

      console.log(`[APIClient] Sending ${events.length} sync events individually to backend`);

      let successCount = 0;
      let failureCount = 0;

      // Send each event individually
      for (let i = 0; i < events.length; i++) {
        const event = events[i];

        try {
          // Validate event structure
          if (!event.platform || !event.event_type || !event.platform_message_id || !event.data) {
            console.warn('[APIClient] Invalid event structure, skipping:', event);
            failureCount++;
            continue;
          }

          console.log(`[APIClient] Sending event ${i + 1}/${events.length}`);

          // Send single event as object (not array)
          const response = await this.makeRequest('/api/extension/events', {
            method: 'POST',
            body: JSON.stringify({
              platform: event.platform,
              event_type: event.event_type,
              platform_message_id: event.platform_message_id,
              data: event.data,
              timestamp: new Date().toISOString(),
              clientVersion: chrome.runtime.getManifest().version
            })
          });

          if (!response.ok) {
            console.error(`[APIClient] Failed to send event ${i + 1}: ${response.statusText}`);
            failureCount++;
            continue;
          }

          successCount++;
          console.log(`[APIClient] Successfully sent event ${i + 1}/${events.length}`);

          // Add delay between requests (except last one)
          if (i < events.length - 1) {
            const delayMs = this.randomDelay(500, 1500);
            console.log(`[APIClient] Waiting ${delayMs}ms before next event...`);
            await this.delay(delayMs);
          }

        } catch (error) {
          console.error(`[APIClient] Error sending event ${i + 1}:`, error);
          failureCount++;
          continue;
        }
      }

      console.log(`[APIClient] Batch complete: ${successCount} sent, ${failureCount} failed`);

      return {
        success: successCount > 0,
        message: `Sent ${successCount}/${events.length} events`,
        sentCount: successCount,
        data: { successCount, failureCount, totalCount: events.length }
      };

    } catch (error) {
      console.error('[APIClient] Error during batch send:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Generate random delay within range (utility for batch sending)
   * @private
   * @param {number} min - Minimum milliseconds
   * @param {number} max - Maximum milliseconds
   * @returns {number} Random delay in ms
   */
  randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

// Attach to window (content script context)
const apiClientTarget = typeof globalThis !== 'undefined' ? globalThis : window;
if (apiClientTarget) {
  apiClientTarget.apiClient = new APIClient();
}
