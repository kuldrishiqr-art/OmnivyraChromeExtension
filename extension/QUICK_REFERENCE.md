# Omnivyra Extension - Quick Reference Card

## File Structure at a Glance

```
extension/
├── manifest.json              ← Extension configuration (MV3)
├── README.md                  ← Full documentation
├── CONFIGURATION.md           ← Setup & customization guide
│
├── core/                      ← Core business logic
│   ├── eventBus.js           (Pub/Sub system)
│   ├── authBridge.js         (Auth & token management)
│   ├── apiClient.js          (Backend communication)
│   └── commandProcessor.js   (Command routing & execution)
│
├── platforms/                 ← Platform-specific handlers
│   ├── linkedin/
│   │   └── index.js          (LinkedIn data extraction)
│   └── youtube/
│       └── index.js          (YouTube data extraction)
│
├── content_scripts/           ← Injected into pages
│   └── main.js               (Platform detection & init)
│
├── background/                ← Service worker
│   └── serviceWorker.js      (Sync, commands, polling)
│
└── storage/                   ← Data persistence
    └── storageManager.js     (Storage abstraction)
```

---

## Key Concepts

| Concept | Purpose | Files |
|---------|---------|-------|
| **EventBus** | Pub-sub event system for internal communication | `eventBus.js` |
| **AuthBridge** | User auth + token management + refresh | `authBridge.js` |
| **APIClient** | HTTP requests to backend + retry logic | `apiClient.js` |
| **CommandProcessor** | Routes commands from backend to handlers | `commandProcessor.js` |
| **StorageManager** | Chrome Storage API abstraction + caching | `storageManager.js` |
| **Content Script** | Injects into LinkedIn/YouTube pages | `main.js` |
| **Service Worker** | Background tasks + sync + polling | `serviceWorker.js` |
| **Platform Modules** | Extract data from specific platforms | `platforms/` |

---

## Communication Patterns

### Pattern 1: Event Emission (Loose Coupling)
```javascript
// Anywhere
eventBus.emit('user:logged_in', { user });

// Anywhere else
eventBus.on('user:logged_in', (data) => {
  console.log('User logged in:', data.user);
});
```

### Pattern 2: Direct Method Calls (Core Modules)
```javascript
const token = await authBridge.getValidToken();
await apiClient.sendEvents([...]);
await commandProcessor.processCommand(cmd);
```

### Pattern 3: Message Passing (Main ↔ Service Worker)
```javascript
// From anywhere
chrome.runtime.sendMessage({
  action: 'QUEUE_EVENT',
  event: { type, data }
});

// Service worker receives
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // handle request
});
```

---

## Module Initialization Order

```
1. Service Worker starts
   → Initializes authBridge from storage
   → Sets up alarms for periodic tasks
   → Listens for messages

2. Content Script injects (on LinkedIn/YouTube)
   → Detects platform
   → Loads platform module
   → Sets up message listener
   → Begins data collection

3. On User Action
   → Events queued in storage
   → Service worker batches events
   → Periodic sync sends to backend
   → Backend sends commands
   → Service worker processes commands
   → Content script executes
```

---

## Command Processing Quick Reference

### Register a Command Handler
```javascript
// Handler for platform.action
commandProcessor.registerHandler('linkedin', 'reply_comment', async (payload, metadata) => {
  const { postId, commentId, reply } = payload;
  const result = await linkedinPlatform.replyToComment(postId, commentId, reply);
  return { success: true, replyId: result.id };
});
```

### Queue Commands for Processing
```javascript
// Commands are automatically queued when fetched by service worker
// Or manually queue commands:
const queuedCount = await commandProcessor.enqueueCommands(commands);
console.log(`Queued ${queuedCount} commands`);
```

### Check Queue Status
```javascript
const queueLength = commandProcessor.getQueueLength();
console.log(`Pending: ${queueLength}`);

// Get specific command status
const status = commandProcessor.getCommandStatus('cmd_123');
// {status, attempts, result, error, createdAt, startedAt, completedAt}
```

### Get Registered Handlers
```javascript
const handlers = commandProcessor.getRegisteredHandlers();
// Returns: ['linkedin.reply_comment', 'linkedin.like_post', 'youtube.subscribe', ...]
```

### Monitor Command Execution
```javascript
eventBus.on('command:queued', (data) => {
  console.log(`Queued: ${data.commandId}`);
});

eventBus.on('command:success', (data) => {
  console.log(`Success: ${data.commandId} (${data.duration}ms)`);
});

eventBus.on('command:failed', (data) => {
  console.log(`Failed: ${data.commandId} - ${data.error}`);
});
```

### Cleanup Completed Commands
```javascript
const cleared = commandProcessor.clearCompletedCommands();
console.log(`Cleared ${cleared} completed commands`);
```

---

## Command Status Tracking

### Web App Sends Token to Extension
```javascript
// In web app, after user login:
window.postMessage({
  type: 'OMNIVYRA_TOKEN',
  data: {
    userId: 'user_123',
    orgId: 'org_456',
    sessionToken: 'eyJ...',
    expiryTime: Date.now() + (24 * 60 * 60 * 1000)
  }
}, '*');
```

### Check Authentication Status
```javascript
// Anywhere in extension:
if (authBridge.isAuthenticated()) {
  console.log('User is authenticated');
} else {
  console.log('User not authenticated');
}
```

### Get Full Auth State
```javascript
const auth = authBridge.getAuth();
// {isAuthenticated, userId, orgId, user, sessionToken, syncConfig}
```

### Get Session Token for API Calls
```javascript
const token = authBridge.getSessionToken();
// Returns token or null if not authenticated
```

### Get Sync Configuration
```javascript
const config = authBridge.getSyncConfig();
// {sync_mode: 'realtime'|'batch', polling_interval: 5000}
```

### Re-validate Session
```javascript
await authBridge.revalidateSession();
// Checks with backend if current session is still valid
```

### Clear Auth (Logout)
```javascript
authBridge.clearAuthState();
// Removes all auth data, state returns to 'idle'
```

---

## API Endpoints Required

Backend must implement these endpoints:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/extension/validate` | ✗* | Validate extension session token |
| POST | `/analytics/events` | ✓ | Send collected events |
| GET | `/commands/pending` | ✓ | Fetch pending commands |
| POST | `/commands/{id}/status` | ✓ | Report command execution |
| GET | `/user/profile` | ✓ | Fetch user profile |
| GET | `/health` | ✗ | Health check |

*`/extension/validate` needs unique request body with userId/orgId, not Bearer token

---

## Common Tasks

### Register a Command Handler
```javascript
commandProcessor.registerHandler('MY_COMMAND', async (payload) => {
  // Execute command
  return { result: 'value' };
});
```

### Listen for Events
```javascript
eventBus.on('platform:initialized', (data) => {
  console.log('Platform ready:', data.platform);
});
```

### Send Event to Backend
```javascript
await apiClient.sendEvents([{
  type: 'UserInteraction',
  data: { action, timestamp }
}]);
```

### Persist Data
```javascript
await storageManager.set('key', value, 'local');
const data = await storageManager.get('key', 'local');
```

### Extract Platform Data
```javascript
// LinkedIn
const profile = await linkedinPlatform.analyzeProfile();

// YouTube
const video = await youtubePlatform.analyzeVideo();
```

---

## Debugging

### Check Service Worker Logs
```
chrome://extensions
→ Omnivyra [Details]
→ "Inspect views" → service_worker
```

### Check Content Script Logs
```
Open page (linkedin.com or youtube.com)
F12 → Console
Filter: [ContentScript]
```

### View Storage Data
```
DevTools → Application → Storage
→ Chrome Storage → Local/Sync
```

### Simulate Offline
```
DevTools → Network
→ Throttling: Offline
Events auto-queue and sync when back online
```

---

## Event Flow Diagram

```
Browser Page (LinkedIn/YouTube)
        ↓
Content Script
        ↓ Analyzes page
Queue Event (sendMessage)
        ↓
Service Worker
        ↓ Stores in Chrome Storage
Event Buffer
        ↓ Every 5 min: batch
API Client
        ↓ POST /analytics/events
Backend
        ↓ Processes analytics
Dashboard
```

---

## Command Flow Diagram

```
Backend
        ↓ Creates command
POST /commands/pending
        ↓ Service Worker polls (10 min)
Fetch Commands
        ↓
CommandProcessor
        ↓ Routes to handler
Platform Module
        ↓ Executes
POST /commands/{id}/status
        ↓ Backend callback
Done
```

---

## Auth/Token Flow

```
User Login (Service Worker/Storage)
        ↓
authBridge.login(email, password)
        ↓ POST /auth/login
Backend
        ↓ Returns {token, expiresIn}
Store in Chrome Storage
        ↓
APIClient adds to requests
        ↓
Backend validates
        ↓ If expired: auto-refresh
authBridge.refreshToken()
        ↓ POST /auth/refresh
Get new token
```

---

## Key Constants & Configs

### Service Worker Timings
- Event Sync: **5 minutes**
- Command Poll: **10 minutes**
- Health Check: **30 minutes**
- Event Batch Size: **50 events**
- Header Batch Timeout: **1 minute**
- Command Timeout: **30 seconds**

### Token Management
- Default expiry: **1 hour**
- Auto-refresh: **Before expiry**
- Storage type: **Chrome Storage (encrypted)**

### Storage Limits
- Local: **10 MB** (unlimited with permission)
- Sync: **100 KB** (per profile)

---

## Environment Setup

### Development
- Backend: `http://localhost:3000`
- Sync: Every 1 minute
- Logging: DEBUG level

### Production
- Backend: `https://api.omnivyra.io`
- Sync: Every 5 minutes
- Logging: ERROR level

---

## Permissions

```javascript
"permissions": [
  "storage",        // Chrome Storage API
  "scripting",      // Inject scripts
  "activeTab"       // Access current tab
]

"host_permissions": [
  "*://www.linkedin.com/*",
  "*://www.youtube.com/*",
  "*://api.omnivyra.io/*"
]
```

---

## Testing Checklist

- [ ] Content script loads on LinkedIn & YouTube
- [ ] Platform module initializes correctly
- [ ] Events queued to storage
- [ ] Service worker syncs events
- [ ] Auth token persists
- [ ] Token refresh works
- [ ] Commands fetch and execute
- [ ] Offline queuing works
- [ ] Online recovery works
- [ ] Page data extracted correctly
- [ ] No console errors
- [ ] Storage quota reasonable

---

## Production Deployment

1. **Update Backend URL**
   - `apiClient.js` baseURL

2. **Update Permissions**
   - `manifest.json` host_permissions

3. **Remove Debug Logs**
   - Or set logLevel config

4. **Add Icons**
   - 16x16, 48x48, 128x128

5. **Test All Platforms**
   - LinkedIn full flow
   - YouTube full flow
   - Offline/online transitions
   - Auth refresh

6. **Package Extension**
   - Generate `.zip` for store

7. **Setup Monitoring**
   - Error tracking (Sentry, etc.)
   - Analytics dashboard
   - Performance monitoring

---

## Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| Content script not loading | Check manifest.json host_permissions |
| Commands not executing | Verify handler registered with commandProcessor |
| Events not syncing | Check auth token (refresh if needed) |
| Storage quota full | Clear old events after 24 hours |
| Network errors | Check backend endpoint & CORS |
| Token expired | Check refresh endpoint implementation |

---

## Useful Resources

- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration](https://developer.chrome.com/docs/extensions/mv3/)
- [Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)
- [Service Workers](https://developer.chrome.com/docs/extensions/reference/service_workers/)

---

## Support

For detailed information:
- See `README.md` for complete documentation
- See `CONFIGURATION.md` for setup & customization
- Check inline code comments in each module

---

**Version:** 1.0.0  
**Last Updated:** 2026-03-23  
**Architecture:** Manifest V3
