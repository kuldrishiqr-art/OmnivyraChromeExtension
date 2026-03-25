/**
 * STATE MANAGER - Minimal, standalone state and storage
 * 
 * No external dependencies. Direct Chrome Storage API wrapper.
 * Shared between service worker and content scripts via messaging.
 */

class StateManager {
  constructor() {
    this.cache = {};
    this.initialized = false;
  }

  /**
   * Initialize state (load from storage)
   */
  async init() {
    try {
      const data = await chrome.storage.local.get(null);
      this.cache = data || {};
      this.initialized = true;
      console.log('[StateManager] Initialized with', Object.keys(this.cache).length, 'keys');
    } catch (error) {
      console.error('[StateManager] Init failed:', error);
      this.initialized = false;
    }
  }

  /**
   * Get value from state
   */
  get(key, defaultValue = null) {
    return this.cache[key] !== undefined ? this.cache[key] : defaultValue;
  }

  /**
   * Set value in state and persist
   */
  async set(key, value) {
    this.cache[key] = value;
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (error) {
      console.error('[StateManager] Set failed for key:', key, error);
      throw error;
    }
  }

  /**
   * Get all state as object
   */
  getAll() {
    return { ...this.cache };
  }

  /**
   * Clear all state
   */
  async clear() {
    try {
      await chrome.storage.local.clear();
      this.cache = {};
    } catch (error) {
      console.error('[StateManager] Clear failed:', error);
      throw error;
    }
  }

  /**
   * Remove specific key
   */
  async remove(key) {
    delete this.cache[key];
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      console.error('[StateManager] Remove failed for key:', key, error);
      throw error;
    }
  }

  /**
   * Get token (encrypted at rest in future)
   */
  async getToken() {
    return this.get('sessionToken', null);
  }

  /**
   * Set token
   */
  async setToken(token) {
    await this.set('sessionToken', token);
  }

  /**
   * Get queued events
   */
  async getQueuedEvents() {
    const queue = this.get('eventQueue', []);
    return Array.isArray(queue) ? queue : [];
  }

  /**
   * Add event to queue
   */
  async queueEvent(event) {
    const queue = await this.getQueuedEvents();
    queue.push({
      ...event,
      id: `${Date.now()}_${Math.random()}`,
      queuedAt: Date.now()
    });
    await this.set('eventQueue', queue);
    return queue;
  }

  /**
   * Remove events from queue
   */
  async removeQueuedEvents(eventIds) {
    const queue = await this.getQueuedEvents();
    const filtered = queue.filter(e => !eventIds.includes(e.id));
    await this.set('eventQueue', filtered);
    return filtered;
  }

  /**
   * Get sync status
   */
  async getSyncStatus() {
    return this.get('lastSyncStatus', {
      lastSync: null,
      nextSync: null,
      inProgress: false,
      lastError: null
    });
  }

  /**
   * Set sync status
   */
  async setSyncStatus(status) {
    await this.set('lastSyncStatus', {
      ...await this.getSyncStatus(),
      ...status,
      updatedAt: Date.now()
    });
  }

  /**
   * Get all events (for inspection)
   */
  async getAllEvents() {
    return {
      queued: await this.getQueuedEvents(),
      syncStatus: await this.getSyncStatus(),
      token: this.get('sessionToken', null) ? '***' : null
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof window !== 'undefined') {
  window.StateManager = StateManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StateManager;
}
