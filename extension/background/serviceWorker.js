/**
 * MODULAR SERVICE WORKER
 *
 * Single background runtime for auth validation, command polling, and
 * dispatching platform commands to active LinkedIn/YouTube tabs.
 */

importScripts(
  '../core/authBridge.js',
  '../core/apiClient.js'
);

const ALARMS = {
  commandPoll: 'omnivyra-command-poll',
  healthCheck: 'omnivyra-health-check',
  authRevalidate: 'omnivyra-auth-revalidate'
};

const ALARM_SCHEDULE_MINUTES = {
  commandPoll: 1,
  healthCheck: 5,
  authRevalidate: 30
};

async function init() {
  try {
    if (typeof authBridge !== 'undefined') {
      await authBridge.init();
    }

    scheduleAlarms();
    console.log('[ServiceWorker] Ready');
  } catch (error) {
    console.error('[ServiceWorker] Initialization failed:', error);
  }
}

function scheduleAlarms() {
  chrome.alarms.create(ALARMS.commandPoll, {
    periodInMinutes: ALARM_SCHEDULE_MINUTES.commandPoll
  });

  chrome.alarms.create(ALARMS.healthCheck, {
    periodInMinutes: ALARM_SCHEDULE_MINUTES.healthCheck
  });

  chrome.alarms.create(ALARMS.authRevalidate, {
    periodInMinutes: ALARM_SCHEDULE_MINUTES.authRevalidate
  });
}

chrome.runtime.onInstalled.addListener(() => {
  init();
});

chrome.runtime.onStartup.addListener(() => {
  init();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        success: false,
        message: error.message
      });
    });

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARMS.commandPoll) {
    pollCommands();
    return;
  }

  if (alarm.name === ALARMS.healthCheck) {
    runHealthCheck();
    return;
  }

  if (alarm.name === ALARMS.authRevalidate) {
    revalidateAuth();
  }
});

async function handleMessage(message) {
  if (!message || !message.action) {
    return { success: false, message: 'Invalid message' };
  }

  switch (message.action) {
    case 'ACCEPT_SESSION_TOKEN': {
      const result = await authBridge.acceptSessionToken(message.payload || {});
      await broadcastAuthState();
      return result;
    }

    case 'GET_AUTH_STATE':
      return {
        success: true,
        auth: authBridge.getAuth()
      };

    case 'POLL_COMMANDS':
      await pollCommands();
      return { success: true };

    case 'RUN_HEALTH_CHECK':
      return await runHealthCheck();

    default:
      return { success: false, message: `Unknown action: ${message.action}` };
  }
}

async function pollCommands() {
  try {
    if (!authBridge.isAuthenticated()) {
      return;
    }

    const result = await apiClient.fetchCommands();
    if (!result.success || !Array.isArray(result.commands) || result.commands.length === 0) {
      return;
    }

    for (const command of result.commands) {
      await dispatchCommand(command);
    }
  } catch (error) {
    console.error('[ServiceWorker] Command poll failed:', error);
  }
}

async function dispatchCommand(command) {
  const tabs = await findPlatformTabs(command.platform);

  if (tabs.length === 0) {
    await apiClient.submitCommandResult(command.id, 'failed', {
      error: `No open ${command.platform} tab available for command dispatch`
    });
    return;
  }

  for (const tab of prioritizeTabs(tabs)) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'EXECUTE_COMMAND',
        payload: {
          commands: [command]
        }
      });

      if (response?.accepted) {
        return;
      }
    } catch (error) {
      console.warn(`[ServiceWorker] Tab ${tab.id} did not accept command ${command.id}:`, error.message);
    }
  }

  await apiClient.submitCommandResult(command.id, 'failed', {
    error: `Unable to dispatch command ${command.id} to any ${command.platform} tab`
  });
}

async function findPlatformTabs(platform) {
  if (platform === 'linkedin') {
    return await chrome.tabs.query({ url: '*://www.linkedin.com/*' });
  }

  if (platform === 'youtube') {
    return await chrome.tabs.query({ url: '*://www.youtube.com/*' });
  }

  return [];
}

function prioritizeTabs(tabs) {
  return [...tabs].sort((left, right) => {
    if (left.active === right.active) {
      return 0;
    }

    return left.active ? -1 : 1;
  });
}

async function broadcastAuthState() {
  const tabs = await chrome.tabs.query({
    url: ['*://www.linkedin.com/*', '*://www.youtube.com/*']
  });

  await Promise.all(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.id, {
        action: 'AUTH_STATE_UPDATED'
      }).catch(() => null)
    )
  );
}

async function runHealthCheck() {
  try {
    const health = await apiClient.healthCheck();
    return {
      success: true,
      authenticated: authBridge.isAuthenticated(),
      backend: health
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

async function revalidateAuth() {
  try {
    if (!authBridge.isAuthenticated()) {
      return;
    }

    const result = await authBridge.revalidateSession();
    if (!result.valid) {
      await broadcastAuthState();
    }
  } catch (error) {
    console.error('[ServiceWorker] Auth revalidation failed:', error);
  }
}

init();
