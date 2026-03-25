/**
 * MESSAGING PROTOCOL - Shared across service worker and content scripts
 * 
 * Provides reliable message passing with:
 * - Request/Response correlation
 * - Timeout handling
 * - Error recovery
 * - Type safety
 */

// ============================================================================
// MESSAGE TYPES & VALIDATION
// ============================================================================

const MESSAGE_ACTIONS = {
  // Content Script → Service Worker
  'QUEUE_EVENT': 'Add event to sync queue',
  'GET_AUTH_STATE': 'Get current auth state',
  'REPORT_ERROR': 'Report error from content script',
  'PAGE_STATE': 'Notify of page state change',
  
  // Service Worker → Content Script
  'EXECUTE_COMMAND': 'Execute a backend command',
  'UPDATE_CONFIG': 'Update configuration',
  'SYNC_STATUS': 'Broadcast sync status',
  
  // Bi-directional
  'PING': 'Health check',
  'PONG': 'Health check response'
};

// ============================================================================
// MESSENGER - Core messaging class
// ============================================================================

class Messenger {
  constructor(isServiceWorker = false) {
    this.isServiceWorker = isServiceWorker;
    this.pendingRequests = new Map(); // correlation ID → resolver
    this.requestTimeout = 30000; // 30 seconds
    this.nextMessageId = 1;
    
    this.setupListener();
  }

  /**
   * Set up chrome.runtime.onMessage listener
   */
  setupListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleIncomingMessage(message, sender, sendResponse);
      return true; // Keep channel open for async response
    });
  }

  /**
   * Handle incoming message
   */
  async handleIncomingMessage(message, sender, sendResponse) {
    const { id, action, payload, isResponse, error } = message;

    // Validate message structure
    if (!action || !id) {
      console.error('[Messenger] Invalid message structure:', message);
      sendResponse({ success: false, error: 'Invalid message' });
      return;
    }

    // If this is a response to a pending request, resolve it
    if (isResponse) {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(payload);
        }
      }
      return;
    }

    // Otherwise, it's a new request - handle it
    try {
      const handler = this.getHandler(action);
      if (!handler) {
        throw new Error(`Unknown action: ${action}`);
      }

      const result = await handler(payload, sender);
      sendResponse({ success: true, payload: result, id });
    } catch (err) {
      console.error(`[Messenger] Error handling ${action}:`, err);
      sendResponse({ 
        success: false, 
        error: err.message, 
        id 
      });
    }
  }

  /**
   * Send a message and wait for response
   */
  async send(action, payload = {}) {
    if (!MESSAGE_ACTIONS[action]) {
      throw new Error(`Invalid action: ${action}`);
    }

    const id = this.nextMessageId++;
    const message = {
      id,
      action,
      payload,
      isResponse: false
    };

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Message timeout after ${this.requestTimeout}ms for action: ${action}`));
      }, this.requestTimeout);

      // Register pending request
      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      // Send message
      if (this.isServiceWorker) {
        // Service worker → all content scripts
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {
              // Tab might not have content script loaded
            });
          });
        });
      } else {
        // Content script → service worker
        chrome.runtime.sendMessage(message).catch((err) => {
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to send message: ${err.message}`));
        });
      }
    });
  }

  /**
   * Register handler for an action
   */
  registerHandler(action, handler) {
    if (!this.handlers) {
      this.handlers = {};
    }
    this.handlers[action] = handler;
  }

  /**
   * Get handler for action
   */
  getHandler(action) {
    if (!this.handlers) {
      return null;
    }
    return this.handlers[action];
  }

  /**
   * Send response to a message
   */
  sendResponse(response, sendResponse) {
    sendResponse(response);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof window !== 'undefined') {
  window.Messenger = Messenger;
  window.MESSAGE_ACTIONS = MESSAGE_ACTIONS;
}

// For potential ES6 usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Messenger, MESSAGE_ACTIONS };
}
