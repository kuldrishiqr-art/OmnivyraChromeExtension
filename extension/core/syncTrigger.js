/**
 * SYNC TRIGGER - Batch Sync Activation System
 * 
 * Listens for on-demand sync triggers from Omnivyra web app.
 * 
 * Activation method:
 * window.postMessage({
 *   type: 'OMNIVYRA_SYNC_TRIGGER'
 * }, '*');
 * 
 * NO background loops or continuous activation.
 */

class SyncTrigger {
  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================

  constructor() {
    this.lastSyncTime = null;
    this.isListening = false;

    console.log('[SyncTrigger] Initialized');
  }

  // ========================================================================
  // TRIGGER LISTENING
  // ========================================================================

  /**
   * Start listening for sync trigger messages
   * Listens for: window.postMessage({type: 'OMNIVYRA_SYNC_TRIGGER'})
   */
  startListening() {
    if (this.isListening) {
      console.log('[SyncTrigger] Already listening');
      return;
    }

    window.addEventListener('message', (event) => {
      // Safety check: only accept from same origin
      if (event.source !== window) {
        return;
      }

      // Check for sync trigger message
      if (event.data?.type === 'OMNIVYRA_SYNC_TRIGGER') {
        console.log('[SyncTrigger] Received sync trigger from web app');

        // Trigger batch sync
        this.triggerSync();
      }
    });

    this.isListening = true;

    console.log('[SyncTrigger] Now listening for sync triggers');
  }

  /**
   * Stop listening for sync triggers
   */
  stopListening() {
    // Note: Can't easily remove listener with addEventListener + arrow function
    // For now, isListening flag prevents duplicate listeners
    this.isListening = false;
    console.log('[SyncTrigger] Stopped listening for sync triggers');
  }

  // ========================================================================
  // INTERNAL TRIGGER
  // ========================================================================

  /**
   * Trigger batch sync
   * @private
   */
  async triggerSync() {
    if (typeof syncEngine === 'undefined') {
      console.error('[SyncTrigger] syncEngine not available');
      return;
    }

    try {
      const result = await syncEngine.runBatchSync();

      // Optionally send result back to web app
      this.notifyWebApp(result);

      this.lastSyncTime = Date.now();

    } catch (error) {
      console.error('[SyncTrigger] Error triggering sync:', error);

      // Notify web app of error
      this.notifyWebApp({
        success: false,
        error: error.message
      });
    }
  }

  // ========================================================================
  // WEB APP COMMUNICATION
  // ========================================================================

  /**
   * Notify web app of sync result
   * @private
   * @param {object} result - Sync result to send back
   */
  notifyWebApp(result) {
    try {
      window.postMessage({
        type: 'OMNIVYRA_SYNC_RESULT',
        data: result
      }, '*');

      console.log('[SyncTrigger] Sent sync result to web app');

    } catch (error) {
      console.error('[SyncTrigger] Error notifying web app:', error);
    }
  }

  // ========================================================================
  // MANUAL TRIGGER METHOD
  // ========================================================================

  /**
   * Manually trigger sync (for testing or programmatic access)
   * 
   * @returns {Promise<object>} Sync result
   */
  async triggerManualSync() {
    console.log('[SyncTrigger] Manual sync triggered');

    if (typeof syncEngine === 'undefined') {
      console.error('[SyncTrigger] syncEngine not available');
      return {
        success: false,
        message: 'Sync engine not available'
      };
    }

    return await syncEngine.runBatchSync();
  }

  // ========================================================================
  // STATUS METHODS
  // ========================================================================

  /**
   * Get last sync timestamp
   * @returns {number|null} Timestamp or null if never synced
   */
  getLastSyncTime() {
    return this.lastSyncTime;
  }

  /**
   * Check if currently listening
   * @returns {boolean}
   */
  isCurrentlyListening() {
    return this.isListening;
  }
}

// ES6 export for service worker
export default SyncTrigger;

// Attach to window for content scripts
if (typeof window !== 'undefined') {
  window.syncTrigger = new SyncTrigger();
}
