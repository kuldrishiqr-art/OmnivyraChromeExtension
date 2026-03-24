# Omnivyra Chrome Extension - Architecture & Implementation Guide

## Project Overview

**Omnivyra** is a production-grade Chrome extension (Manifest V3) for multi-platform social intelligence. It provides real-time analytics and insights from LinkedIn and YouTube within a clean, modular architecture.

### Key Features
- ✅ Multi-platform support (LinkedIn, YouTube)
- ✅ Real-time data collection and analytics
- ✅ Offline event queuing and batch sync
- ✅ Command-driven architecture
- ✅ Pub-sub event system
- ✅ Secure token management
- ✅ Background task execution

---

## Architecture Overview

```
extension/
├── core/                    # Core modules
│   ├── eventBus.js         # Pub-sub event system
│   ├── authBridge.js       # Authentication & token management
│   ├── apiClient.js        # Backend API communication
│   └── commandProcessor.js # Command execution engine
├── platforms/              # Platform-specific modules
│   ├── linkedin/index.js   # LinkedIn data extraction
│   └── youtube/index.js    # YouTube data extraction
├── content_scripts/        # Injected into pages
│   └── main.js            # Entry point, platform detection
├── background/            # Service worker
│   └── serviceWorker.js   # Background tasks, sync, polling
├── storage/              # Data persistence
│   └── storageManager.js # Local & sync storage abstraction
└── manifest.json         # Extension configuration
```

---

## Core Modules

### 1. **eventBus.js** - Pub/Sub Event System
Internal communication hub for all modules.

```javascript
// Subscribe to events
eventBus.on('platform:initialized', (data) => {
  console.log('Platform initialized:', data);
});

// Emit events
eventBus.emit('platform:initialized', { platform: 'linkedin' });

// One-time listener
eventBus.once('user:updated', (data) => {
  console.log('User updated once:', data);
});

// Unsubscribe
const unsubscribe = eventBus.on('event', handler);
unsubscribe();
```

**Key Methods:**
- `on(eventName, listener)` - Subscribe to event
- `once(eventName, listener)` - Subscribe once
- `off(eventName, listener)` - Unsubscribe
- `emit(eventName, data)` - Emit event
- `getEventNames()` - Get all registered events
- `clear()` - Clear all events

---

### 2. **authBridge.js** - Authentication Management
Handles session token management, backend validation, and auth lifecycle.

**Authentication Flow:**
1. Web app sends session token via `window.postMessage` with type `OMNIVYRA_TOKEN`
2. Content script relays message to service worker via `chrome.runtime.sendMessage`
3. Service worker calls `authBridge.acceptSessionToken(tokenData)`
4. authBridge validates token structure and calls backend `/extension/validate` endpoint
5. Backend responds with `{valid, sync_mode, polling_interval}`
6. Extension stores sync config and broadcasts `USER_AUTHENTICATED` to all tabs
7. All subsequent API requests include session token in `Authorization: Bearer <token>` header

```javascript
// Initialize authBridge on extension load
const authState = await authBridge.init();
// Returns: {success: true/false, state: 'authenticated'|'idle'|'invalid'}

// Accept session token from web app (called by service worker)
const result = await authBridge.acceptSessionToken({
  userId: 'user_123',
  orgId: 'org_456',
  sessionToken: 'token_xyz...',
  expiryTime: 1704067200000  // milliseconds
});

// Check if authenticated (validates token expiry)
if (authBridge.isAuthenticated()) {
  console.log('User is authenticated');
}

// Get complete auth state
const auth = authBridge.getAuth();
// Returns: {isAuthenticated, userId, orgId, user, sessionToken, syncConfig}

// Get session token for API calls
const token = authBridge.getSessionToken();

// Get sync configuration from backend
const syncConfig = authBridge.getSyncConfig();
// Returns: {sync_mode: 'realtime'|'batch', polling_interval: 5000}

// Re-validate session with backend
await authBridge.revalidateSession();

// Clear auth state
authBridge.clearAuthState();
```

**Key Methods:**
- `init()` - Initialize from storage, validate with backend
- `acceptSessionToken(tokenData)` - Accept and validate token from web app
- `isAuthenticated()` - Check if authenticated and token not expired
- `getSessionToken()` - Get current session token
- `getAuth()` - Get complete auth object
- `getSyncConfig()` - Get sync configuration from backend
- `revalidateSession()` - Re-validate session with backend
- `clearAuthState()` - Clear all auth data and storage

**Error Handling:**
- Token expiry: `isAuthenticated()` returns false, sync pauses
- 401 from backend: `clearAuthState()` auto-triggered, user logged out
- Invalid token structure: `acceptSessionToken()` returns error
- Backend unreachable: Falls back to 'idle' state, retries on next check

**Backend Endpoints:**
- `POST /extension/validate` - Validate extension session token
  - Request: `{userId, orgId, timestamp}`
  - Response: `{valid, sync_mode, polling_interval}`

---

### 3. **apiClient.js** - Backend Communication
Handles all HTTP communication with Omnivyra backend.

```javascript
// Send analytics events
const result = await apiClient.sendEvents([
  {
    type: 'UserProfileVisit',
    data: { profileId: '123', timestamp: new Date() }
  }
]);

// Fetch commands from backend
const commandResult = await apiClient.fetchCommands();
if (commandResult.success) {
  commandResult.commands.forEach(cmd => {
    commandProcessor.processCommand(cmd);
  });
}

// Report command status
await apiClient.reportCommandStatus(commandId, 'success', { result: 'data' });

// Health check
const health = await apiClient.healthCheck();
console.log('Backend status:', health.success ? 'online' : 'offline');
```

**Key Methods:**
- `sendEvents(events)` - Send batch of events
- `fetchCommands()` - Get pending commands
- `submitCommandResult(id, status, result)` - Submit command result (new)
- `fetchUserProfile()` - Get user data from backend
- `healthCheck()` - Verify backend connectivity

**Features:**
- ✅ Automatic retry with exponential backoff
- ✅ Request timeout handling (30s)
- ✅ Auth token injection
- ✅ 401 error handling (logs out on auth failure)
- ✅ Command result submission to `/extension/action-result` (new)

---

### 4. **commandProcessor.js** - Command Execution Engine

Sophisticated command processing with queuing, retries, and status tracking.

**Features:**
- ✅ Command queuing (FIFO)
- ✅ Sequential execution (one at a time)
- ✅ Automatic retry (max 3 attempts with exponential backoff)
- ✅ Status tracking (pending → executing → success/failed)
- ✅ Result submission to backend
- ✅ EventBus integration for monitoring
- ✅ Timeout protection (30s per attempt)

```javascript
// Register handler for specific platform.action
commandProcessor.registerHandler('linkedin', 'reply_comment', async (payload, metadata, command) => {
  const { postId, commentId, comment } = payload;
  
  // Execute action
  const result = await linkedinPlatform.replyToComment(postId, commentId, comment);
  
  return { success: true, replyId: result.id };
});

// Commands are automatically queued and processed sequentially
// from backend via service worker polling

// Check command status
const status = commandProcessor.getCommandStatus('cmd_123');
// Returns: {status: 'success'|'failed'|'pending'|'executing', attempts, result, error}

// Monitor via events
eventBus.on('command:success', (data) => {
  console.log(`Command ${data.commandId} succeeded in ${data.duration}ms`);
});

eventBus.on('command:failed', (data) => {
  console.log(`Command ${data.commandId} failed: ${data.error}`);
});

// Get queue info
commandProcessor.getQueueLength()           // Pending command count
commandProcessor.getRegisteredHandlers()    // List all handlers
commandProcessor.clearCompletedCommands()   // Cleanup memory
```

**Command Format:**
```javascript
{
  id: "cmd_unique_id",
  platform: "linkedin" | "youtube",
  action: "action_name",
  payload: { /* action-specific data */ },
  metadata: { userId, orgId, timestamp }
}
```

**Status Tracking:**
- `pending` - Queued, awaiting execution
- `executing` - Currently running (may retry)
- `success` - Completed successfully
- `failed` - Failed after all retries

**Retry Logic:**
- Max: 3 attempts
- Timeout: 30 seconds per attempt
- Backoff: Exponential (2s, 4s, 6s between retries)
- Automatic on timeout or handler error

**Events Emitted:**
- `command:queued` - Command added to queue
- `command:executing` - Execution started
- `command:attempt-failed` - Attempt failed, may retry
- `command:success` - Execution succeeded
- `command:failed` - All retries exhausted
- `command:queue-empty` - Queue processing complete

**See Also:** [COMMAND_PROCESSING.md](COMMAND_PROCESSING.md) for complete documentation

---

### 4b. **apiClient.js** - Backend Command Result Submission

```javascript
// Submit command execution result
const result = await apiClient.submitCommandResult(
  'cmd_123',
  'success',
  { replyId: '789', timestamp: Date.now() }
);

// Automatically called by commandProcessor after execution
// Posts to: POST /extension/action-result
```

**Key Methods:**
- `submitCommandResult(commandId, status, result)` - Submit command result

---

### 5. Command Processing Flow - Full Example

Here's how the command system works end-to-end:

**Setup in your module (e.g., platforms/linkedin/index.js):**
```javascript
// Register handlers when platform initializes
linkedinPlatform.registerCommandHandlers = async function() {
  // Handler for comment reply action
  commandProcessor.registerHandler('linkedin', 'reply_comment', async (payload, metadata) => {
    const { postId, commentId, reply } = payload;
    
    // Execute on LinkedIn page
    const result = await this.replyToComment(postId, commentId, reply);
    
    if (!result.success) {
      throw new Error(`Failed to reply: ${result.error}`);
    }
    
    return {
      success: true,
      replyId: result.replyId,
      timestamp: Date.now()
    };
  });
  
  // Handler for profile analysis
  commandProcessor.registerHandler('linkedin', 'analyze_profile', async (payload) => {
    const { profileId } = payload;
    
    const profile = await this.analyzeProfile(profileId);
    
    return {
      profileId,
      analysis: profile,
      analyzedAt: Date.now()
    };
  });
};
```

**Backend sends commands:**
```javascript
// Command 1: Reply to comment
{
  id: "cmd_001_reply_abc",
  platform: "linkedin",
  action: "reply_comment",
  payload: {
    postId: "7192837465982738",
    commentId: "7192837465982738_7192837465982745",
    reply: "Great perspective!"
  }
}

// Command 2: Analyze profile
{
  id: "cmd_002_analyze_def",
  platform: "linkedin",
  action: "analyze_profile",
  payload: {
    profileId: "john-smith-123456"
  }
}
```

**Service worker processes:**
```
[ServiceWorker] Fetched 2 commands
[CommandProcessor] Queued command: cmd_001_reply_abc (position 1)
[CommandProcessor] Queued command: cmd_002_analyze_def (position 2)
[CommandProcessor] Started processing queue

[CommandProcessor] Executing cmd_001_reply_abc (attempt 1/3)
[CommandProcessor] Command succeeded: cmd_001_reply_abc (attempt 1, duration: 1234ms)
[CommandProcessor] Submitting result for cmd_001_reply_abc: success

[CommandProcessor] Executing cmd_002_analyze_def (attempt 1/3)
[CommandProcessor] Command succeeded: cmd_002_analyze_def (attempt 1, duration: 2456ms)
[CommandProcessor] Submitting result for cmd_002_analyze_def: success

[CommandProcessor] Queue processing complete
```

**Results submitted to backend:**
```javascript
// Result 1
POST /extension/action-result
{
  commandId: "cmd_001_reply_abc",
  status: "success",
  result: {
    success: true,
    replyId: "7192837465982758",
    timestamp: 1234567890000
  }
}

// Result 2
POST /extension/action-result
{
  commandId: "cmd_002_analyze_def",
  status: "success",
  result: {
    profileId: "john-smith-123456",
    analysis: {...},
    analyzedAt: 1234567892456
  }
}
```

---

## Authentication Lifecycle

The extension implements a secure session token-based authentication system integrated with the Omnivyra backend.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AUTHENTICATION LIFECYCLE                           │
└─────────────────────────────────────────────────────────────────────────────┘

1. INITIALIZATION (Extension Startup)
   ├─ Service Worker loads auth state from storage
   ├─ If existing token found:
   │  ├─ Backend Validation: POST /extension/validate
   │  ├─ Response: {valid, sync_mode, polling_interval}
   │  └─ If valid=true: Sync tasks configured, state='authenticated'
   │  └─ If valid=false: Auth cleared, state='idle'
   └─ No existing token: state='idle', awaits token from web app

2. TOKEN ACCEPTANCE (Web App Integration)
   ├─ Web app sends: window.postMessage({
   │    type: 'OMNIVYRA_TOKEN',
   │    data: {userId, orgId, sessionToken, expiryTime}
   │  })
   ├─ Content Script intercepts postMessage
   ├─ Content Script relays: chrome.runtime.sendMessage({
   │    action: 'WEB_APP_TOKEN',
   │    data: token data
   │  })
   ├─ Service Worker receives token
   └─ authBridge.acceptSessionToken(tokenData) called

3. TOKEN VALIDATION & STORAGE
   ├─ authBridge validates token structure:
   │  ├─ userId required
   │  ├─ orgId required
   │  ├─ sessionToken required
   │  └─ expiryTime required
   ├─ Backend Validation: POST /extension/validate
   │  └─ Payload: {userId, orgId, timestamp}
   ├─ Wait for Response: {valid, sync_mode, polling_interval}
   └─ If validation succeeds:
      ├─ Store to chrome.storage.local['omnivyra_auth']
      ├─ Store config to ['omnivyra_sync_config']
      ├─ Set state='authenticated'
      └─ Broadcast USER_AUTHENTICATED to all tabs

4. SYNC CONFIGURATION
   ├─ Backend specifies sync_mode:
   │  ├─ 'realtime': Fast polling (half interval) for real-time data
   │  └─ 'batch': Standard polling (full interval) for efficiency
   ├─ Service Worker configures alarms:
   │  ├─ SYNC_EVENT_QUEUE alarm: polling_interval or (polling_interval / 2)
   │  ├─ FETCH_COMMANDS alarm: 10 minutes
   │  └─ HEALTH_CHECK alarm: 30 minutes
   └─ Periodic tasks now authenticate requests using session token

5. API REQUESTS WITH AUTHENTICATION
   ├─ apiClient.makeRequest() checks isAuthenticated()
   ├─ If authenticated:
   │  ├─ Gets sessionToken from authBridge.getSessionToken()
   │  └─ Injects header: Authorization: Bearer <sessionToken>
   ├─ Backend validates token on each request
   └─ If 401 response:
      ├─ authBridge.clearAuthState() called
      ├─ All auth data removed
      ├─ State = 'idle'
      └─ Sync paused until new token provided

6. TOKEN EXPIRY HANDLING
   ├─ authBridge.isAuthenticated() checks:
   │  ├─ Auth state = 'authenticated'
   │  ├─ Current time < expiryTime
   │  └─ sessionToken exists
   ├─ If expired:
   │  ├─ isAuthenticated() returns false
   │  ├─ Sync operations pause
   │  └─ Web app must send new token
   └─ No automatic refresh (token from web app only)

7. SESSION REVALIDATION
   ├─ Hourly: authBridge.revalidateSession() called
   ├─ Sends current session to backend:
   │  └─ POST /extension/validate with current userId/orgId
   ├─ If backend response invalid=true:
   │  ├─ Auth cleared automatically
   │  └─ Sync paused
   └─ If response sync_mode changed:
      └─ Alarm intervals reconfigured
```

### Token Data Format

```javascript
// Web app sends token with this structure:
{
  userId: string,           // User ID from backend
  orgId: string,           // Organization ID
  sessionToken: string,    // Session token (opaque to extension)
  expiryTime: number       // Milliseconds since epoch
}

// Example:
{
  userId: "user_abc123xyz",
  orgId: "org_corp456",
  sessionToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  expiryTime: 1704067200000
}
```

### Backend Validation Endpoint

```
POST /extension/validate

REQUEST:
{
  userId: string,      // From token
  orgId: string,       // From token
  timestamp: number    // Current time (validation freshness check)
}

RESPONSE (on success):
{
  valid: true,
  sync_mode: "realtime|batch",    // Polling strategy
  polling_interval: 5000           // Milliseconds between syncs
}

RESPONSE (on invalid):
{
  valid: false,
  message: "Session invalid or expired"
}

ERROR RESPONSES:
401 Unauthorized - Token invalid/revoked → Clear auth state
400 Bad Request - Missing required fields → Validation error
500 Server Error - Transient backend issue → Retry on next interval
```

### Auth State Values

```javascript
const authState = await authBridge.init();
// Returns specific states:

{
  success: true,
  state: 'authenticated'    // User logged in, token valid, sync active
}

{
  success: true,
  state: 'idle'            // No auth, awaiting token from web app
}

{
  success: true,
  state: 'invalid'         // Auth exists but validation failed
}

{
  success: false,
  state: 'error'           // Backend unreachable during init
}
```

### Usage Example: Web App Integration

```javascript
// In web app (not extension code):

// After user logs in to web app:
function sendTokenToExtension(tokenData) {
  window.postMessage({
    type: 'OMNIVYRA_TOKEN',
    data: {
      userId: user.id,
      orgId: org.id,
      sessionToken: sessionToken,
      expiryTime: Date.now() + (24 * 60 * 60 * 1000)  // 24 hours
    }
  }, '*');
}

// Optional: Listen for token acceptance result
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  if (event.data.type === 'OMNIVYRA_TOKEN_RESULT') {
    console.log('Token result:', event.data.result);
    // {success: true, authenticated: true, syncConfig: {...}}
  }
});
```

---

## Platform Modules

### LinkedIn Platform Module

**File:** `platforms/linkedin/index.js`

Extracts LinkedIn profile, engagement, and connection data.

```javascript
// Initialize
await linkedinPlatform.init();

// Analyze profile
const profileData = await linkedinPlatform.analyzeProfile();
// Returns: { name, headline, location, about, followers, connections, recommendations }

// Analyze feed
const feedData = await linkedinPlatform.analyzeFeed();
// Returns: { posts[], recommendations }

// Extract connections
const connections = await linkedinPlatform.extractConnections();
// Returns: { totalConnections, recentConnections[] }
```

**Auto-Registered Commands:**
- `ANALYZE_LINKEDIN_PROFILE` - Profile analysis
- `ANALYZE_LINKEDIN_FEED` - Feed analysis
- `EXTRACT_LINKEDIN_CONNECTIONS` - Connections extraction

**Detected Page Types:**
- `profile` - /in/ URLs
- `feed` - /feed URLs
- `job` - /jobs/ URLs
- `company` - /company/ URLs
- `other` - Other LinkedIn pages

**Data Extracted:**
- Profile information (name, headline, location, about)
- Engagement metrics (followers, connections, recommendations)
- Feed posts with engagement data
- Recent connections list

---

### YouTube Platform Module

**File:** `platforms/youtube/index.js`

Extracts YouTube video, channel, and engagement data.

```javascript
// Initialize
await youtubePlatform.init();

// Analyze video
const videoData = await youtubePlatform.analyzeVideo();
// Returns: { title, videoId, likes, comments, views, shares, channel info }

// Analyze channel
const channelData = await youtubePlatform.analyzeChannel();
// Returns: { channel info, stats, recentVideos[] }

// Extract engagement metrics
const engagement = await youtubePlatform.extractEngagement();
// Returns: { videoEngagement, channelEngagement, trends }
```

**Auto-Registered Commands:**
- `ANALYZE_YOUTUBE_VIDEO` - Video analysis
- `ANALYZE_YOUTUBE_CHANNEL` - Channel analysis
- `EXTRACT_YOUTUBE_ENGAGEMENT` - Engagement metrics

**Detected Page Types:**
- `watch` - /watch URLs
- `channel` - /channel/ or /@username URLs
- `search` - /results URLs
- `recommendations` - /feed URLs
- `other` - Other YouTube pages

**Data Extracted:**
- Video metadata (title, duration, upload date)
- Engagement metrics (likes, comments, views, shares)
- Channel information and subscriber count
- Recent videos and comment samples
- Engagement trends and analysis

---

## Storage Manager

**File:** `storage/storageManager.js`

Abstraction for Chrome Storage API with caching.

```javascript
// Set and get values
await storageManager.set('key', { data: 'value' }, 'local');
const value = await storageManager.get('key', 'local');

// Get multiple
const data = await storageManager.getMultiple(['key1', 'key2'], 'local');

// Remove or clear
await storageManager.remove('key', 'local');
await storageManager.clear('local');

// Settings
await storageManager.saveSettings({
  dataCollection: true,
  sendAnalytics: true,
  updateFrequency: 3600000
});
const settings = await storageManager.loadSettings();

// Event queuing (for offline support)
await storageManager.queueEvents([event1, event2]);
const queue = await storageManager.getQueuedEvents();
await storageManager.removeQueuedEvents([id1, id2]);

// Watch for changes
storageManager.watchStorage((changes, areaName) => {
  console.log('Storage changed:', changes);
}, 'local');

// Storage stats
const stats = await storageManager.getStorageStats();
// Returns: { bytesUsed, bytesQuota }
```

**Key Methods:**
- `set(key, value, type)` - Store value
- `get(key, type)` - Retrieve value
- `getMultiple(keys, type)` - Get multiple values
- `remove(key, type)` - Delete value
- `clear(type)` - Clear all storage
- `queueEvents(events)` - Queue events
- `getQueuedEvents()` - Get queued events
- `watchStorage(callback, type)` - Watch for changes

**Storage Types:**
- `'local'` - Local storage (large quota)
- `'sync'` - Sync storage (shared across devices)

---

## Content Script

**File:** `content_scripts/main.js`

Injected into LinkedIn and YouTube pages.

```javascript
// Automatic initialization on page load
// 1. Detects platform
// 2. Initializes platform module
// 3. Sets up message listeners
// 4. Monitors page changes
// 5. Collects data periodically

// Send data request to service worker
const response = await chrome.runtime.sendMessage({
  action: 'REQUEST_PAGE_DATA'
});

// Execute command
const result = await chrome.runtime.sendMessage({
  action: 'EXECUTE_COMMAND',
  command: { id: '1', type: 'ANALYZE_PROFILE', payload: {} }
});

// Trigger platform action
const response = await chrome.runtime.sendMessage({
  action: 'PLATFORM_ACTION',
  action: 'analyze_profile',
  payload: {}
});
```

**Message Actions:**
- `EXECUTE_COMMAND` - Run command from service worker
- `REQUEST_PAGE_DATA` - Request analyzed page data
- `PLATFORM_ACTION` - Trigger platform-specific action
- `PING` - Test content script availability

**Events Emitted:**
- `platform:initialized` - Platform module ready
- `linkedin:pageChanged` - LinkedIn page type changed
- `youtube:pageChanged` - YouTube page type changed
- `page:changed` - Any page URL changed

---

## Service Worker

**File:** `background/serviceWorker.js`

Background task handler with periodic sync and authentication management.

```javascript
// Service worker initializes on extension startup
// 1. Loads auth state from storage
// 2. Validates session with backend (/extension/validate)
// 3. Configures sync tasks based on backend response
// 4. Sets up periodic sync, command polling, and health checks
// 5. Listens for messages from content scripts and web app

// Receive message from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle different actions
  // QUEUE_EVENT, SYNC_NOW, FETCH_COMMANDS_NOW, GET_STATS, etc.
  // ACCEPT_SESSION_TOKEN, GET_AUTH_STATE, REVALIDATE_SESSION
});

// Accept session token from web app (relayed via content script)
// Triggered when: Web app sends window.postMessage with type 'OMNIVYRA_TOKEN'
// Result: Validates with backend, configures sync, broadcasts USER_AUTHENTICATED

// Periodic tasks (handled automatically based on sync config)
// - Event queue sync (configurable, 5-30 min interval based on sync_mode)
// - Command polling (10 min interval)
// - Health checks (30 min interval)
// - Session revalidation (hourly when authenticated)

// Get extension stats
const stats = await chrome.runtime.sendMessage({
  action: 'GET_STATS'
});
// Returns: { isInitialized, lastSync, activeContentScripts, queuedEvents, storage, isAuthenticated }
```

**Periodic Tasks:**
- **Event Queue Sync** (configurable) - Send queued events to backend
  - Realtime mode (sync_mode='realtime'): Syncs at half the polling interval for faster response
  - Batch mode (sync_mode='batch'): Syncs at standard polling interval for efficiency
- **Command Polling** (10 min) - Fetch and execute commands
- **Health Check** (30 min) - Verify backend connectivity
- **Session Revalidation** (hourly) - Re-validate auth session with backend

**Message Actions:**
- `QUEUE_EVENT` - Add event to queue
- `SYNC_NOW` - Immediate sync
- `FETCH_COMMANDS_NOW` - Immediate command fetch
- `GET_STATS` - Get extension statistics
- `ACCEPT_SESSION_TOKEN` - Accept and validate session token
- `GET_AUTH_STATE` - Get current authentication state
- `REVALIDATE_SESSION` - Re-validate with backend

**Authentication Integration:**
- Waits for `ACCEPT_SESSION_TOKEN` message before starting event sync
- Pauses sync tasks if `isAuthenticated()` returns false
- Handles 401 responses from backend (triggers auth cleanup)
- Broadcasts `USER_AUTHENTICATED` message to all tabs on successful token acceptance
- `TRIGGER_PLATFORM_ACTION` - Send action to content script
- `CONTENT_SCRIPT_READY` - Register content script

**Features:**
- ✅ Offline event queuing
- ✅ Automatic event batching
- ✅ Command execution with timeout
- ✅ Content script tracking
- ✅ Health monitoring

---

## Communication Flow

### Event Collection Flow
```
1. Content Script (Page)
   ↓ Analyzes page data
2. Queues event via sendMessage
   ↓
3. Service Worker
   ↓ Stores in event queue
4. Periodic sync (5 min)
   ↓ Batches events
5. API Client
   ↓ Sends to backend
6. Backend
   ↓ Processes events
```

### Command Processing Flow
```
1. Backend
   ↓ Creates command
2. Service Worker
   ↓ Polls /commands/pending (10 min)
3. Fetches commands
   ↓
4. CommandProcessor
   ↓ Routes to handler
5. Content Script (or local handler)
   ↓ Executes command
6. Reports status
   ↓
7. Backend callback
```

### Authentication Flow
```
1. Login request (email, password)
   ↓
2. Backend authenticates
   ↓ Returns token + expiry
3. AuthBridge stores token
   ↓ Sets expiry timer
4. API Client adds to requests
   ↓
5. Backend validates
   ↓ If expired: refresh flow
6. AuthBridge refreshes token
   ↓ Updates storage
```

---

## Configuration

### Manifest V3 Configuration

File: `manifest.json`

**Permissions:**
- `storage` - Access Chrome Storage API
- `scripting` - Inject scripts
- `activeTab` - Access active tab

**Host Permissions:**
- `*://www.linkedin.com/*` - LinkedIn access
- `*://www.youtube.com/*` - YouTube access
- `*://api.omnivyra.io/*` - Backend API (placeholder)

**Content Scripts:**
- Runs on `linkedin.com` and `youtube.com`
- Loaded at `document_start` (early injection)
- Single frame only (not in iframes)

---

## Usage Examples

### Example 1: Initialize and Authenticate

```javascript
// In service worker or popup
await authBridge.init();

const result = await authBridge.login('user@example.com', 'password');
if (result.success) {
  console.log('Logged in as:', result.user.name);
  
  // Start syncing
  await storageManager.saveSyncState({ status: 'active' });
}
```

### Example 2: Send Custom Event

```javascript
// From content script
const event = {
  type: 'CustomAnalysis',
  platform: 'linkedin',
  data: {
    profileId: 'user123',
    engagementScore: 8.5,
    timestamp: new Date().toISOString()
  }
};

// Queue for sync
await chrome.runtime.sendMessage({
  action: 'QUEUE_EVENT',
  event: event
});

// Service worker will batch and send it
```

### Example 3: Register Custom Command Handler

```javascript
// In content script on LinkedIn
commandProcessor.registerHandler('CUSTOM_LINKEDIN_ACTION', async (payload) => {
  const profileData = await linkedinPlatform.analyzeProfile();
  const customResult = await processCustomLogic(profileData, payload);
  return customResult;
});

// Backend can now send:
// {
//   "id": "cmd_456",
//   "type": "CUSTOM_LINKEDIN_ACTION",
//   "payload": { "option": "value" }
// }
```

### Example 4: Event Bus Communication

```javascript
// Module A: Listen for auth changes
eventBus.on('auth:changed', (authState) => {
  if (authState.isLoggedIn) {
    console.log('User logged in, start sync');
    syncEventQueue();
  }
});

// Module B: Emit auth change
authBridge.login(email, password).then(result => {
  if (result.success) {
    eventBus.emit('auth:changed', { isLoggedIn: true, user: result.user });
  }
});
```

---

## Data Retention & Privacy

- **Local Storage:** Events cached until successfully sent
- **Sync Storage:** Settings synced across Chrome profiles
- **Session:** Auth tokens stored with expiry
- **Offline Support:** Events queued locally, synced when online

---

## Error Handling

### API Errors
```javascript
try {
  const result = await apiClient.sendEvents(events);
  if (!result.success) {
    console.error('Send failed:', result.message);
    // Events remain queued for retry
  }
} catch (error) {
  console.error('Network error:', error);
  // Auto-retry with exponential backoff
}
```

### Command Errors
```javascript
// Command timeout (30 sec)
// Failed command marked as failed in batch result
const results = await commandProcessor.processBatch(commands);
results.forEach(r => {
  if (r.status === 'failed') {
    console.error(`Command ${r.commandId}: ${r.error}`);
  }
});
```

### Auth Errors
```javascript
// 401 Unauthorized → logout
// Token expired → auto-refresh
const token = await authBridge.getValidToken();
// Returns valid token or null if refresh fails
```

---

## Performance Optimization

1. **Event Batching:** Group events, send in 50-event batches
2. **Caching:** 1-hour TTL on storage reads
3. **Debouncing:** Page monitoring every 500ms-1sec
4. **Timeouts:** 30-second command execution timeout
5. **Offline Support:** Queue events, don't lose data

---

## Debugging

### View Service Worker Logs
```
chrome://extensions → Omnivyra → inspect views → service worker
```

### View Content Script Logs
```
Open DevTools (F12) on LinkedIn/YouTube page
Look for [ContentScript] logs
```

### View Storage
```
chrome://extensions → Omnivyra → inspect → Application → Storage
```

### Simulate Offline
```
DevTools → Network → set to "Offline"
Events will queue automatically
```

---

## Deployment Checklist

- [ ] Update backend API endpoint in `apiClient.js`
- [ ] Configure permission domains in `manifest.json`
- [ ] Test on Linux/Mac (included in submission bundle)
- [ ] Generate extension icons (16x16, 48x48, 128x128)
- [ ] Package for Chrome Web Store
- [ ] Enable service worker debugging as needed

---

## Quick Start

1. **Install extension**
   ```
   chrome://extensions → Load unpacked → Select /extension folder
   ```

2. **Login**
   - Visit Facebook Omni popup
   - Enter credentials
   - Token stored automatically

3. **Navigate to LinkedIn/YouTube**
   - Content script injects
   - Platform module initializes
   - Data collection begins

4. **Monitor sync**
   - Service worker syncs every 5 min
   - Check chrome://extensions for logs
   - View queued events in storage

---

## Support & Maintenance

- Module documentation included in code comments
- Production logging via console (remove in production)
- Error boundaries around all async operations
- Graceful degradation when APIs unavailable

---

## License

© 2026 Omnivyra. All rights reserved.
