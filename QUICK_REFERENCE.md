# QUICK REFERENCE: Content Script ES6 Fix

## ⚡ The Problem
```
"Uncaught SyntaxError: Unexpected token 'export'"
```
Content scripts don't support ES6 export/import syntax.

## ⚡ The Solution
Converted 8 modules from ES6 exports to global window pattern.

## ⚡ Files Changed
| File | Old | New |
|------|-----|-----|
| core/eventBus.js | `export default EventBus` | `window.eventBus = new EventBus()` |
| core/authBridge.js | `export default AuthBridge` | `window.authBridge = new AuthBridge()` |
| core/apiClient.js | `export default APIClient` | `window.apiClient = new APIClient()` |
| core/commandProcessor.js | `export default CommandProcessor` | `window.commandProcessor = new CommandProcessor()` |
| core/syncEngine.js | `export default SyncEngine` | `window.syncEngine = new SyncEngine()` |
| core/syncTrigger.js | `export default SyncTrigger` | `window.syncTrigger = new SyncTrigger()` |
| storage/storageManager.js | `export default StorageManager` | `window.storageManager = new StorageManager()` |
| platforms/linkedin/scraper.js | `const linkedinScraper = ...` | `window.linkedinScraper = new LinkedInScraper()` |

## ⚡ How It Works
**manifest.json specifies load order** → Each script executes → Objects attach to `window` → All available for `main.js`

## ⚡ Test in Console
```javascript
typeof window.eventBus          // "object" ✅
typeof window.storageManager    // "object" ✅
typeof window.authBridge        // "object" ✅
// ... etc
```

## ⚡ Expected Result
✅ No syntax errors  
✅ All window.* objects available  
✅ Content scraping works  
✅ Event sync works  
✅ Commands process  

## ⚡ Service Worker (Unchanged)
Still uses ES6 imports - this is CORRECT for background service workers.

---

**Status**: READY FOR TESTING ✅
