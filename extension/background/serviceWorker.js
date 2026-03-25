/**
 * SERVICE WORKER - Standalone, clean architecture
 * 
 * Responsibilities:
 * - Authentication and token management
 * - Event sync to backend
 * - Command fetching and execution
 * - Health monitoring
 * - Messaging with content scripts
 */

// Load shared libraries (no exports, attach to globalThis)
importScripts(
  '../shared/messaging.js',
  '../shared/stateManager.js',
  '../shared/apiClient.js'
);

let messenger, state, apiClient;
const CONFIG = {
  syncInterval: 5 * 60 * 1000,
  commandInterval: 10 * 60 * 1000,
  healthInterval: 2 * 60 * 1000
};

/**
 * Initialize service worker
 */
async function init() {
  try {
    console.log('[ServiceWorker] Initializing...');
    
    state = new StateManager();
    await state.init();
    
    apiClient = new APIClient();
    
    messenger = new Messenger(true);
    setupHandlers();
    
    startSync();
    startHealthCheck();
    
    console.log('[ServiceWorker] Ready');
  } catch (error) {
    console.error('[ServiceWorker] Init error:', error);
  }
}

/**
 * Setup message handlers for content scripts
 */
function setupHandlers() {
  // Queue an event
  messenger.registerHandler('QUEUE_EVENT', async (payload) => {
    const queue = await state.queueEvent(payload.event);
    return { success: true, queueSize: queue.length };
  });

  // Get auth state
  messenger.registerHandler('GET_AUTH_STATE', async () => {
    const token = await state.getToken();
    const status = await state.getSyncStatus();
    const queue = await state.getQueuedEvents();
    return {
      authenticated: !!token,
      lastSync: status.lastSync,
      queueLength: queue.length
    };
  });

  // Trigger sync now
  messenger.registerHandler('SYNC_NOW', async () => {
    await performSync();
    return { success: true };
  });

  // Health status
  messenger.registerHandler('GET_HEALTH', async () => {
    return await state.getAllEvents();
  });

  // Report error
  messenger.registerHandler('REPORT_ERROR', async (payload) => {
    console.error('[ContentScript]', payload.context, ':', payload.error);
    return { received: true };
  });
}

/**
 * Start periodic sync
 */
function startSync() {
  setTimeout(performSync, 3000);
  setInterval(performSync, CONFIG.syncInterval);
}

/**
 * Perform sync operation
 */
async function performSync() {
  try {
    const token = await state.getToken();
    if (!token) {
      console.log('[ServiceWorker] No token, skipping sync');
      return;
    }

    const events = await state.getQueuedEvents();
    if (!events.length) {
      return;
    }

    console.log('[ServiceWorker] Syncing', events.length, 'events');
    
    const result = await apiClient.sendEvents(events, token);
    if (result.success) {
      await state.removeQueuedEvents(events.map(e => e.id));
      await state.setSyncStatus({
        lastSync: Date.now(),
        synced: result.synced
      });
      console.log('[ServiceWorker] Sync ok:', result.synced, 'events');
    } else {
      console.error('[ServiceWorker] Sync failed:', result.error);
    }
  } catch (error) {
    console.error('[ServiceWorker] Sync error:', error);
  }
}

/**
 * Start health check
 */
function startHealthCheck() {
  setInterval(async () => {
    const health = await state.getAllEvents();
    const ping = await apiClient.ping();
    console.log('[ServiceWorker] Health:', { health, apiOk: ping.success });
  }, CONFIG.healthInterval);
}

// Initialize on load
init();
