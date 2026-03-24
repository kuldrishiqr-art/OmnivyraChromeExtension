/**
 * SYNC ENGINE - Batch Event Collection & Sending
 * 
 * Orchestrates on-demand batch synchronization:
 * - Checks authentication
 * - Detects platform (LinkedIn)
 * - Collects events from scraper
 * - Deduplicates events
 * - Sends to backend in batches
 * - Completes and stops (no background loops)
 * 
 * CRITICAL: This is on-demand/batch only - no continuous polling
 */

class SyncEngine {
  // ========================================================================
  // CONFIGURATION
  // ========================================================================

  static CONFIG = {
    MAX_EVENTS_PER_RUN: 20,       // Max events collected in one sync
    BATCH_SIZE: 5,                 // Events per API request
    BATCH_DELAY_MIN: 500,         // Min delay between batches (ms)
    BATCH_DELAY_MAX: 1500,        // Max delay between batches (ms)
    ITEM_DELAY_MIN: 800,          // Min delay between item extractions (ms)
    ITEM_DELAY_MAX: 2000          // Max delay between item extractions (ms)
  };

  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================

  constructor() {
    this.isRunning = false;
    this.collectedEvents = [];
    this.deduplicationSet = new Set();

    console.log('[SyncEngine] Initialized');
  }

  // ========================================================================
  // MAIN BATCH SYNC FLOW
  // ========================================================================

  /**
   * Run complete batch sync flow
   * 
   * Flow: Check Auth → Detect Platform → Scrape → Deduplicate → Send → Stop
   * 
   * @returns {Promise<{success: boolean, eventsCollected: number, eventsSent: number, message: string}>}
   */
  async runBatchSync() {
    // Prevent concurrent syncs
    if (this.isRunning) {
      console.warn('[SyncEngine] Sync already in progress, ignoring trigger');
      return {
        success: false,
        eventsCollected: 0,
        eventsSent: 0,
        message: 'Sync already in progress'
      };
    }

    this.isRunning = true;
    this.collectedEvents = [];
    this.deduplicationSet.clear();

    const startTime = Date.now();

    try {
      console.log('[SyncEngine] Starting batch sync...');

      // Step 1: Check authentication
      if (!this.checkAuthentication()) {
        console.log('[SyncEngine] Not authenticated, exiting silently');
        return {
          success: false,
          eventsCollected: 0,
          eventsSent: 0,
          message: 'Not authenticated'
        };
      }

      // Step 2: Detect platform
      const platform = this.detectPlatform();
      if (!platform) {
        console.log('[SyncEngine] Unable to detect platform');
        return {
          success: false,
          eventsCollected: 0,
          eventsSent: 0,
          message: 'Platform not detected'
        };
      }

      console.log(`[SyncEngine] Detected platform: ${platform}`);

      // Step 3: Scrape events from platform
      let events = [];
      if (platform === 'linkedin') {
        if (typeof linkedinScraper !== 'undefined') {
          events = await linkedinScraper.scrapeLinkedInComments();
        } else {
          console.error('[SyncEngine] LinkedIn scraper not available');
          return {
            success: false,
            eventsCollected: 0,
            eventsSent: 0,
            message: 'LinkedIn scraper not available'
          };
        }
      }

      if (!events || events.length === 0) {
        console.log('[SyncEngine] No events collected');
        return {
          success: true,
          eventsCollected: 0,
          eventsSent: 0,
          message: 'No events to sync'
        };
      }

      console.log(`[SyncEngine] Collected ${events.length} raw events`);

      // Step 4: Deduplicate events
      this.collectedEvents = this.deduplicateEvents(events);

      if (this.collectedEvents.length === 0) {
        console.log('[SyncEngine] All events were duplicates, nothing to send');
        return {
          success: true,
          eventsCollected: 0,
          eventsSent: 0,
          message: 'All events were duplicates'
        };
      }

      console.log(`[SyncEngine] After dedupe: ${this.collectedEvents.length} unique events`);

      // Step 5: Send events in batches
      const sentCount = await this.sendEvents(this.collectedEvents);

      const duration = Date.now() - startTime;

      const result = {
        success: true,
        eventsCollected: this.collectedEvents.length,
        eventsSent: sentCount,
        duration,
        message: `Synced ${sentCount} events in ${duration}ms`
      };

      console.log(
        `[SyncEngine] Batch sync complete: ` +
        `collected=${this.collectedEvents.length}, ` +
        `sent=${sentCount}, ` +
        `duration=${duration}ms`
      );

      return result;

    } catch (error) {
      console.error('[SyncEngine] Batch sync error:', error);
      return {
        success: false,
        eventsCollected: this.collectedEvents.length,
        eventsSent: 0,
        message: `Error: ${error.message}`
      };
    } finally {
      this.isRunning = false;
      this.collectedEvents = [];
      this.deduplicationSet.clear();
    }
  }

  // ========================================================================
  // AUTHENTICATION CHECK
  // ========================================================================

  /**
   * Check if user is authenticated
   * @private
   * @returns {boolean}
   */
  checkAuthentication() {
    if (typeof authBridge === 'undefined') {
      console.warn('[SyncEngine] authBridge not available');
      return false;
    }

    const isAuth = authBridge.isAuthenticated();

    if (!isAuth) {
      console.log('[SyncEngine] User not authenticated');
      return false;
    }

    return true;
  }

  // ========================================================================
  // PLATFORM DETECTION
  // ========================================================================

  /**
   * Detect current platform based on URL
   * @private
   * @returns {string|null} Platform name or null
   */
  detectPlatform() {
    const url = window.location.href;

    if (url.includes('linkedin.com')) {
      return 'linkedin';
    }

    if (url.includes('youtube.com')) {
      return 'youtube';
    }

    return null;
  }

  // ========================================================================
  // DEDUPLICATION
  // ========================================================================

  /**
   * Deduplicate events by platform_message_id
   * @private
   * @param {Array<object>} events - Raw events from scraper
   * @returns {Array<object>} Deduplicated events
   */
  deduplicateEvents(events) {
    const deduped = [];

    for (const event of events) {
      const messageId = event.platform_message_id;

      if (!messageId) {
        console.warn('[SyncEngine] Event missing platform_message_id, skipping', event);
        continue;
      }

      if (this.deduplicationSet.has(messageId)) {
        console.log(`[SyncEngine] Skipping duplicate event: ${messageId}`);
        continue;
      }

      this.deduplicationSet.add(messageId);
      deduped.push(event);
    }

    return deduped;
  }

  // ========================================================================
  // EVENT SENDING
  // ========================================================================

  /**
   * Send events to backend (delegates to apiClient)
   * apiClient now handles individual event sending with 500-1500ms delays
   * 
   * @private
   * @param {Array<object>} events - Events to send
   * @returns {Promise<number>} Total events successfully sent
   */
  async sendEvents(events) {
    if (!events || events.length === 0) {
      return 0;
    }

    if (typeof apiClient === 'undefined') {
      console.error('[SyncEngine] apiClient not available');
      return 0;
    }

    try {
      console.log(`[SyncEngine] Sending ${events.length} events to apiClient`);

      // apiClient.sendSyncEvents handles:
      // - Individual event sending (one per POST request)
      // - Random delays between requests (500-1500ms)
      // - Error handling and retry per event
      const result = await apiClient.sendSyncEvents(events);

      if (result.success) {
        console.log(`[SyncEngine] Successfully sent ${result.sentCount} events`);
        return result.sentCount || 0;
      } else {
        console.error('[SyncEngine] Failed to send events:', result.message);
        return result.sentCount || 0;
      }

    } catch (error) {
      console.error('[SyncEngine] Error sending events:', error);
      return 0;
    }
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Sleep for specified milliseconds
   * @private
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate random delay within range
   * @private
   * @param {number} min - Minimum milliseconds
   * @param {number} max - Maximum milliseconds
   * @returns {number} Random delay in ms
   */
  randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ========================================================================
  // STATUS METHODS
  // ========================================================================

  /**
   * Check if sync is currently running
   * @returns {boolean}
   */
  isActivelySyncing() {
    return this.isRunning;
  }

  /**
   * Get event count collected in current/last sync
   * @returns {number}
   */
  getCollectedEventCount() {
    return this.collectedEvents.length;
  }

  /**
   * Get deduplication set size
   * @returns {number}
   */
  getDedupSetSize() {
    return this.deduplicationSet.size;
  }
}

// ES6 Export - PHASE 1 ES Modules
export default SyncEngine;
