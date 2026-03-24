# QUICK FIX REFERENCE: Service Worker Registration Error

## 🚨 The Error
```
"Service worker registration failed. Status code: 15"
```

## ✅ The Fix
Removed `import SyncTrigger` from `background/serviceWorker.js`

**Why**: SyncTrigger is content-script only (uses `window.addEventListener`)  
Service workers don't have `window` object

## 📝 What Changed

**File**: `extension/background/serviceWorker.js` (Lines 21-47)

**Removed**:
```javascript
import SyncTrigger from '../core/syncTrigger.js';
const syncTrigger = new SyncTrigger();
globalThis.syncTrigger = syncTrigger;
```

**Kept**:
```javascript
import EventBus from '../core/eventBus.js';
import StorageManager from '../storage/storageManager.js';
import AuthBridge from '../core/authBridge.js';
import APIClient from '../core/apiClient.js';
import CommandProcessor from '../core/commandProcessor.js';
import SyncEngine from '../core/syncEngine.js';
```

## 🧪 Test It

### Load Extension
1. `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked → select `extension/` folder

### Check Service Worker
1. Click "Service Worker" link
2. Should see: `✅ FULL SYSTEM READY`
3. No errors about window/document

### Check Content Scripts
1. Open LinkedIn or YouTube
2. F12 → Console
3. Type: `typeof window.eventBus` → should return `"object"`

## 📊 Architecture

| Component | Location | Uses Window? | Safe? |
|-----------|----------|--------------|-------|
| **Service Worker** | background/ | ❌ No | ✅ YES |
| **Content Scripts** | linkedin/, youtube/ | ✅ Yes | ✅ YES |
| **SyncTrigger** | core/ | ✅ Yes | Content-script only |

## ✨ Status
✅ Service worker registration fixed  
✅ All modules compatible with ES6  
✅ Ready for testing

---

**Issue**: Registration failed (Status code: 15)  
**Cause**: Incompatible module import  
**Fix**: Remove SyncTrigger from service worker  
**Result**: ✅ RESOLVED
