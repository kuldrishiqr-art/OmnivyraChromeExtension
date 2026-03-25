/**
 * CONTENT SCRIPT - Standalone, clean architecture
 * 
 * Injects into LinkedIn/YouTube.
 * Collects data and reports to service worker.
 * No module dependencies.
 */

// Load shared messaging library
const script = document.createElement('script');
script.src = chrome.runtime.getURL('shared/messaging.js');
document.documentElement.appendChild(script);

// Load shared state manager
const script2 = document.createElement('script');
script2.src = chrome.runtime.getURL('shared/stateManager.js');
document.documentElement.appendChild(script2);

let messenger;

/**
 * Initialize content script
 */
async function init() {
  try {
    console.log('[ContentScript] Initializing on', document.location.hostname);
    
    // Wait for messaging to be available
   await waitForMessenger();
    
    messenger = new Messenger(false);
    
    setupPageTracking();
    setupCommandHandlers();
    
    // Report ready
    const state = await messenger.send('GET_AUTH_STATE');
    console.log('[ContentScript] Ready, auth state:', state);
    
  } catch (error) {
    console.error('[ContentScript] Init error:', error);
    reportError(error, 'initialization');
  }
}

/**
 * Wait for messenger to load (async script injection)
 */
function waitForMessenger() {
  return new Promise((resolve) => {
    const checkMessenger = () => {
      if (typeof Messenger !== 'undefined') {
        resolve();
      } else {
        setTimeout(checkMessenger, 100);
      }
    };
    checkMessenger();
  });
}

/**
 * Setup page tracking - collect data when user does things
 */
function setupPageTracking() {
  // Detect platform
  const isLinkedIn = document.location.hostname.includes('linkedin.com');
  const isYouTube = document.location.hostname.includes('youtube.com');
  
  if (isLinkedIn) {
    trackLinkedIn();
  } else if (isYouTube) {
    trackYouTube();
  }
}

/**
 * Track LinkedIn events
 */
function trackLinkedIn() {
  console.log('[ContentScript] Tracking LinkedIn');
  
  // Track when user views a profile
  document.addEventListener('click', (e) => {
    const profileLink = e.target.closest('a[href*="/in/"], a[href*="/company/"]');
    if (profileLink) {
      queueEvent({
        type: 'PROFILE_VIEW',
        url: profileLink.href,
        timestamp: Date.now()
      });
    }
  });
}

/**
 * Track YouTube events
 */
function trackYouTube() {
  console.log('[ContentScript] Tracking YouTube');
  
  // Track video plays
  const videoObserver = new MutationObserver(() => {
    const videoTitle = document.querySelector('h1 > yt-formatted-string');
    if (videoTitle) {
      queueEvent({
        type: 'VIDEO_VIEW',
        title: videoTitle.textContent,
        url: window.location.href,
        timestamp: Date.now()
      });
    }
  });
  
  videoObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Queue an event to sync
 */
async function queueEvent(event) {
  try {
    if (!messenger) {
      console.warn('[ContentScript] Messenger not ready');
      return;
    }
    
    const result = await messenger.send('QUEUE_EVENT', { event });
    console.log('[ContentScript] Event queued, queue size:', result.queueSize);
  } catch (error) {
    console.error('[ContentScript] Queue error:', error);
    reportError(error, 'queue_event');
  }
}

/**
 * Setup handlers for commands from service worker
 */
function setupCommandHandlers() {
  // Listen for commands from service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'EXECUTE_COMMAND') {
      handleCommand(message.payload);
    }
  });
}

/**
 * Handle command execution
 */
async function handleCommand(payload) {
  const { commands } = payload;
  console.log('[ContentScript] Executing', commands.length, 'commands');
  
  for (const cmd of commands) {
    try {
      switch (cmd.action) {
        case 'EXTRACT_DATA':
          extractPageData();
          break;
        case 'SCROLL_TO_LOAD':
          scrollToLoadMore();
          break;
        default:
          console.log('[ContentScript] Unknown command:', cmd.action);
      }
    } catch (error) {
      console.error('[ContentScript] Command error:', error);
      reportError(error, `command_${cmd.action}`);
    }
  }
}

/**
 * Extract page data
 */
function extractPageData() {
  const data = {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now()
  };
  
  console.log('[ContentScript] Extracted:', data);
  
  queueEvent({
    type: 'PAGE_DATA',
    data: data,
    timestamp: Date.now()
  });
}

/**
 * Scroll to load more content
 */
function scrollToLoadMore() {
  window.scrollBy(0, window.innerHeight);
}

/**
 * Report error back to service worker
 */
async function reportError(error, context) {
  try {
    if (!messenger) return;
    await messenger.send('REPORT_ERROR', {
      error: error.message,
      context: context,
      stack: error.stack
    });
  } catch (e) {
    console.error('[ContentScript] Error reporting failed:', e);
  }
}

// Initialize when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
