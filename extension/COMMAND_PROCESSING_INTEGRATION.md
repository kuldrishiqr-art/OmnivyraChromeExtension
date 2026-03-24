# Command Processing System - Integration Guide

## Overview

This guide explains how to integrate the command processing system into the Omnivyra Chrome extension for real-world use cases.

## Quick Start

### 1. Initialize Command Handlers

When your platform module (e.g., `platforms/linkedin/index.js`) initializes:

```javascript
async function init() {
  // ... existing initialization code ...

  // Register all command handlers for this platform
  registerLinkedInCommandHandlers();

  console.log('[LinkedIn] Initialized with command handlers');
}

function registerLinkedInCommandHandlers() {
  // Handler 1: Reply to comment
  commandProcessor.registerHandler('linkedin', 'reply_comment', async (payload) => {
    const { postId, commentId, reply } = payload;
    
    // Your implementation here
    const result = await linkedinPlatform.replyToComment(postId, commentId, reply);
    
    return {
      success: true,
      replyId: result.id,
      timestamp: Date.now()
    };
  });

  // Handler 2: Like post
  commandProcessor.registerHandler('linkedin', 'like_post', async (payload) => {
    const { postId } = payload;
    
    const result = await linkedinPlatform.likePost(postId);
    
    return {
      success: true,
      liked: result.liked,
      timestamp: Date.now()
    };
  });

  // Add more handlers as needed...
}
```

### 2. Backend Sends Commands

Your backend fetches pending commands and sends them. The service worker automatically polls for commands every 10 minutes:

```javascript
// Backend sends:
GET /extension/commands

// Returns:
{
  commands: [
    {
      id: "cmd_001",
      platform: "linkedin",
      action: "reply_comment",
      payload: {
        postId: "7192837465",
        commentId: "7192837465_7192838000",
        reply: "Great post!"
      }
    },
    {
      id: "cmd_002",
      platform: "linkedin",
      action: "like_post",
      payload: {
        postId: "7192837465"
      }
    }
  ]
}
```

### 3. Service Worker Queues Commands

The service worker automatically fetches commands and queues them:

```javascript
[ServiceWorker] Fetched 2 commands
[CommandProcessor] Command queued: cmd_001 (position 1)
[CommandProcessor] Command queued: cmd_002 (position 2)
[CommandProcessor] Started processing queue
```

### 4. Commands Execute Sequentially

The processor executes commands one at a time:

```javascript
[CommandProcessor] Executing cmd_001 (attempt 1/3)
[CommandProcessor] Command succeeded: cmd_001 (1234ms)
[CommandProcessor] Submitting result for cmd_001: success

[CommandProcessor] Executing cmd_002 (attempt 1/3)
[CommandProcessor] Command succeeded: cmd_002 (567ms)
[CommandProcessor] Submitting result for cmd_002: success

[CommandProcessor] Queue processing complete
```

### 5. Results Submitted to Backend

Results are automatically submitted:

```javascript
// Command 1 result
POST /extension/action-result
{
  commandId: "cmd_001",
  status: "success",
  result: {
    success: true,
    replyId: "7192838001",
    timestamp: 1692547890000
  }
}

// Command 2 result
POST /extension/action-result
{
  commandId: "cmd_002",
  status: "success",
  result: {
    success: true,
    liked: true,
    timestamp: 1692547891567
  }
}
```

## Common Patterns

### Pattern 1: Simple Action Handler

```javascript
commandProcessor.registerHandler('youtube', 'subscribe', async (payload) => {
  const { channelUrl } = payload;
  
  // Navigate to channel
  await youtubePlatform.navigateToChannel(channelUrl);
  
  // Perform action
  const result = await youtubePlatform.subscribe();
  
  // Return structured result
  return {
    success: result.success,
    channelUrl,
    subscribedAt: Date.now()
  };
});
```

### Pattern 2: Multi-Step Handler with Error Handling

```javascript
commandProcessor.registerHandler('linkedin', 'profile_engagement', async (payload) => {
  const { profileId, actions } = payload;
  
  const results = {
    profileId,
    completed: [],
    failed: []
  };
  
  try {
    // Navigate to profile
    await linkedinPlatform.navigateToProfile(profileId);
    
    // Execute each action
    for (const action of actions) {
      try {
        let result;
        
        switch (action.type) {
          case 'like':
            result = await linkedinPlatform.likeProfile();
            results.completed.push({ type: 'like', success: true });
            break;
          case 'message':
            result = await linkedinPlatform.sendMessage(action.message);
            results.completed.push({ type: 'message', success: true });
            break;
          case 'connect':
            result = await linkedinPlatform.sendConnection();
            results.completed.push({ type: 'connect', success: true });
            break;
        }
      } catch (actionError) {
        results.failed.push({
          type: action.type,
          error: actionError.message
        });
      }
    }
    
    results.success = results.completed.length > 0;
    return results;
    
  } catch (error) {
    results.success = false;
    results.error = error.message;
    throw error;
  }
});
```

### Pattern 3: Long-Running Handler with Monitoring

```javascript
commandProcessor.registerHandler('youtube', 'monitor_engagement', async (payload) => {
  const { videoId, durationSeconds } = payload;
  
  const startTime = Date.now();
  const engagementData = {
    videoId,
    startedAt: startTime,
    duration: durationSeconds,
    snapshots: []
  };
  
  while (Date.now() - startTime < (durationSeconds * 1000)) {
    // Get current engagement metrics
    const metrics = await youtubePlatform.getEngagementMetrics(videoId);
    
    engagementData.snapshots.push({
      timestamp: Date.now(),
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments
    });
    
    // Wait before next snapshot
    await new Promise(r => setTimeout(r, 10000)); // Every 10 seconds
  }
  
  return engagementData;
});
```

### Pattern 4: Handler with Input Validation

```javascript
commandProcessor.registerHandler('linkedin', 'validated_action', async (payload, metadata) => {
  // Validate required fields
  const required = ['targetId', 'action'];
  for (const field of required) {
    if (!payload[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  // Validate action is known
  const validActions = ['like', 'comment', 'share'];
  if (!validActions.includes(payload.action)) {
    throw new Error(`Invalid action: ${payload.action}`);
  }
  
  // Validate payload shape
  if (payload.action === 'comment' && !payload.comment) {
    throw new Error('Comment text required for comment action');
  }
  
  // Execute validated action
  const result = await executeValidatedAction(payload);
  
  return {
    success: true,
    actionId: generateId(),
    ...result
  };
});
```

## Monitoring Command Execution

### Listen for All Events

```javascript
// Queue event
eventBus.on('command:queued', (data) => {
  console.log(`📥 Queued: ${data.commandId} (position ${data.position})`);
  logToAnalytics('command_queued', { commandId: data.commandId });
});

// Execution started
eventBus.on('command:executing', (data) => {
  console.log(`⚙️ Executing: ${data.commandId} (${data.platform}.${data.action}, attempt ${data.attempt})`);
});

// Attempt failed
eventBus.on('command:attempt-failed', (data) => {
  console.log(`⚠️ Attempt ${data.attempt} failed: ${data.error}`);
  if (data.willRetry) {
    console.log(`   Will retry...`);
  }
});

// Success
eventBus.on('command:success', (data) => {
  console.log(`✅ Success: ${data.commandId}`);
  console.log(`   Platform: ${data.platform}`, `Action: ${data.action}`);
  console.log(`   Duration: ${data.duration}ms`, `Attempt: ${data.attempt}`);
  logToAnalytics('command_success', {
    commandId: data.commandId,
    duration: data.duration,
    attempts: data.attempt
  });
});

// Failed permanently
eventBus.on('command:failed', (data) => {
  console.error(`❌ Failed: ${data.commandId}`);
  console.error(`   Error: ${data.error}`);
  console.error(`   Attempts: ${data.attempts}`, `Total time: ${data.duration}ms`);
  logToAnalytics('command_failed', {
    commandId: data.commandId,
    error: data.error,
    attempts: data.attempts
  });
});

// Queue empty
eventBus.on('command:queue-empty', () => {
  console.log(`✨ All commands processed`);
});

// Handler registered
eventBus.on('command:handler-registered', (data) => {
  console.log(`📝 Handler registered: ${data.platform}.${data.action}`);
});
```

### Dashboard Monitoring

```javascript
function createCommandDashboard() {
  return {
    queueLength: commandProcessor.getQueueLength(),
    registeredHandlers: commandProcessor.getRegisteredHandlers(),
    totalHandlers: commandProcessor.getRegisteredHandlers().length,
    getStatus: (commandId) => commandProcessor.getCommandStatus(commandId)
  };
}

// Use in UI
const dashboard = createCommandDashboard();
console.log(`Pending commands: ${dashboard.queueLength}`);
console.log(`Registered handlers: ${dashboard.totalHandlers}`);
```

## Error Cases and Recovery

### Timeout Handling

```javascript
// Handler that might timeout
commandProcessor.registerHandler('platform', 'slow_action', async (payload) => {
  // This might exceed 30-second timeout
  const result = await verySlowOperation();
  return result;
});

// Retry automatically happens:
// Attempt 1: Timeout → Wait 2s → Retry
// Attempt 2: Timeout → Wait 4s → Retry
// Attempt 3: Timeout → Failed
```

### Network Error Recovery

```javascript
// Handler with transient failures
commandProcessor.registerHandler('platform', 'network_operation', async (payload) => {
  try {
    // This might fail due to network
    const result = await apiCall();
    return result;
  } catch (error) {
    if (error.name === 'NetworkError' || error.code === 'ECONNREFUSED') {
      // Throw to trigger retry
      throw new Error(`Network error: ${error.message}`);
    } else {
      // Don't retry for permanent errors
      throw new Error(`Permanent error: ${error.message}`);
    }
  }
});
```

### Metadata Access

```javascript
// Handler can access metadata about the command
commandProcessor.registerHandler('platform', 'metadata_aware', async (payload, metadata, command) => {
  console.log('Command ID:', command.id);
  console.log('User ID:', metadata.userId);
  console.log('Org ID:', metadata.orgId);
  console.log('Timestamp:', metadata.timestamp);
  console.log('Priority:', metadata.priority);
  
  // Execute based on priority
  const timeLimit = metadata.priority === 'high' ? 15000 : 30000;
  
  // Your implementation...
});
```

## Backend Integration

### Expected Command Format

```javascript
// Backend should send commands in this format
{
  id: "unique_command_id",
  platform: "linkedin" | "youtube" | "other",
  action: "action_name",
  payload: {
    // Action-specific fields
    // Examples:
    // { postId, commentId, reply } for reply_comment
    // { videoId } for analyze_video
    // { profileUrl } for analyze_profile
  },
  metadata: {
    userId: "...",
    orgId: "...",
    timestamp: 1692547890000,
    priority: "high" | "normal" | "low"  // Optional
  }
}
```

### Expected Result Format

```javascript
// Backend should expect results in this format
{
  commandId: "unique_command_id",
  status: "success" | "failed",
  result: {
    // Success: Any data returned by handler
    // Example: { success: true, replyId: "...", timestamp: 1692547890000 }
    
    // Failure: Error details
    // Example: { error: "Network timeout", attempts: 3 }
  },
  timestamp: 1692547890000
}
```

### Example Backend Handler

```javascript
// In your backend (Node.js / Express example)

app.post('/extension/action-result', async (req, res) => {
  const { commandId, status, result, timestamp } = req.body;
  
  // Store result
  await database.commandResults.insert({
    commandId,
    status,
    result,
    timestamp,
    receivedAt: new Date()
  });
  
  // If failed, mark for retry
  if (status === 'failed') {
    await database.commands.updateOne(
      { id: commandId },
      { 
        lastError: result.error,
        attempts: database.inc(1),
        lastAttemptAt: new Date()
      }
    );
  }
  
  res.json({ success: true });
});
```

## Testing Commands Locally

### Manual Testing in Console

```javascript
// Register a test handler
commandProcessor.registerHandler('test', 'hello', async (payload) => {
  return {
    success: true,
    message: 'Hello from test handler',
    received: payload
  };
});

// Queue test command
await commandProcessor.enqueueCommands([
  {
    id: 'test_001',
    platform: 'test',
    action: 'hello',
    payload: { greeting: 'Hi there' }
  }
]);

// Monitor in console:
// [CommandProcessor] Command queued: test_001
// [CommandProcessor] Executing test_001 (attempt 1/3)
// [CommandProcessor] Command succeeded: test_001 (23ms)
```

### Simulate Failures

```javascript
// Register handler that fails
commandProcessor.registerHandler('test', 'fail', async (payload) => {
  throw new Error('Intentional failure for testing');
});

// Queue command
await commandProcessor.enqueueCommands([
  {
    id: 'test_fail_001',
    platform: 'test',
    action: 'fail',
    payload: {}
  }
]);

// Watch retry process:
// [CommandProcessor] Executing test_fail_001 (attempt 1/3)
// [CommandProcessor] Command failed (attempt 1/3): test_fail_001 - Intentional failure
// [CommandProcessor] Retrying in 2000ms...
// [CommandProcessor] Executing test_fail_001 (attempt 2/3)
// ... (repeat for attempt 3)
// [CommandProcessor] Command failed after all retries: test_fail_001
```

## Performance Tips

1. **Keep handlers fast**: Aim for < 5 seconds
2. **Use meaningful payloads**: Include only necessary data
3. **Handle errors gracefully**: Throw on recoverable errors
4. **Clean up periodically**: Call `clearCompletedCommands()` after processing batches
5. **Monitor queue**: Check `getQueueLength()` to detect backups

## Troubleshooting

### Commands Not Executing

1. Check handler registration:
   ```javascript
   console.log(commandProcessor.getRegisteredHandlers());
   ```

2. Verify authentication:
   ```javascript
   console.log(authBridge.isAuthenticated());
   ```

3. Check queue status:
   ```javascript
   console.log(`Queue length: ${commandProcessor.getQueueLength()}`);
   ```

### Commands Timing Out

1. Check handler complexity
2. Increase timeout if necessary (in CommandProcessor.js)
3. Break long operations into smaller steps

### Results Not Reaching Backend

1. Verify endpoint exists: `/extension/action-result`
2. Check network in DevTools
3. Verify authentication is still valid

## Summary

The command processing system provides:
- ✅ Sequential execution with guaranteed order
- ✅ Automatic retry with exponential backoff
- ✅ Complete status tracking
- ✅ Event-driven monitoring
- ✅ Seamless backend integration
- ✅ Comprehensive error handling

For complete documentation, see [COMMAND_PROCESSING.md](COMMAND_PROCESSING.md)
