/**
 * CONTENT SCRIPT BOOTSTRAP
 * 
 * Dynamically loads all core modules as ES6 modules into the content script context.
 * This allows modules to have export statements while being used in content scripts.
 */

console.log('[ContentScript] Bootstrap loading modules as ES6 modules');

// Determine platform
const hostname = window.location.hostname;
const platform = hostname.includes('linkedin.com') ? 'linkedin' : 
                hostname.includes('youtube.com') ? 'youtube' : 'unknown';

// List of common modules to load in dependency order
const COMMON_MODULES = [
  'core/eventBus.js',
  'storage/storageManager.js',
  'core/authBridge.js',
  'core/apiClient.js',
  'core/commandProcessor.js',
  'core/syncEngine.js',
  'core/syncTrigger.js'
];

// Platform-specific modules
const PLATFORM_MODULES = {
  linkedin: 'platforms/linkedin/index.js',
  youtube: 'platforms/youtube/index.js'
};

// Track module loading state
window.__omnivyraModulesLoaded = false;

/**
 * Load a module as an ES6 module and execute it in window context
 */
async function loadModuleAsES6(modulePath) {
  return new Promise((resolve, reject) => {
    try {
      const script = document.createElement('script');
      script.type = 'module';
      
      // Get the correct URL for the module
      const moduleUrl = chrome.runtime.getURL(modulePath);
      console.log(`[ContentScript] Loading module from: ${moduleUrl}`);
      script.src = moduleUrl;
      
      script.onload = () => {
        console.log(`[ContentScript] ✓ Module loaded: ${modulePath}`);
        resolve();
      };
      
      script.onerror = (event) => {
        console.error(`[ContentScript] ✗ Failed to load ${modulePath}`, {
          event: event,
          src: script.src
        });
        reject(new Error(`Failed to load module: ${modulePath}`));
      };
      
      // Append to document head (more reliable than documentElement)
      const target = document.head || document.documentElement || document.body;
      if (target) {
        target.appendChild(script);
      } else {
        reject(new Error('No document target found'));
      }
    } catch (error) {
      console.error(`[ContentScript] Error creating script for ${modulePath}:`, error);
      reject(error);
    }
  });
}

/**
 * Load all modules in sequence
 */
async function loadAllModules() {
  try {
    console.log(`[ContentScript] Platform: ${platform}`);
    console.log(`[ContentScript] Document ready: ${document.readyState}`);
    
    // Load common modules
    for (const modulePath of COMMON_MODULES) {
      console.log(`[ContentScript] Loading: ${modulePath}`);
      try {
        await loadModuleAsES6(modulePath);
      } catch (error) {
        console.warn(`[ContentScript] Warning: Could not load ${modulePath}, continuing...`);
        // Continue loading other modules even if one fails
      }
    }
    
    // Load platform-specific module
    if (PLATFORM_MODULES[platform]) {
      console.log(`[ContentScript] Loading platform module: ${PLATFORM_MODULES[platform]}`);
      try {
        await loadModuleAsES6(PLATFORM_MODULES[platform]);
      } catch (error) {
        console.warn(`[ContentScript] Warning: Could not load platform module for ${platform}`);
      }
    } else {
      console.warn(`[ContentScript] Unknown platform: ${platform}`);
    }
    
    window.__omnivyraModulesLoaded = true;
    console.log('[ContentScript] All modules loaded successfully');
    
    // Load the main content script once modules are ready
    await loadModuleAsES6('content_scripts/main.js');
  } catch (error) {
    console.error('[ContentScript] Failed to load modules:', error);
  }
}

// Start loading modules when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadAllModules);
} else {
  loadAllModules();
}
