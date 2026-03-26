/**
 * MODULAR CONTENT RUNTIME
 *
 * Single content-script entry point for LinkedIn and YouTube.
 * Uses the core auth/API/command stack directly from the manifest load order.
 */

const PLATFORM_HOSTS = {
  linkedin: 'linkedin.com',
  youtube: 'youtube.com'
};

let activePlatformName = null;
let activePlatform = null;

function detectPlatform() {
  const hostname = window.location.hostname;

  if (hostname.includes(PLATFORM_HOSTS.linkedin)) {
    return 'linkedin';
  }

  if (hostname.includes(PLATFORM_HOSTS.youtube)) {
    return 'youtube';
  }

  return null;
}

async function init() {
  try {
    activePlatformName = detectPlatform();
    if (!activePlatformName) {
      return;
    }

    if (typeof authBridge !== 'undefined') {
      await authBridge.init();
    }

    activePlatform = getPlatformInstance(activePlatformName);
    if (activePlatform && typeof activePlatform.init === 'function' && !activePlatform.isInitialized) {
      await activePlatform.init();
    }

    registerRuntimeHandlers();
    registerPageAuthBridge();

    console.log('[ContentRuntime] Ready', {
      platform: activePlatformName,
      authenticated: typeof authBridge !== 'undefined' && authBridge.isAuthenticated()
    });
  } catch (error) {
    console.error('[ContentRuntime] Initialization failed:', error);
  }
}

function getPlatformInstance(platformName) {
  if (platformName === 'linkedin' && typeof linkedinPlatform !== 'undefined') {
    return linkedinPlatform;
  }

  if (platformName === 'youtube' && typeof youtubePlatform !== 'undefined') {
    return youtubePlatform;
  }

  return null;
}

function registerRuntimeHandlers() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleRuntimeMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message
        });
      });

    return true;
  });
}

async function handleRuntimeMessage(message) {
  if (!message || !message.action) {
    return { success: false, error: 'Invalid message' };
  }

  switch (message.action) {
    case 'EXECUTE_COMMAND':
      return await executeCommands(message.payload);

    case 'AUTH_STATE_UPDATED':
      if (typeof authBridge !== 'undefined') {
        await authBridge.init();
      }
      return { success: true };

    case 'GET_RUNTIME_STATUS':
      return {
        success: true,
        platform: activePlatformName,
        authenticated: typeof authBridge !== 'undefined' && authBridge.isAuthenticated(),
        handlers:
          typeof commandProcessor !== 'undefined' &&
          typeof commandProcessor.getRegisteredHandlers === 'function'
            ? commandProcessor.getRegisteredHandlers()
            : []
      };

    default:
      return { success: false, error: `Unknown action: ${message.action}` };
  }
}

async function executeCommands(payload = {}) {
  if (typeof commandProcessor === 'undefined') {
    return { success: false, error: 'Command processor unavailable' };
  }

  const commands = Array.isArray(payload.commands)
    ? payload.commands
    : payload.command
      ? [payload.command]
      : [];

  if (commands.length === 0) {
    return { success: false, error: 'No commands provided' };
  }

  const queuedCount = await commandProcessor.enqueueCommands(commands);

  return {
    success: queuedCount > 0,
    accepted: queuedCount > 0,
    queuedCount
  };
}

function registerPageAuthBridge() {
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || typeof event.data !== 'object') {
      return;
    }

    if (event.data.type === 'OMNIVYRA_TOKEN') {
      const tokenPayload = event.data.payload || event.data.tokenData || event.data;
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'ACCEPT_SESSION_TOKEN',
          payload: tokenPayload
        });

        if (result?.success && typeof authBridge !== 'undefined') {
          await authBridge.init();
        }

        window.postMessage(
          {
            type: 'OMNIVYRA_EXTENSION_AUTH_RESULT',
            payload: result
          },
          '*'
        );
      } catch (error) {
        window.postMessage(
          {
            type: 'OMNIVYRA_EXTENSION_AUTH_RESULT',
            payload: {
              success: false,
              message: error.message
            }
          },
          '*'
        );
      }
    }

    if (event.data.type === 'OMNIVYRA_REQUEST_AUTH_STATE') {
      const auth =
        typeof authBridge !== 'undefined' && typeof authBridge.getAuth === 'function'
          ? authBridge.getAuth()
          : { isAuthenticated: false };

      window.postMessage(
        {
          type: 'OMNIVYRA_EXTENSION_AUTH_STATE',
          payload: auth
        },
        '*'
      );
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
