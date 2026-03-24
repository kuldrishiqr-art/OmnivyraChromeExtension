/**
 * CONTENT SCRIPT - Main Entry Point for Platform Pages
 * 
 * Injects into LinkedIn and YouTube pages.
 * Detects the platform and initializes the appropriate module.
 * Handles communication between content scripts and service worker.
 */

// ============================================================================
// PLATFORM DETECTION & INITIALIZATION
// ============================================================================

/**
 * Detect which platform we're on
 * @returns {string} 'linkedin' or 'youtube'
 */
function detectPlatform() {
  const hostname = window.location.hostname;

  if (hostname.includes('linkedin.com')) {
    return 'linkedin';
  } else if (hostname.includes('youtube.com')) {
    return 'youtube';
  }

  return 'unknown';
}

/**
 * Load and initialize platform-specific module
 * @param {string} platform - Platform name
 * @returns {Promise<object>} Platform module instance
 */
async function initializePlatform(platform) {
  console.log(`[ContentScript] Initializing platform: ${platform}`);

  switch (platform) {
    case 'linkedin':
      // Load LinkedIn module - in production would use dynamic import
      const linkedInModule = await loadScript('platforms/linkedin/index.js');
      await linkedinPlatform.init();
      return linkedinPlatform;

    case 'youtube':
      // Load YouTube module
      const youTubeModule = await loadScript('platforms/youtube/index.js');
      await youtubePlatform.init();
      return youtubePlatform;

    default:
      console.warn('[ContentScript] Unknown platform');
      return null;
  }
}

/**
 * Dynamically load external script
 * @param {string} scriptPath - Relative path to script
 * @returns {Promise<void>}
 */
function loadScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scriptPath);
    script.type = 'module';

    script.onload = () => {
      resolve();
    };

    script.onerror = () => {
      reject(new Error(`Failed to load script: ${scriptPath}`));
    };

    document.head.appendChild(script);
  });
}

// ============================================================================
// EVENT ROUTING
// ============================================================================

/**
 * Setup message listener for service worker communication
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[ContentScript] Message received:', request);

    (async () => {
      try {
        let response = { success: false, message: 'Unknown action' };

        // Route different message types
        switch (request.action) {
          case 'EXECUTE_COMMAND':
            response = await handleCommandExecution(request.command);
            break;

          case 'REQUEST_PAGE_DATA':
            response = await handlePageDataRequest(request);
            break;

          case 'PLATFORM_ACTION':
            response = await handlePlatformAction(request);
            break;

          case 'USER_AUTHENTICATED':
            console.log('[ContentScript] User authenticated notification received');
            eventBus.emit('auth:authenticated', {});
            response = { success: true };
            break;

          case 'PING':
            response = { success: true, message: 'pong', platform: detectPlatform() };
            break;

          default:
            console.warn('[ContentScript] Unknown action:', request.action);
        }

        sendResponse(response);
      } catch (error) {
        console.error('[ContentScript] Error handling message:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    // Return true to indicate we'll send async response
    return true;
  });
}

/**
 * Setup listener for postMessage from web app
 * Relays token from web app to service worker
 */
function setupPostMessageListener() {
  window.addEventListener('message', (event) => {
    // Only accept messages from the same page (for security)
    if (event.source !== window) return;

    if (event.data && event.data.type === 'OMNIVYRA_TOKEN') {
      console.log('[ContentScript] Received token via postMessage');

      // Relay to service worker
      chrome.runtime.sendMessage({
        action: 'WEB_APP_TOKEN',
        tokenData: event.data.payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[ContentScript] Error sending token:', chrome.runtime.lastError);
          return;
        }

        console.log('[ContentScript] Token relayed to service worker:', response);

        // Notify web app of result
        window.postMessage({
          type: 'OMNIVYRA_TOKEN_RESULT',
          success: response.success,
          message: response.message
        }, '*');
      });
    }
  });
}

/**
 * Handle command execution request
 * @param {object} command - Command to execute
 * @returns {Promise<object>}
 */
async function handleCommandExecution(command) {
  if (typeof commandProcessor === 'undefined') {
    return { success: false, error: 'CommandProcessor not available' };
  }

  try {
    const result = await commandProcessor.processCommand(command);
    return { success: result.status === 'success', result: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle page data request
 * @param {object} request - Request details
 * @returns {Promise<object>}
 */
async function handlePageDataRequest(request) {
  const platform = detectPlatform();

  try {
    if (platform === 'linkedin' && typeof linkedinPlatform !== 'undefined') {
      return {
        success: true,
        platform: platform,
        data: await linkedinPlatform.analyzeProfile()
      };
    } else if (platform === 'youtube' && typeof youtubePlatform !== 'undefined') {
      return {
        success: true,
        platform: platform,
        data: await youtubePlatform.analyzeVideo()
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }

  return { success: false, error: 'Platform not supported' };
}

/**
 * Handle platform-specific action
 * @param {object} request - Request with platform action
 * @returns {Promise<object>}
 */
async function handlePlatformAction(request) {
  const platform = detectPlatform();
  const { action, payload } = request;

  try {
    if (platform === 'linkedin' && typeof linkedinPlatform !== 'undefined') {
      // Route to LinkedIn handlers
      if (action === 'analyze_profile') {
        return { success: true, result: await linkedinPlatform.analyzeProfile(payload) };
      } else if (action === 'analyze_feed') {
        return { success: true, result: await linkedinPlatform.analyzeFeed(payload) };
      }
    } else if (platform === 'youtube' && typeof youtubePlatform !== 'undefined') {
      // Route to YouTube handlers
      if (action === 'analyze_video') {
        return { success: true, result: await youtubePlatform.analyzeVideo(payload) };
      } else if (action === 'analyze_channel') {
        return { success: true, result: await youtubePlatform.analyzeChannel(payload) };
      }
    }
  } catch (error) {
    return { success: false, error: error.message };
  }

  return { success: false, error: 'Unknown action' };
}

// ============================================================================
// PAGE MONITORING
// ============================================================================

/**
 * Monitor page changes and re-initialize if needed
 */
function setupPageMonitoring() {
  let currentPlatform = detectPlatform();

  // Watch for URL changes (single-page apps)
  let lastUrl = window.location.href;
  const checkUrlChange = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const newPlatform = detectPlatform();

      if (newPlatform !== currentPlatform) {
        console.log('[ContentScript] Platform changed, reinitializing');
        currentPlatform = newPlatform;
        initializePlatform(newPlatform).catch(error => {
          console.error('[ContentScript] Platform initialization failed:', error);
        });
      }

      // Emit page change event
      if (typeof eventBus !== 'undefined') {
        eventBus.emit('page:changed', { url: lastUrl, platform: currentPlatform });
      }
    }
  };

  setInterval(checkUrlChange, 1000);
}

// ============================================================================
// DATA COLLECTION
// ============================================================================

/**
 * Setup periodic data collection
 */
async function setupDataCollection() {
  // Get user settings for collection frequency
  let settings = {};
  if (typeof storageManager !== 'undefined') {
    settings = await storageManager.loadSettings();
  }

  const collectInterval = settings.updateFrequency || 3600000; // 1 hour default

  setInterval(async () => {
    if (!settings.dataCollection) {
      return; // Data collection disabled
    }

    console.log('[ContentScript] Collecting page data');
    const platform = detectPlatform();

    try {
      if (platform === 'linkedin' && typeof linkedinPlatform !== 'undefined') {
        const data = await linkedinPlatform.analyzeProfile();
        if (typeof apiClient !== 'undefined') {
          await apiClient.sendEvents([
            {
              type: 'LinkedInPageVisit',
              data: data
            }
          ]);
        }
      } else if (platform === 'youtube' && typeof youtubePlatform !== 'undefined') {
        const data = await youtubePlatform.analyzeVideo();
        if (typeof apiClient !== 'undefined') {
          await apiClient.sendEvents([
            {
              type: 'YouTubePageVisit',
              data: data
            }
          ]);
        }
      }
    } catch (error) {
      console.error('[ContentScript] Data collection error:', error);
    }
  }, collectInterval);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize content script on page load
 */
async function initContentScript() {
  try {
    console.log('[ContentScript] Starting initialization');

    // Wait a bit for DOM to be ready
    if (document.readyState === 'loading') {
      await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve);
      });
    }

    // Detect platform
    const platform = detectPlatform();
    console.log(`[ContentScript] Detected platform: ${platform}`);

    if (platform === 'unknown') {
      console.warn('[ContentScript] Unknown platform, stopping');
      return;
    }

    // Initialize platform
    await initializePlatform(platform);

    // Setup messaging
    setupMessageListener();

    // Setup postMessage listener for web app tokens
    setupPostMessageListener();

    // Setup page monitoring
    setupPageMonitoring();

    // Setup data collection
    await setupDataCollection();

    console.log('[ContentScript] Initialization complete');

    // Notify service worker
    chrome.runtime.sendMessage({
      action: 'CONTENT_SCRIPT_READY',
      platform: platform
    }).catch(error => {
      console.error('[ContentScript] Failed to notify service worker:', error);
    });
  } catch (error) {
    console.error('[ContentScript] Initialization failed:', error);
  }
}

// Start initialization when page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}
