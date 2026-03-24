/**
 * SERVICE WORKER - Background Task Handler
 * 
 * Runs in the background continuously.
 * Handles periodic sync, command fetching, event batching, and offline queuing.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  syncInterval: 5 * 60 * 1000, // 5 minutes
  commandCheckInterval: 10 * 60 * 1000, // 10 minutes
  healthCheckInterval: 30 * 60 * 1000, // 30 minutes
  eventBatchSize: 50,
  eventBatchTimeout: 60 * 1000 // 1 minute
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let extensionState = {
  isInitialized: false,
  lastSync: null,
  isProcessingCommands: false,
  contentScripts: new Map(), // Track active content scripts
  eventBuffer: [],
  eventBatchTimer: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize service worker
 */
async function initServiceWorker() {
  try {
    console.log('[ServiceWorker] Initializing...');

    // Initialize auth first (checks for stored token and validates)
    if (typeof authBridge !== 'undefined') {
      const authResult = await authBridge.init();
      console.log('[ServiceWorker] Auth initialization result:', authResult);

      if (authResult.state === 'authenticated') {
        // Load sync config
        const syncConfig = await getSyncConfig();
        if (syncConfig) {
          configureSyncTasks(syncConfig);
        }
      } else {
        console.log('[ServiceWorker] Not authenticated - waiting for token');
      }
    }

    // Initialize storage manager
    if (typeof storageManager !== 'undefined') {
      // Watch for storage changes
      storageManager.watchStorage((changes, areaName) => {
        console.log('[ServiceWorker] Storage changed:', changes);
      });
    }

    extensionState.isInitialized = true;

    // Start background tasks (will skip if not authenticated)
    startPeriodicSync();
    startCommandPolling();
    startHealthMonitoring();

    // Setup message listeners
    setupMessageListeners();

    // Setup alarm listeners
    setupAlarmListeners();

    // Recover any queued events from offline (only if authenticated)
    if (authBridge && authBridge.isAuthenticated()) {
      await processQueuedEvents();
    }

    // Setup postMessage listener for token from web app
    setupPostMessageListener();

    console.log('[ServiceWorker] Initialization successful');
  } catch (error) {
    console.error('[ServiceWorker] Initialization failed:', error);
  }
}

// ============================================================================
// PERIODIC SYNC
// ============================================================================

/**
 * Start periodic sync cycle
 */
function startPeriodicSync() {
  console.log('[ServiceWorker] Starting periodic sync');

  // Use alarms for reliable background execution
  chrome.alarms.create('SYNC_EVENT_QUEUE', { periodInMinutes: 5 });
  chrome.alarms.create('FETCH_COMMANDS', { periodInMinutes: 10 });
  chrome.alarms.create('HEALTH_CHECK', { periodInMinutes: 30 });
}

/**
 * Configure sync tasks based on backend config
 * @param {object} syncConfig - Sync configuration from backend
 */
function configureSyncTasks(syncConfig) {
  console.log('[ServiceWorker] Configuring sync tasks:', syncConfig);

  const pollingMinutes = (syncConfig.polling_interval || 300000) / 60000;

  if (syncConfig.sync_mode === 'realtime') {
    // More frequent syncing for real-time mode
    chrome.alarms.clear('SYNC_EVENT_QUEUE');
    chrome.alarms.create('SYNC_EVENT_QUEUE', { periodInMinutes: Math.max(1, pollingMinutes / 2) });
  } else {
    // Standard batch mode
    chrome.alarms.clear('SYNC_EVENT_QUEUE');
    chrome.alarms.create('SYNC_EVENT_QUEUE', { periodInMinutes: Math.max(5, pollingMinutes) });
  }
}

/**
 * Sync event queue to backend
 */
async function syncEventQueue() {
  try {
    console.log('[ServiceWorker] Syncing event queue');

    if (typeof storageManager === 'undefined' || typeof apiClient === 'undefined') {
      return;
    }

    // Check authentication
    if (typeof authBridge !== 'undefined' && !authBridge.isAuthenticated()) {
      console.log('[ServiceWorker] Not authenticated, skipping sync');
      return;
    }

    // Get queued events
    const queuedEvents = await storageManager.getQueuedEvents();

    if (queuedEvents.length === 0) {
      return;
    }

    // Batch send events
    const batchSize = CONFIG.eventBatchSize;
    const batches = [];

    for (let i = 0; i < queuedEvents.length; i += batchSize) {
      batches.push(queuedEvents.slice(i, i + batchSize));
    }

    const sentEventIds = [];

    for (const batch of batches) {
      const result = await apiClient.sendEvents(batch);

      if (result.success) {
        sentEventIds.push(...batch.map(e => e.id));
      } else {
        console.error('[ServiceWorker] Failed to send batch:', result.message);
        break; // Stop sending if a batch fails
      }
    }

    // Remove sent events from queue
    if (sentEventIds.length > 0) {
      await storageManager.removeQueuedEvents(sentEventIds);
      console.log(`[ServiceWorker] Synced ${sentEventIds.length} events`);
    }

    // Update sync state
    await storageManager.saveSyncState({ lastEventSync: Date.now() });
    extensionState.lastSync = Date.now();
  } catch (error) {
    console.error('[ServiceWorker] Event sync error:', error);
  }
}

/**
 * Fetch pending commands from backend and queue them for processing
 */
async function fetchAndProcessCommands() {
  try {
    console.log('[ServiceWorker] Fetching pending commands');

    if (typeof apiClient === 'undefined' || typeof commandProcessor === 'undefined') {
      console.warn('[ServiceWorker] Required dependencies not available');
      return;
    }

    // Check authentication
    if (typeof authBridge !== 'undefined' && !authBridge.isAuthenticated()) {
      console.log('[ServiceWorker] Not authenticated, skipping command fetch');
      return;
    }

    // Fetch commands from backend
    const result = await apiClient.fetchCommands();

    if (!result.success) {
      console.warn('[ServiceWorker] Failed to fetch commands:', result.message);
      return;
    }

    if (!result.commands || result.commands.length === 0) {
      console.log('[ServiceWorker] No pending commands');
      return;
    }

    console.log(`[ServiceWorker] Fetched ${result.commands.length} commands`);

    // Queue commands for processing
    // Commands will be processed sequentially with retry logic
    const queuedCount = await commandProcessor.enqueueCommands(result.commands);

    console.log(`[ServiceWorker] Queued ${queuedCount} commands for execution`);
    console.log(`[ServiceWorker] Command queue length: ${commandProcessor.getQueueLength()}`);

  } catch (error) {
    console.error('[ServiceWorker] Command fetching error:', error);
  }
}

// ============================================================================
// HEALTH MONITORING
// ============================================================================

/**
 * Start health monitoring
 */
function startHealthMonitoring() {
  console.log('[ServiceWorker] Starting health monitoring');
}

/**
 * Perform health check
 */
async function performHealthCheck() {
  try {
    console.log('[ServiceWorker] Performing health check');

    if (typeof apiClient === 'undefined') {
      return;
    }

    const result = await apiClient.healthCheck();

    if (result.success) {
      console.log('[ServiceWorker] Backend is healthy');
    } else {
      console.warn('[ServiceWorker] Backend is unreachable');
    }
  } catch (error) {
    console.error('[ServiceWorker] Health check error:', error);
  }
}

// ============================================================================
// OFFLINE EVENT BUFFERING
// ============================================================================

/**
 * Queue event for later sync
 * @param {object} event - Event to queue
 */
async function queueEvent(event) {
  try {
    if (typeof storageManager === 'undefined') {
      return;
    }

    event.id = generateEventId();
    event.queuedAt = new Date().toISOString();

    await storageManager.queueEvents([event]);

    console.log('[ServiceWorker] Event queued:', event.id);

    // Trigger batch send if buffer is full
    if (extensionState.eventBuffer.length >= CONFIG.eventBatchSize) {
      clearTimeout(extensionState.eventBatchTimer);
      await syncEventQueue();
    } else if (!extensionState.eventBatchTimer) {
      // Set timer to send accumulated events
      extensionState.eventBatchTimer = setTimeout(async () => {
        await syncEventQueue();
        extensionState.eventBatchTimer = null;
      }, CONFIG.eventBatchTimeout);
    }
  } catch (error) {
    console.error('[ServiceWorker] Error queueing event:', error);
  }
}

/**
 * Process previously queued events
 */
async function processQueuedEvents() {
  try {
    if (typeof storageManager === 'undefined' || typeof apiClient === 'undefined') {
      return;
    }

    console.log('[ServiceWorker] Processing queued events');

    await syncEventQueue();
  } catch (error) {
    console.error('[ServiceWorker] Error processing queued events:', error);
  }
}

/**
 * Generate unique event ID
 * @returns {string}
 */
function generateEventId() {
  return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

/**
 * Setup message listeners
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[ServiceWorker] Message received:', request.action);

    (async () => {
      let response = { success: false, message: 'Unknown action' };

      try {
        switch (request.action) {
          case 'QUEUE_EVENT':
            await queueEvent(request.event);
            response = { success: true };
            break;

          case 'SYNC_NOW':
            await syncEventQueue();
            response = { success: true };
            break;

          case 'FETCH_COMMANDS_NOW':
            await fetchAndProcessCommands();
            response = { success: true };
            break;

          case 'GET_STATS':
            response = await getExtensionStats();
            break;

          case 'TRIGGER_PLATFORM_ACTION':
            response = await triggerPlatformAction(request);
            break;

          case 'CONTENT_SCRIPT_READY':
            registerContentScript(sender, request);
            response = { success: true };
            break;

          case 'ACCEPT_SESSION_TOKEN':
            response = await handleTokenAcceptance(request);
            break;

          case 'GET_AUTH_STATE':
            response = await handleGetAuthState();
            break;

          case 'REVALIDATE_SESSION':
            response = await handleRevalidateSession();
            break;

          default:
            console.warn('[ServiceWorker] Unknown action:', request.action);
        }

        sendResponse(response);
      } catch (error) {
        console.error('[ServiceWorker] Error handling message:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep channel open for async response
  });
}

/**
 * Register active content script
 * @param {object} sender - Message sender info
 * @param {object} request - Request details
 */
function registerContentScript(sender, request) {
  const tabId = sender.tab.id;
  const platform = request.platform;

  extensionState.contentScripts.set(tabId, {
    platform: platform,
    url: sender.tab.url,
    timestamp: Date.now()
  });

  console.log(`[ServiceWorker] Content script registered for tab ${tabId} (${platform})`);
}

/**
 * Get extension statistics
 * @returns {Promise<object>}
 */
async function getExtensionStats() {
  try {
    let storageStats = { bytesUsed: 0, bytesQuota: 0 };

    if (typeof storageManager !== 'undefined') {
      storageStats = await storageManager.getStorageStats();
    }

    let queuedEvents = 0;
    if (typeof storageManager !== 'undefined') {
      const queue = await storageManager.getQueuedEvents();
      queuedEvents = queue.length;
    }

    return {
      success: true,
      stats: {
        isInitialized: extensionState.isInitialized,
        lastSync: extensionState.lastSync,
        activeContentScripts: extensionState.contentScripts.size,
        queuedEvents: queuedEvents,
        storage: storageStats
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Trigger action on content script
 * @param {object} request - Request with tabId and action
 * @returns {Promise<object>}
 */
async function triggerPlatformAction(request) {
  try {
    const { tabId, platformAction } = request;

    // Send message to content script
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'PLATFORM_ACTION',
      action: platformAction.action,
      payload: platformAction.payload
    });

    return response;
  } catch (error) {
    console.error('[ServiceWorker] Error triggering platform action:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// AUTHENTICATION HANDLERS
// ============================================================================

/**
 * Handle session token acceptance from web app
 * @param {object} request - Token data
 * @returns {Promise<object>}
 */
async function handleTokenAcceptance(request) {
  try {
    console.log('[ServiceWorker] Handling token acceptance');

    if (!request.tokenData) {
      return { success: false, message: 'No token data provided' };
    }

    if (typeof authBridge === 'undefined') {
      return { success: false, message: 'Auth bridge not available' };
    }

    // Accept token and validate with backend
    const result = await authBridge.acceptSessionToken(request.tokenData);

    if (result.success) {
      // Configure sync tasks based on backend response
      const syncConfig = authBridge.getSyncConfig();
      if (syncConfig) {
        configureSyncTasks(syncConfig);
      }

      // Start event sync if not already running
      await syncEventQueue();

      // Notify content scripts
      notifyContentScriptsAuthenticated();
    }

    return result;
  } catch (error) {
    console.error('[ServiceWorker] Error handling token acceptance:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Handle get auth state request
 * @returns {Promise<object>}
 */
async function handleGetAuthState() {
  try {
    if (typeof authBridge === 'undefined') {
      return { success: false, message: 'Auth bridge not available' };
    }

    const auth = authBridge.getAuth();
    return {
      success: true,
      auth: auth
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle session revalidation
 * @returns {Promise<object>}
 */
async function handleRevalidateSession() {
  try {
    if (typeof authBridge === 'undefined') {
      return { success: false, message: 'Auth bridge not available' };
    }

    const result = await authBridge.revalidateSession();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get sync configuration from storage
 * @returns {Promise<object|null>}
 */
async function getSyncConfig() {
  try {
    const data = await chrome.storage.local.get('omnivyra_sync_config');
    return data.omnivyra_sync_config || null;
  } catch (error) {
    console.error('[ServiceWorker] Error getting sync config:', error);
    return null;
  }
}

/**
 * Notify all content scripts that user is authenticated
 */
function notifyContentScriptsAuthenticated() {
  try {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(
          tab.id,
          { action: 'USER_AUTHENTICATED' },
          () => {
            // Ignore errors for tabs that don't have content script
            chrome.runtime.lastError;
          }
        );
      });
    });
  } catch (error) {
    console.error('[ServiceWorker] Error notifying content scripts:', error);
  }
}

// ============================================================================
// ALARM HANDLERS
// ============================================================================

/**
 * Setup alarm listeners
 */
function setupAlarmListeners() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    console.log('[ServiceWorker] Alarm triggered:', alarm.name);

    switch (alarm.name) {
      case 'SYNC_EVENT_QUEUE':
        syncEventQueue();
        break;

      case 'FETCH_COMMANDS':
        fetchAndProcessCommands();
        break;

      case 'HEALTH_CHECK':
        performHealthCheck();
        break;

      default:
        console.warn('[ServiceWorker] Unknown alarm:', alarm.name);
    }
  });
}

// ============================================================================
// POST MESSAGE HANDLER
// ============================================================================

/**
 * Setup listener for postMessage from web app
 * Used to receive session tokens from Omnivyra web application
 */
function setupPostMessageListener() {
  // Listen for messages from content scripts that relay postMessage from web app
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'WEB_APP_TOKEN') {
      console.log('[ServiceWorker] Token message from web app');

      (async () => {
        const response = await handleTokenAcceptance({
          tokenData: request.tokenData
        });
        sendResponse(response);
      })();

      return true; // Keep channel open for async response
    }
  });
}

// ============================================================================
// SERVICE WORKER LIFECYCLE
// ============================================================================

// Initialize on service worker startup
initServiceWorker();

// Handle service worker becoming inactive (before termination)
self.addEventListener('beforeunload', async () => {
  console.log('[ServiceWorker] Terminating, final sync...');
  await syncEventQueue();
});
