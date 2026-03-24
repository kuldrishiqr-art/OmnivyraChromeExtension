/**
 * BATCH SYNC INTEGRATION GUIDE
 * 
 * Complete implementation of on-demand batch data collection for Chrome Extension.
 * Includes: trigger listening, platform scraping, event deduplication, and backend transmission.
 * 
 * NO continuous polling. NO background loops. Triggered only on-demand via postMessage.
 */

// ============================================================================
// MANIFEST.JSON - Required Configuration
// ============================================================================

/*
Ensure manifest.json has:

1. Permissions for data access:
   "permissions": ["storage", "scripting", "activeTab"]
   
2. Host permissions for target sites:
   "host_permissions": [
     "*://www.linkedin.com/*",
     "*://www.youtube.com/*",
     "*://api.omnivyra.io/*"
   ]

3. Content scripts to inject into pages:
   "content_scripts": [{
     "matches": ["*://www.linkedin.com/*"],
     "js": [
       "core/eventBus.js",
       "core/authBridge.js",
       "core/storageManager.js",
       "core/apiClient.js",
       "core/commandProcessor.js",
       "core/syncEngine.js",
       "core/syncTrigger.js",
       "platforms/linkedin/scraper.js",
       "content_scripts/main.js"
     ],
     "run_at": "document_start",
     "all_frames": false
   }]

4. Background service worker:
   "background": {
     "service_worker": "background/serviceWorker.js",
     "type": "module"
   }
*/

// ============================================================================
// ARCHITECTURE OVERVIEW
// ============================================================================

/*
BATCH SYNC FLOW (On-Demand Only):

1. WEB APP TRIGGER
   - Omnivyra web app sends: window.postMessage({type: 'OMNIVYRA_SYNC_TRIGGER'}, '*')
   - Trigger can optionally include metadata: {type, options, requestId}

2. SYNC TRIGGER LISTENER (syncTrigger.js)
   - window.addEventListener('message') listening for OMNIVYRA_SYNC_TRIGGER
   - Validates message source (event.source === window)
   - Calls syncEngine.runBatchSync()
   - Returns result via postMessage: {type: 'OMNIVYRA_SYNC_RESULT', data}

3. SYNC ENGINE ORCHESTRATION (syncEngine.js)
   - runBatchSync() executes single complete cycle:
     a) checkAuthentication() - validates via authBridge
     b) detectPlatform() - checks URL for current platform
     c) scrapeLinkedInComments() - calls linkedinScraper for visible comments
     d) deduplicateEvents() - maintains Set of platform_message_id
     e) sendEvents() - chunks into batches (size 5), sends with delays
     f) Returns: {success, eventCount, eventsSent}

4. PLATFORM SCRAPER (platforms/linkedin/scraper.js)
   - linkedinScraper.scrapeLinkedInComments()
   - Finds visible comment elements via DOM selectors
   - Extracts: content, author_name, author_profile_url, thread_id, created_at
   - Returns normalized events array
   - MAX 20 comments per run
   - Random delays 800-2000ms between items (human-like behavior)

5. DEDUPLICATION (syncEngine.js)
   - Maintains Set of platform_message_id
   - Skips duplicate events within same sync run
   - Prevents resending same comment multiple times

6. BATCH TRANSMISSION (apiClient.js)
   - apiClient.sendSyncEvents(events)
   - Chunks events into batches (size 5)
   - Random delays 500-1500ms between batches
   - POST to /api/extension/events
   - Headers: Authorization: Bearer <session_token>
   - Returns: {success, eventsSent, data}

7. BACKEND STORAGE
   - Backend receives events at /api/extension/events
   - Stores in user's event timeline
   - Can be used for analytics, alerts, insights

CRITICAL: No background loops. No continuous scraping. Triggered only on-demand.
*/

// ============================================================================
// FILE STRUCTURE
// ============================================================================

/*
extension/
├── core/
│   ├── eventBus.js                    [Existing - Pub-sub system]
│   ├── authBridge.js                  [Existing - Session token management]
│   ├── storageManager.js              [Existing - Secure storage]
│   ├── apiClient.js                   [ENHANCED - Added sendSyncEvents()]
│   ├── commandProcessor.js            [Existing - Command queue & retry]
│   ├── syncEngine.js                  [NEW - Batch sync orchestration]
│   └── syncTrigger.js                 [NEW - Message listener]
├── platforms/
│   └── linkedin/
│       ├── index.js                   [Existing - LinkedIn module]
│       └── scraper.js                 [NEW - Safe comment extraction]
├── content_scripts/
│   └── main.js                        [Existing - Entry point]
├── background/
│   └── serviceWorker.js               [Existing - Background tasks]
├── manifest.json                      [REQUIRES UPDATES - Script order]
├── README.md                          [Existing]
├── CONFIGURATION.md                   [Existing]
└── QUICK_REFERENCE.md                 [Existing]
*/

// ============================================================================
// SCRIPT LOADING ORDER (Content Script Injection)
// ============================================================================

/*
CRITICAL: Manifest must define content_scripts with correct order:

"content_scripts": [{
  "matches": ["*://www.linkedin.com/*"],
  "js": [
    // 1. Foundation modules (no dependencies)
    "core/eventBus.js",               // Event system
    "core/storageManager.js",         // Storage API wrapper
    
    // 2. API & Auth (depends on eventBus, storage)
    "core/authBridge.js",             // Session token management
    "core/apiClient.js",              // Backend communication
    
    // 3. Processing modules (depends on auth, API)
    "core/commandProcessor.js",       // Command queue system
    "core/syncEngine.js",             // Batch sync orchestrator
    "core/syncTrigger.js",            // Message listener
    
    // 4. Platform-specific modules
    "platforms/linkedin/scraper.js",  // DOM scraping
    
    // 5. Main entry point (depends on all above)
    "content_scripts/main.js"
  ],
  "run_at": "document_start",
  "all_frames": false
}]

This order ensures:
- eventBus available before anything that emits events
- authBridge available before syncEngine checks auth
- syncEngine available before syncTrigger tries to call it
- Scraper available before syncEngine tries to scrape
- All dependencies ready before main.js tries to use them
*/

// ============================================================================
// RUNTIME FLOW EXAMPLE
// ============================================================================

/*
STEP-BY-STEP EXECUTION:

1. User on LinkedIn page → manifest loads content scripts in order
   - eventBus.js creates global eventBus singleton
   - authBridge.js initializes with stored session token
   - syncEngine.js creates global syncEngine singleton
   - syncTrigger.js starts listening for postMessage
   - linkedinScraper creates global linkedinScraper singleton
   - main.js initializes content script handlers

2. Omnivyra web app triggers sync:
   window.postMessage({
     type: 'OMNIVYRA_SYNC_TRIGGER'
   }, '*')

3. syncTrigger.js event listener detects message:
   - Validates event.source === window (security check)
   - Checks event.data?.type === 'OMNIVYRA_SYNC_TRIGGER'
   - Calls syncEngine.runBatchSync()

4. syncEngine.runBatchSync() executes:
   
   a) Check authentication:
      - authBridge.isAuthenticated() → returns boolean
      - If not authenticated, return {success: false}
   
   b) Detect platform:
      - window.location.href.includes('linkedin.com') → 'linkedin'
   
   c) Scrape visible comments:
      - linkedinScraper.scrapeLinkedInComments()
      - Finds visible comment DOM elements
      - Extracts content, author, URLs, timestamps
      - Adds random delays 800-2000ms between items
      - Returns array of 0-20 normalized events
   
   d) Deduplicate:
      - Initialize Set() of platform_message_id
      - Filter events - skip if platform_message_id in Set
      - Only send new, unique events
   
   e) Send in batches:
      - Chunk events into batches of 5
      - For each batch:
        * apiClient.sendSyncEvents(batch)
        * POST to /api/extension/events with Bearer token
        * Add random delay 500-1500ms
      - Return {success: true, eventsSent: <count>}

5. syncTrigger notifies web app:
   window.postMessage({
     type: 'OMNIVYRA_SYNC_RESULT',
     data: {success: true, eventCount: 12, eventsSent: 12}
   }, '*')

6. Backend stores events in user's timeline
   - Can query via /api/user/events
   - Can trigger alerts/notifications
   - Can feed into analytics pipelines
*/

// ============================================================================
// CONFIGURATION & TUNING
// ============================================================================

/*
SyncEngine CONFIG (syncEngine.js):
  MAX_EVENTS_PER_RUN: 20        // Max comments to extract per sync
  BATCH_SIZE: 5                 // Comments per batch send
  BATCH_DELAY_MIN: 500          // Min delay between batches (ms)
  BATCH_DELAY_MAX: 1500         // Max delay between batches (ms)
  ITEM_DELAY_MIN: 800           // Min delay between items (ms)
  ITEM_DELAY_MAX: 2000          // Max delay between items (ms)

LinkedInScraper CONFIG (platforms/linkedin/scraper.js):
  MAX_COMMENTS: 20              // Absolute max per run
  ITEM_DELAY_MIN: 800           // Delay between items (ms)
  ITEM_DELAY_MAX: 2000          // Delay between items (ms)
  DOM_TIMEOUT: 5000             // Timeout for DOM operations (ms)
  VISIBLE_RETRY_ATTEMPTS: 3     // Retry count for visibility checks

These can be tuned for:
- Faster collection: Reduce delays, increase MAX_EVENTS
- Less server load: Increase BATCH_DELAY, reduce BATCH_SIZE
- Server rate limiting: Increase delays, reduce batch size
*/

// ============================================================================
// SECURITY CONSIDERATIONS
// ============================================================================

/*
1. Message Source Validation:
   - syncTrigger.js checks event.source === window (prevents cross-origin attacks)
   - Only accepts OMNIVYRA_SYNC_TRIGGER type

2. Authentication Gating:
   - syncEngine checks authBridge.isAuthenticated() before scraping
   - No data collected without valid session token
   - Token automatically validated with backend

3. Session Token Handling:
   - authBridge.getSessionToken() returns current Bearer token
   - Automatically included in all API requests
   - Token expiry handled - cleared on 401 responses

4. Data Extraction Safety:
   - linkedinScraper uses innerText (prevents XSS)
   - No click/scroll actions that could trigger unexpected behavior
   - Only reads visible elements (no hidden data extraction)
   - Random delays make pattern detection difficult

5. No Sensitive Data:
   - Scraper extracts only: comment content, author name, profile URL
   - Does NOT extract: private messages, connection data, profile settings
   - Comment content is user-created public data

6. Deduplication:
   - Same comment never sent twice in one sync
   - Set-based deduplication is deterministic
   - Platform_message_id uniquely identifies each comment

7. Backend Validation:
   - Backend should validate:
     * Bearer token is valid and not expired
     * User has permission to store these events
     * Event data matches expected schema
     * No duplicate platform_message_id in same day
     * Rate limiting per user (maybe 100 events/hour max)
*/

// ============================================================================
// TESTING CHECKLIST
// ============================================================================

/*
1. Unit Tests:
   [ ] linkedinScraper.scrapeLinkedInComments() returns array of events
   [ ] Events have required fields: platform, event_type, platform_message_id, data
   [ ] Data has: content, author_name, author_profile_url, thread_id, created_at
   [ ] syncEngine.deduplicateEvents() removes duplicates correctly
   [ ] syncEngine prevents concurrent syncs (isRunning flag)

2. Integration Tests:
   [ ] syncTrigger listener receives postMessage correctly
   [ ] syncEngine.runBatchSync() executes full flow successfully
   [ ] Auth check gates execution correctly
   [ ] Platform detection identifies LinkedIn correctly
   [ ] Events sent to backend with Bearer token

3. Manual Tests:
   [ ] Navigate to linkedin.com/feed/
   [ ] Trigger sync via: window.postMessage({type: 'OMNIVYRA_SYNC_TRIGGER'}, '*')
   [ ] Check console for [SyncTrigger], [SyncEngine], [APIClient] logs
   [ ] Verify postMessage response received
   [ ] Check backend for new events in timeline

4. Edge Cases:
   [ ] No comments visible → returns empty array
   [ ] User not authenticated → returns {success: false}
   [ ] Network error → logged and gracefully handled
   [ ] Multiple sync triggers → isRunning flag prevents concurrent execution
   [ ] Very long comment text → truncated correctly, not causing issues

5. Performance:
   [ ] Single sync completes in < 5 seconds
   [ ] No memory leaks in repeated syncs
   [ ] No page freezing during scrape
   [ ] Batch delays visible in network tab timing
*/

// ============================================================================
// LOGGING & DEBUGGING
// ============================================================================

/*
All components use standardized logging with [ComponentName] prefix:

[SyncTrigger] - Batch sync triggering system
  - "Now listening for sync triggers"
  - "Received sync trigger from web app"
  - "Sent sync result to web app"
  - "Error triggering sync: <message>"

[SyncEngine] - Core batch orchestration
  - "Starting /LinkedInBatchSync"
  - "Auth check: authenticated" / "Auth check: not authenticated"
  - "Detected platform: linkedin"
  - "Scraping comments..."
  - "Found 12 events after deduplication"
  - "Sending batch 1/3 with 5 events"
  - "Batch sync complete: 12 events collected in 2845ms"

[APIClient] - Backend communication
  - "Sending 5 sync events to backend"
  - "Successfully sent 5 sync events"
  - "Failed to send sync events: <error>"

[LinkedInScraper] - DOM scraping
  - "Starting comment scrape"
  - "Found 42 visible comments"
  - "Extracted comment 1"
  - "Scrape complete: 12 events collected in 1234ms"

Debug mode: Set localStorage setItem('omnivyra_debug', 'true') to enable verbose logging
*/

// ============================================================================
// BACKEND API ENDPOINTS
// ============================================================================

/*
POST /api/extension/events
  Request:
  {
    events: [
      {
        platform: 'linkedin',
        event_type: 'comment',
        platform_message_id: 'msg_abc123',
        data: {
          content: 'Great post! Love the insights.',
          author_name: 'John Smith',
          author_profile_url: 'https://www.linkedin.com/in/johnsmith/',
          thread_id: 'activity_123456789',
          created_at: 1699564800000
        }
      },
      // ... more events
    ],
    timestamp: '2024-01-15T10:30:45.123Z',
    clientVersion: '1.0.0'
  }

  Response (Success):
  {
    success: true,
    message: 'Events stored successfully',
    storedCount: 12,
    duplicateCount: 0,
    data: {
      eventIds: ['evt_1', 'evt_2', ...],
      storedAt: '2024-01-15T10:30:45.123Z'
    }
  }

  Response (Error):
  {
    success: false,
    message: 'Invalid token',
    error: 'INVALID_TOKEN'
  }

  Status Codes:
  - 200: OK - Events stored
  - 400: Bad Request - Invalid event format
  - 401: Unauthorized - Invalid/expired token
  - 429: Too Many Requests - Rate limited
  - 500: Server Error - Database issue
*/

// ============================================================================
// FUTURE ENHANCEMENTS
// ============================================================================

/*
1. Multi-Platform Support:
   - Add YouTube scraper (video comment collection)
   - Add Twitter scraper (tweet/reply collection)
   - Plug into new platform scrapers via platform detection

2. Filtering & Transformation:
   - Filter comments by keywords (optional)
   - Transform comment sentiment analysis
   - Extract mentions and hashtags
   - Classify comment types (question, feedback, promotion, etc.)

3. Advanced Scheduling:
   - Allow users to set sync frequency (hourly, daily, weekly)
   - Scheduled batches vs on-demand
   - Scheduled cleanup of old events

4. Retry & Recovery:
   - Queue failed events for retry with exponential backoff
   - Local storage of failed batches
   - Resume on network recovery

5. User Interface:
   - Popup showing last sync time and event count
   - Manual trigger button in popup
   - Sync history/timeline view
   - Error notifications

6. Analytics & Reporting:
   - Track events collected per platform
   - Report on comment sentiment trends
   - Engagement metrics
   - Export to CSV/JSON
*/

// ============================================================================
// QUICK START
// ============================================================================

/*
1. Verify manifest.json includes all core scripts in correct order
2. Navigate to any LinkedIn page
3. Open DevTools Console
4. Trigger sync:
   window.postMessage({type: 'OMNIVYRA_SYNC_TRIGGER'}, '*')
5. Listen for response:
   window.addEventListener('message', (e) => {
     if (e.data?.type === 'OMNIVYRA_SYNC_RESULT') {
       console.log('Sync result:', e.data);
     }
   });
6. Check console logs for [SyncTrigger], [SyncEngine], [APIClient]
7. Check backend /api/user/events for new entries
8. Done!

For production:
- Ensure service worker loads all modules correctly
- Add error monitoring/logging to backend
- Implement rate limiting on server side
- Add user preferences for sync frequency
- Monitor extension performance impact
- Set up automated testing pipeline
*/
