/**
 * STORAGE MANAGER - Extension Data Persistence Layer
 * 
 * Manages all local and sync storage operations using Chrome Storage API.
 * Provides abstraction for auth state, user preferences, and cached data.
 */

class StorageManager {
  constructor() {
    this.storageType = 'local'; // 'local' or 'sync'
    this.cacheExpiry = 3600000; // 1 hour in ms
    this.cache = new Map();
  }

  /**
   * Set a value in storage
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   * @param {string} type - 'local' or 'sync'
   * @returns {Promise<void>}
   */
  async set(key, value, type = 'local') {
    try {
      const storage = type === 'sync' ? chrome.storage.sync : chrome.storage.local;
      await storage.set({ [key]: value });

      // Update in-memory cache
      this.cache.set(key, {
        value: value,
        expiry: Date.now() + this.cacheExpiry
      });

      console.log(`[Storage] Set ${key} in ${type} storage`);
    } catch (error) {
      console.error(`Failed to set ${key} in ${type} storage:`, error);
      throw error;
    }
  }

  /**
   * Get a value from storage
   * @param {string} key - Storage key
   * @param {string} type - 'local' or 'sync'
   * @returns {Promise<*>}
   */
  async get(key, type = 'local') {
    try {
      // Check in-memory cache first
      const cached = this.cache.get(key);
      if (cached && Date.now() < cached.expiry) {
        return cached.value;
      }

      const storage = type === 'sync' ? chrome.storage.sync : chrome.storage.local;
      const result = await storage.get(key);

      if (result[key] !== undefined) {
        // Update cache
        this.cache.set(key, {
          value: result[key],
          expiry: Date.now() + this.cacheExpiry
        });

        return result[key];
      }

      return null;
    } catch (error) {
      console.error(`Failed to get ${key} from ${type} storage:`, error);
      return null;
    }
  }

  /**
   * Get multiple values
   * @param {string[]} keys - Array of storage keys
   * @param {string} type - 'local' or 'sync'
   * @returns {Promise<object>}
   */
  async getMultiple(keys, type = 'local') {
    try {
      const storage = type === 'sync' ? chrome.storage.sync : chrome.storage.local;
      return await storage.get(keys);
    } catch (error) {
      console.error('Failed to get multiple values:', error);
      return {};
    }
  }

  /**
   * Remove a value from storage
   * @param {string} key - Storage key
   * @param {string} type - 'local' or 'sync'
   * @returns {Promise<void>}
   */
  async remove(key, type = 'local') {
    try {
      const storage = type === 'sync' ? chrome.storage.sync : chrome.storage.local;
      await storage.remove(key);

      // Remove from cache
      this.cache.delete(key);

      console.log(`[Storage] Removed ${key} from ${type} storage`);
    } catch (error) {
      console.error(`Failed to remove ${key}:`, error);
      throw error;
    }
  }

  /**
   * Clear all storage
   * @param {string} type - 'local' or 'sync'
   * @returns {Promise<void>}
   */
  async clear(type = 'local') {
    try {
      const storage = type === 'sync' ? chrome.storage.sync : chrome.storage.local;
      await storage.clear();

      // Clear in-memory cache
      this.cache.clear();

      console.log(`[Storage] Cleared ${type} storage`);
    } catch (error) {
      console.error(`Failed to clear ${type} storage:`, error);
      throw error;
    }
  }

  /**
   * Save user settings
   * @param {object} settings - Settings object
   * @returns {Promise<void>}
   */
  async saveSettings(settings) {
    await this.set('userSettings', settings, 'sync');
  }

  /**
   * Load user settings
   * @returns {Promise<object>}
   */
  async loadSettings() {
    const settings = await this.get('userSettings', 'sync');
    return settings || {
      dataCollection: true,
      sendAnalytics: true,
      updateFrequency: 3600000, // 1 hour
      enableNotifications: true
    };
  }

  /**
   * Save secure auth data
   * @param {object} authData - Auth data to save
   * @returns {Promise<void>}
   */
  async saveAuthData(authData) {
    await this.set('omnivyra_auth', authData, 'local');
  }

  /**
   * Load secure auth data
   * @returns {Promise<object|null>}
   */
  async loadAuthData() {
    return await this.get('omnivyra_auth', 'local');
  }

  /**
   * Save sync configuration
   * @param {object} config - Sync config
   * @returns {Promise<void>}
   */
  async saveSyncConfig(config) {
    await this.set('omnivyra_sync_config', config, 'local');
  }

  /**
   * Load sync configuration
   * @returns {Promise<object|null>}
   */
  async loadSyncConfig() {
    return await this.get('omnivyra_sync_config', 'local');
  }

  /**
   * Clear all auth data
   * @returns {Promise<void>}
   */
  async clearAuthData() {
    await this.remove('omnivyra_auth', 'local');
    await this.remove('omnivyra_sync_config', 'local');
  }

  /**
   * Save events queue (for offline support)
   * @param {Array} events - Array of events
   * @returns {Promise<void>}
   */
  async queueEvents(events) {
    try {
      const queue = await this.get('eventQueue', 'local') || [];
      const updatedQueue = [...queue, ...events].map(e => ({
        ...e,
        queuedAt: new Date().toISOString()
      }));
      await this.set('eventQueue', updatedQueue, 'local');
    } catch (error) {
      console.error('Failed to queue events:', error);
    }
  }

  /**
   * Get queued events
   * @returns {Promise<Array>}
   */
  async getQueuedEvents() {
    const queue = await this.get('eventQueue', 'local');
    return queue || [];
  }

  /**
   * Remove sent events from queue
   * @param {Array} eventIds - IDs of sent events
   * @returns {Promise<void>}
   */
  async removeQueuedEvents(eventIds) {
    try {
      const queue = await this.get('eventQueue', 'local') || [];
      const filtered = queue.filter(e => !eventIds.includes(e.id));
      await this.set('eventQueue', filtered, 'local');
    } catch (error) {
      console.error('Failed to remove queued events:', error);
    }
  }

  /**
   * Save sync state
   * @param {object} syncState - Sync state object
   * @returns {Promise<void>}
   */
  async saveSyncState(syncState) {
    await this.set('syncState', {
      lastSync: Date.now(),
      ...syncState
    }, 'local');
  }

  /**
   * Get sync state
   * @returns {Promise<object>}
   */
  async getSyncState() {
    const state = await this.get('syncState', 'local');
    return state || { lastSync: null };
  }

  /**
   * Watch storage changes
   * @param {Function} callback - Callback when storage changes
   * @param {string} type - 'local' or 'sync'
   */
  watchStorage(callback, type = 'local') {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === type) {
        // Invalidate cache for changed keys
        Object.keys(changes).forEach(key => {
          this.cache.delete(key);
        });

        callback(changes, areaName);
      }
    });
  }

  /**
   * Get storage usage statistics
   * @returns {Promise<{bytesUsed: number, bytesQuota: number}>}
   */
  async getStorageStats() {
    try {
      return new Promise((resolve) => {
        chrome.storage.local.getBytesInUse(null, (bytesUsed) => {
          resolve({
            bytesUsed: bytesUsed,
            bytesQuota: chrome.storage.local.QUOTA_BYTES
          });
        });
      });
    } catch (error) {
      console.error('Failed to get storage stats:', error);
      return { bytesUsed: 0, bytesQuota: 0 };
    }
  }

  /**
   * Clear cache (in-memory only)
   */
  clearCache() {
    this.cache.clear();
  }
}

// ES6 Export - PHASE 1 ES Modules
export default StorageManager;
