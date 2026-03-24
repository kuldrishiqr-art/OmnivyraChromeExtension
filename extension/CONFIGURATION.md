/**
 * EXTENSION CONFIGURATION & SETUP GUIDE
 * 
 * This file documents all configurable parameters and setup steps.
 */

// ============================================================================
// BACKEND CONFIGURATION
// ============================================================================

/**
 * STEP 1: Configure Backend API Endpoint
 * 
 * File: core/apiClient.js
 * Line: new APIClient(baseURL)
 * 
 * Replace placeholder with your backend URL:
 */
// BEFORE:
// const apiClient = new APIClient();

// AFTER:
// const apiClient = new APIClient('https://your-backend-domain.com');


/**
 * Backend Endpoints Required:
 * 
 * ===== AUTHENTICATION ENDPOINTS =====
 * 
 * POST   /extension/validate
 *        Headers: None (token passed in request body)
 *        Body: { userId, orgId, timestamp }
 *        Response (valid): { valid: true, sync_mode: "realtime|batch", polling_interval: 5000 }
 *        Response (invalid): { valid: false }
 *        Purpose: Validate extension session token on startup and periodically
 * 
 * ===== ANALYTICS ENDPOINTS =====
 * 
 * POST   /analytics/events
 *        Headers: Authorization: Bearer <sessionToken>
 *        Body: { events: [...], timestamp, clientVersion }
 *        Response: { acknowledged: true }
 *        Purpose: Send collected events and analytics
 * 
 * ===== COMMAND ENDPOINTS =====
 * 
 * GET    /commands/pending
 *        Headers: Authorization: Bearer <sessionToken>
 *        Response: { commands: [...] }
 *        Purpose: Fetch pending commands for execution
 * 
 * POST   /commands/{id}/status
 *        Headers: Authorization: Bearer <sessionToken>
 *        Body: { status: "success|failed", result, timestamp }
 *        Response: { success: true }
 *        Purpose: Report command execution status
 * 
 * ===== USER ENDPOINTS =====
 * 
 * GET    /user/profile
 *        Headers: Authorization: Bearer <sessionToken>
 *        Response: { userId, orgId, user: {...} }
 *        Purpose: Fetch user profile data
 * 
 * ===== HEALTH ENDPOINTS =====
 * 
 * GET    /health
 *        Response: 200 OK
 *        Purpose: Verify backend availability (no auth required)
 */

// ============================================================================
// AUTHENTICATION SETUP
// ============================================================================

/**
 * Omnivyra extension uses session token-based authentication from the web app.
 * 
 * Setup Flow:
 * 1. User logs into Omnivyra web app
 * 2. Web app calls window.postMessage with token data to extension
 * 3. Extension content script relays to service worker
 * 4. Service worker validates token with backend
 * 5. Backend responds with sync configuration
 * 6. Extension configures sync intervals and starts collecting data
 * 
 * NO email/password login in extension - all auth done through web app token.
 */

/**
 * Web App Integration:
 * 
 * After user logs in to your web app, send session token to extension:
 * 
 * window.postMessage({
 *   type: 'OMNIVYRA_TOKEN',
 *   data: {
 *     userId: 'user_abc123',
 *     orgId: 'org_corp456',
 *     sessionToken: 'eyJhbGciOiJIUzI1NiIs...',
 *     expiryTime: Date.now() + (24 * 60 * 60 * 1000)  // 24 hours
 *   }
 * }, '*');
 */

/**
 * Backend Validation Response:
 * 
 * POST /extension/validate
 * 
 * Request: { userId, orgId, timestamp }
 * 
 * Response options:
 * 
 * SUCCESS:
 * {
 *   valid: true,
 *   sync_mode: "realtime",      // realtime or batch
 *   polling_interval: 5000      // milliseconds
 * }
 * 
 * INVALID:
 * {
 *   valid: false
 * }
 * 
 * The sync_mode and polling_interval control how often the extension syncs:
 * - realtime: sync at (polling_interval / 2) for near real-time updates
 * - batch: sync at polling_interval for efficiency
 */

// ============================================================================
// PERMISSIONS CONFIGURATION
// ============================================================================

/**
 * STEP 2: Update Host Permissions
 * 
 * File: manifest.json
 * Section: "host_permissions"
 * 
 * Update domain permissions based on where you want the extension to run:
 * 
 * DEFAULT:
 * - *://www.linkedin.com/*
 * - *://www.youtube.com/*
 * - *://api.omnivyra.io/*
 * 
 * CUSTOMIZE:
 * - Add more platforms as needed
 * - Remove specific platforms if not used
 * - Include development domains for testing
 */

// Example for multiple environments:
/*
"host_permissions": [
  // Production
  "*://www.linkedin.com/*",
  "*://www.youtube.com/*",
  "*://api.omnivyra.io/*",
  
  // Development
  "*://localhost:3000/*",
  "*://127.0.0.1:3000/*",
  
  // Additional platforms
  "*://www.facebook.com/*",
  "*://www.twitter.com/*"
]
*/

// ============================================================================
// SYNC INTERVALS CONFIGURATION
// ============================================================================

/**
 * STEP 3: Sync Intervals (Configured by Backend)
 * 
 * Sync intervals are now dynamically configured by the backend response to
 * /extension/validate endpoint. The sync_mode and polling_interval from the
 * backend response control how often the extension syncs.
 * 
 * File: background/serviceWorker.js
 * Function: configureSyncTasks(syncConfig)
 * 
 * Backend Response Controls:
 * 
 * {
 *   valid: true,
 *   sync_mode: "realtime",      // or "batch"
 *   polling_interval: 5000      // milliseconds (recommended: 5000-60000)
 * }
 * 
 * REALTIME MODE (sync_mode = "realtime"):
 * - SYNC_EVENT_QUEUE alarm: polling_interval / 2 (e.g., 2500ms for 5s interval)
 * - FETCH_COMMANDS alarm: 10 minutes
 * - HEALTH_CHECK alarm: 30 minutes
 * - Use case: Need near real-time data collection and responsiveness
 * 
 * BATCH MODE (sync_mode = "batch"):
 * - SYNC_EVENT_QUEUE alarm: polling_interval (e.g., 5000ms)
 * - FETCH_COMMANDS alarm: 10 minutes
 * - HEALTH_CHECK alarm: 30 minutes
 * - Use case: Efficient data collection with longer sync intervals
 * 
 * FALLBACK (no backend response / offline):
 * - SYNC_EVENT_QUEUE alarm: 5 minutes
 * - FETCH_COMMANDS alarm: 10 minutes
 * - HEALTH_CHECK alarm: 30 minutes
 * - No sync attempted until authenticated
 */

// ============================================================================
// DATA COLLECTION SETTINGS
// ============================================================================

/**
 * STEP 4: Configure Data Collection Defaults
 * 
 * File: storage/storageManager.js
 * Method: loadSettings()
 * 
 * Default user settings:
 */

// CURRENT DEFAULTS:
/*
{
  dataCollection: true,           // Enable/disable collection
  sendAnalytics: true,            // Send analytics to backend
  updateFrequency: 3600000,       // 1 hour
  enableNotifications: true       // Browser notifications
}
*/

// CUSTOMIZE FOR YOUR USE CASE:
/*
{
  dataCollection: true,           // Disable for privacy mode
  sendAnalytics: false,           // Don't send data (demo mode)
  updateFrequency: 300000,        // 5 minutes for real-time
  enableNotifications: false      // No notifications
}
*/

// ============================================================================
// COMMAND HANDLERS REGISTRATION
// ============================================================================

/**
 * STEP 5: Register Custom Command Handlers
 * 
 * Add this code in your initialization (service worker or content script):
 * 
 * File: background/serviceWorker.js or content_scripts/main.js
 * After: initServiceWorker() or initContentScript()
 */

// EXAMPLE 1: LinkedIn Profile Analysis
/*
commandProcessor.registerHandler('ANALYZE_LINKEDIN_PROFILE', async (payload) => {
  // payload: { profileId, includeFollowers: true }
  
  const result = await linkedinPlatform.analyzeProfile();
  
  // Perform custom analysis
  return {
    ...result,
    customField: calculateCustomMetric(result)
  };
});
*/

// EXAMPLE 2: YouTube Recommendation Engine
/*
commandProcessor.registerHandler('YOUTUBE_RECOMMENDATIONS', async (payload) => {
  // payload: { channelId, limit: 10 }
  
  const engagement = await youtubePlatform.extractEngagement();
  const recommendations = generateRecommendations(engagement, payload.limit);
  
  return { recommendations };
});
*/

// EXAMPLE 3: Custom Data Export
/*
commandProcessor.registerHandler('EXPORT_USER_DATA', async (payload) => {
  // payload: { format: 'json' | 'csv', platform: 'all' | 'linkedin' | 'youtube' }
  
  const data = await collectAllData();
  const formatted = formatData(data, payload.format);
  const exported = await exportToFile(formatted);
  
  return { filePath: exported };
});
*/

// ============================================================================
// EVENT TYPES DOCUMENTATION
// ============================================================================

/**
 * STEP 6: Define Custom Events
 * 
 * Events sent to backend for analytics.
 * Add to content scripts to track custom interactions.
 */

// STANDARD EVENTS:
/*
await apiClient.sendEvents([
  {
    type: 'LinkedInPageVisit',
    platform: 'linkedin',
    timestamp: new Date().toISOString(),
    data: { pageType, url, duration }
  },
  {
    type: 'YouTubeVideoWatch',
    platform: 'youtube',
    timestamp: new Date().toISOString(),
    data: { videoId, duration, engagement }
  },
  {
    type: 'UserAction',
    data: { action, target, metadata }
  },
  {
    type: 'ErrorReport',
    data: { error, stack, context }
  }
]);
*/

// ============================================================================
// STORAGE QUOTA MANAGEMENT
// ============================================================================

/**
 * STEP 7: Monitor Storage Usage
 * 
 * Chrome Storage API quotas:
 * - sync: 100 KB total
 * - local: 10 MB (unlimited with unlimitedStorage permission)
 * 
 * Monitor usage:
 */

// Check storage stats periodically
/*
async function monitorStorage() {
  const stats = await storageManager.getStorageStats();
  
  console.log(`Storage used: ${stats.bytesUsed} / ${stats.bytesQuota}`);
  
  if (stats.bytesUsed > stats.bytesQuota * 0.8) {
    console.warn('Storage 80% full, consider cleanup');
    
    // Clear old events
    const queue = await storageManager.getQueuedEvents();
    const oldEvents = queue.filter(e => {
      const age = Date.now() - new Date(e.queuedAt).getTime();
      return age > 24 * 60 * 60 * 1000; // Older than 24 hours
    });
    
    await storageManager.removeQueuedEvents(oldEvents.map(e => e.id));
  }
}

setInterval(monitorStorage, 60 * 60 * 1000); // Check hourly
*/

// ============================================================================
// ENVIRONMENT VARIABLES / CONFIGURATION FILE
// ============================================================================

/**
 * STEP 8: Create Config File (Optional)
 * 
 * File: extension/config.js (NEW FILE)
 * 
 * This allows environment-based configuration without code changes:
 */

// TEMPLATE:
/*
// extension/config.js

const ENV = 'production'; // 'development' | 'staging' | 'production'

const CONFIG = {
  development: {
    apiBaseUrl: 'http://localhost:3000',
    logLevel: 'debug',
    syncInterval: 60000,        // 1 minute
    enableDevTools: true
  },
  staging: {
    apiBaseUrl: 'https://staging-api.omnivyra.io',
    logLevel: 'info',
    syncInterval: 5 * 60000,    // 5 minutes
    enableDevTools: false
  },
  production: {
    apiBaseUrl: 'https://api.omnivyra.io',
    logLevel: 'error',
    syncInterval: 5 * 60000,    // 5 minutes
    enableDevTools: false
  }
};

const CURRENT_CONFIG = CONFIG[ENV];

// Usage in apiClient.js:
// const apiClient = new APIClient(CURRENT_CONFIG.apiBaseUrl);
*/

// ============================================================================
// SECURITY CONFIGURATION
// ============================================================================

/**
 * STEP 9: Security Best Practices
 */

// 1. Token Storage
/*
   Use Chrome Storage API (encrypted by browser)
   - Never log tokens to console in production
   - Implement token rotation
   - Set appropriate expiry times (recommend 1 hour)
*/

// 2. API Communication
/*
   - Always use HTTPS
   - Implement CORS on backend
   - Validate all responses
   - Use Content Security Policy headers
*/

// 3. Content Script Injection
/*
   - Keep content scripts minimal
   - Don't expose sensitive functions globally
   - Validate all messages from service worker
*/

// 4. Secrets Management
/*
   - Don't hardcode API keys in extension
   - Use backend to manage secrets
   - Implement rate limiting on backend
*/

// ============================================================================
// TESTING CONFIGURATION
// ============================================================================

/**
 * STEP 10: Setup for Testing
 */

// Mock Backend for Testing (add to manifest in development):
/*
"background": {
  "service_worker": "background/serviceWorker.js",
  "scripts": ["background/mockBackend.js"]  // Development only
}

// Create background/mockBackend.js:
const isMockMode = true;

if (isMockMode) {
  // Intercept API calls and return mock data
  const originalFetch = window.fetch;
  
  window.fetch = function(url, options) {
    if (url.includes('/analytics/events')) {
      return Promise.resolve(new Response(
        JSON.stringify({ acknowledged: true }),
        { status: 200 }
      ));
    }
    if (url.includes('/commands/pending')) {
      return Promise.resolve(new Response(
        JSON.stringify({ commands: [] }),
        { status: 200 }
      ));
    }
    return originalFetch(url, options);
  };
}
*/

// ============================================================================
// TROUBLESHOOTING
// ============================================================================

/**
 * STEP 11: Common Issues & Solutions
 */

// Issue: Content script not loading
// Solution: 
//   - Check manifest.json permissions
//   - Verify page URL matches host_permissions
//   - Reload extension and page

// Issue: Commands not executing
// Solution:
//   - Verify command handler is registered
//   - Check service worker console for errors
//   - Ensure content script is initialized

// Issue: Events not syncing
// Solution:
//   - Verify user is authenticated
//   - Check network tab for API errors
//   - Review service worker sync logs
//   - Check storage quota

// Issue: Authentication failing
// Solution:
//   - Verify backend API endpoint
//   - Check CORS headers
//   - Review network tab requests
//   - Test /auth/login endpoint directly

// ============================================================================
// DEPLOYMENT CHECKLIST
// ============================================================================

/**
 * Before Deploying to Production:
 * 
 * [ ] Update apiClient baseURL to production
 * [ ] Update manifest.json host_permissions
 * [ ] Remove all console.log/debug statements (or set logLevel)
 * [ ] Test on all target platforms (LinkedIn, YouTube)
 * [ ] Generate extension icons (16x16, 48x48, 128x128)
 * [ ] Test offline functionality
 * [ ] Test token refresh flow
 * [ ] Test event batching/sync
 * [ ] Review security settings
 * [ ] Load test with simulated events
 * [ ] Implement error tracking (e.g., Sentry)
 * [ ] Set up monitoring/alerting
 * [ ] Create privacy policy
 * [ ] Package for Chrome Web Store
 * [ ] Set up CI/CD deployment
 */

// ============================================================================
// QUICK SETUP COMMANDS
// ============================================================================

/**
 * Development Setup:
 * 
 * 1. Open chrome://extensions
 * 2. Enable "Developer mode"
 * 3. Click "Load unpacked"
 * 4. Select the /extension folder
 * 
 * Testing:
 * 1. Open LinkedIn/YouTube
 * 2. Open extension DevTools (right-click → Inspect)
 * 3. Check for initialization logs
 * 4. Monitor Network tab for API calls
 * 
 * Debugging:
 * 1. chrome://extensions → Omnivyra → "Inspect views" → service worker
 * 2. LinkedIn/YouTube page → F12 → Console
 * 3. chrome://storage/ → View all extension storage
 */

console.log('Configuration guide loaded - see comments in this file for setup instructions');
