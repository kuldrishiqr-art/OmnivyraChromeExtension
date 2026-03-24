# Command Processing System

## Overview

The Omnivyra Chrome extension includes a sophisticated command processing system that:
- Queues commands from the backend
- Executes them sequentially with proper ordering
- Implements automatic retry logic (max 3 attempts)
- Tracks detailed status and execution metrics
- Reports results back to the backend
- Emits events for monitoring and logging

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     COMMAND PROCESSING FLOW                      │
└──────────────────────────────────────────────────────────────────┘

1. FETCHING
   Service Worker (10 min interval)
   ↓
   apiClient.fetchCommands() → GET /extension/commands
   ↓
   
2. QUEUING
   commandProcessor.enqueueCommands(commands)
   ↓
   [Command Queue] (FIFO)
   ↓
   
3. SEQUENTIAL PROCESSING
   For each command in queue:
   ├─ Validate command structure
   ├─ Update status → "pending"
   ├─ Emit "command:queued" event
   ├─ Execute with retries
   │  └─ Max 3 attempts with exponential backoff
   ├─ On success:
   │  ├─ status → "success"
   │  ├─ Emit "command:success" event
   │  └─ Submit result
   ├─ On failure (all retries):
   │  ├─ status → "failed"
   │  ├─ Emit "command:failed" event
   │  └─ Submit error result
   └─ Move to next command
   
4. RESULT SUBMISSION
   apiClient.submitCommandResult() → POST /extension/action-result
   ↓
   Backend acknowledges and stores result
```

## Command Format

Commands fetched from backend should follow this format:

```javascript
{
  // Required fields
  id: "cmd_uuid_or_unique_id",           // Unique command identifier
  platform: "linkedin" | "youtube",       // Target platform
  action: "action_name",                  // Action to perform
  payload: {                              // Action-specific data
    // Action-dependent fields
    // Example: {profileId: "...", comment: "..."}
  },
  
  // Optional fields
  metadata: {                             // Optional metadata
    userId: "...",                        // User ID Who issued command
    orgId: "...",                         // Organization ID
    timestamp: 1234567890000,            // When command was created
    priority: "high" | "normal" | "low"  // Optional priority
  }
}
```

## Handler Registration

Handlers are registered per platform and action combination:

```javascript
// Register handler for LinkedIn reply_comment action
commandProcessor.registerHandler('linkedin', 'reply_comment', async (payload, metadata, command) => {
  const { comment, postId } = payload;
  
  // Perform action
  const result = await linkedinPlatform.replyToComment(postId, comment);
  
  // Return result (will be sent to backend)
  return {
    commentId: result.id,
    success: true,
    timestamp: Date.now()
  };
});

// Register handler for YouTube analyze_video action
commandProcessor.registerHandler('youtube', 'analyze_video', async (payload, metadata, command) => {
  const { videoId } = payload;
  
  // Perform action
  const analysis = await youtubePlatform.analyzeVideo(videoId);
  
  // Return result
  return {
    videoId,
    analysis,
    analyzedAt: Date.now()
  };
});
```

## Status Tracking

### Command Status Flow

```
pending → executing → success  (one-time for result submission)
              ↓
            (retry 1)
              ↓
          executing → success  (if retry succeeds)
              ↓
            (retry 2)
              ↓
          executing → success  (if retry succeeds)
              ↓
            (retry 3)
              ↓
          executing → failed   (if final retry fails)
```

### Retrieving Command Status

```javascript
// Get status of specific command
const commandStatus = commandProcessor.getCommandStatus('cmd_123');

// Returns:
{
  command: {...},                    // Original command object
  status: 'pending'|'executing'|'success'|'failed',
  attempts: 0-3,                     // Number of attempts made
  result: {...} | null,              // Execution result if success
  error: "error message" | null,     // Error message if failed
  createdAt: 1234567890000,         // When command was queued
  startedAt: 1234567891000,         // When execution started
  completedAt: 1234567894000        // When execution completed
}
```

## Retry Mechanism

### Retry Configuration

- **Max Retries**: 3 attempts total
- **Execution Timeout**: 30 seconds per attempt
- **Backoff Strategy**: Exponential (2s × attempt number)
  - Retry 1: Wait 2 seconds
  - Retry 2: Wait 4 seconds
  - Retry 3: Wait 6 seconds

### Retry Events

Each retry attempt emits events:

```javascript
// On execution start
eventBus.emit('command:executing', {
  commandId: 'cmd_123',
  platform: 'linkedin',
  action: 'reply_comment',
  attempt: 1  // 1, 2, or 3
});

// On attempt failure
eventBus.emit('command:attempt-failed', {
  commandId: 'cmd_123',
  platform: 'linkedin',
  action: 'reply_comment',
  attempt: 1,
  error: 'Timeout exceeded',
  willRetry: true  // false only on final attempt
});
```

## Event System Integration

The command processor emits events throughout the lifecycle via eventBus:

```javascript
// Command queued in queue
eventBus.on('command:queued', (data) => {
  const { commandId, position } = data;
  console.log(`Command ${commandId} is at position ${position} in queue`);
});

// Command execution started
eventBus.on('command:executing', (data) => {
  const { commandId, platform, action, attempt } = data;
  console.log(`Executing ${platform}.${action} (attempt ${attempt})`);
});

// Attempt failed (may retry)
eventBus.on('command:attempt-failed', (data) => {
  const { commandId, attempt, error, willRetry } = data;
  if (willRetry) {
    console.log(`Attempt ${attempt} failed, retrying...`);
  } else {
    console.log(`All retries exhausted for ${commandId}`);
  }
});

// Command succeeded
eventBus.on('command:success', (data) => {
  const { commandId, result, attempt, duration } = data;
  console.log(`${commandId} succeeded on attempt ${attempt} in ${duration}ms`);
});

// Command failed permanently
eventBus.on('command:failed', (data) => {
  const { commandId, error, attempts, duration } = data;
  console.log(`${commandId} failed after ${attempts} attempts (${duration}ms)`);
});

// Queue is now empty
eventBus.on('command:queue-empty', () => {
  console.log('All commands processed');
});

// Handler registered
eventBus.on('command:handler-registered', (data) => {
  const { platform, action } = data;
  console.log(`Handler registered for ${platform}.${action}`);
});

// Processing progress
eventBus.on('command:progress', (data) => {
  const { queueLength } = data;
  console.log(`Queue length: ${queueLength}`);
});
```

## Backend Integration

### Fetch Commands Endpoint

```
GET /extension/commands

Response:
{
  success: true,
  commands: [...]
}
```

### Submit Result Endpoint

```
POST /extension/action-result

Request Body:
{
  commandId: "cmd_123",
  status: "success" | "failed",
  result: {...},  // Execution result or error details
  timestamp: 1234567890000
}

Response:
{
  success: true,
  message: "Result recorded"
}
```

## Usage Examples

### Example 1: LinkedIn Comment Reply

Backend sends command:
```javascript
{
  id: "cmd_abc123",
  platform: "linkedin",
  action: "reply_comment",
  payload: {
    postId: "7123456789",
    commentId: "7123456789_7123456800",
    comment: "Great insight!"
  }
}
```

Extension handles it:
```javascript
// Register handler
commandProcessor.registerHandler('linkedin', 'reply_comment', async (payload) => {
  const { postId, commentId, comment } = payload;
  
  // Execute on page
  const result = await linkedinPlatform.replyToComment(postId, commentId, comment);
  
  return {
    success: true,
    replyId: result.id,
    timestamp: Date.now()
  };
});
```

Result sent to backend:
```javascript
{
  commandId: "cmd_abc123",
  status: "success",
  result: {
    success: true,
    replyId: "7123456789_7123456810",
    timestamp: 1234567890000
  }
}
```

### Example 2: Retry on Transient Error

```javascript
commandProcessor.registerHandler('youtube', 'collect_metadata', async (payload) => {
  const { videoId } = payload;
  
  // This might fail temporarily due to rate limiting
  const metadata = await youtubePlatform.getVideoMetadata(videoId);
  
  if (!metadata) {
    throw new Error('Failed to fetch metadata');  // Will trigger retry
  }
  
  return { videoId, metadata };
});
```

Flow:
1. Attempt 1: Fails with rate limit error → Wait 2s
2. Attempt 2: Fails with rate limit error → Wait 4s
3. Attempt 3: Succeeds → Returns metadata

### Example 3: Monitoring Command Execution

```javascript
// Listen for all command events
eventBus.on('command:queued', (data) => {
  console.log(`[QUEUE] ${data.commandId} queued at position ${data.position}`);
});

eventBus.on('command:executing', (data) => {
  console.log(`[EXEC] ${data.commandId} (attempt ${data.attempt}/${MAX_RETRIES})`);
});

eventBus.on('command:success', (data) => {
  console.log(`[OK] ${data.commandId} succeeded in ${data.duration}ms`);
});

eventBus.on('command:failed', (data) => {
  console.log(`[FAIL] ${data.commandId} failed: ${data.error}`);
});
```

## Queue Management

### Check Queue Status

```javascript
// Get current queue length
const queueLength = commandProcessor.getQueueLength();
console.log(`Pending commands: ${queueLength}`);

// Get specific command status
const status = commandProcessor.getCommandStatus('cmd_123');
console.log(status);

// List all registered handlers
const handlers = commandProcessor.getRegisteredHandlers();
console.log('Available handlers:', handlers);
```

### Cleanup

```javascript
// Clear completed commands to free memory
const cleared = commandProcessor.clearCompletedCommands();
console.log(`Cleared ${cleared} completed commands`);
```

## Error Handling

### Timeout Errors

If a command exceeds the 30-second execution timeout:

```javascript
// Automatically triggers retry
// After 3 attempts, marked as failed
// Error message: "Command execution timeout after 30000ms"
```

### Handler Not Found

If no handler registered for platform.action:

```javascript
// Command fails immediately without retries
// Error message: "No handler found for linkedin.reply_comment"
```

### Backend Submission Failure

If result cannot be submitted to backend:

```javascript
// Command marked as executed locally
// Logged for manual review
// Will not retry submission (handled in future request)
```

## Performance Considerations

### Sequential Processing

Commands execute one at a time in FIFO order:
- **Advantage**: Consistent, predictable, minimal concurrency issues
- **Disadvantage**: Slower for independent commands
- **Use Case**: Commands that may interfere with each other or need to maintain order

### Memory Optimization

```javascript
// Clear completed commands after they're sent
commandProcessor.clearCompletedCommands();

// Or manually remove specific command tracking
// (Use only if you're sure you won't need the data)
```

### Logging and Debugging

All actions logged with `[CommandProcessor]` prefix:
```
[CommandProcessor] Command queued: cmd_123
[CommandProcessor] Executing command cmd_123 - attempt 1/3
[CommandProcessor] Command failed (attempt 1/3): cmd_123 - Timeout
[CommandProcessor] Command succeeded: cmd_123
[CommandProcessor] Submitting result for cmd_123: success
```

View logs in:
- Service Worker console: `chrome://extensions → Omnivyra → Inspect views → service_worker`
- Command processor directly handles logging

## Configuration Reference

```javascript
// In commandProcessor.js
class CommandProcessor {
  static MAX_RETRIES = 3;              // Maximum retry attempts
  static EXECUTION_TIMEOUT = 30000;    // 30 seconds per attempt
  static RETRY_DELAY = 2000;           // Base delay for exponential backoff
}
```

To customize, modify class constants before instantiation.

## Migration from Old System

### Old Handler Registration (Deprecated)

```javascript
commandProcessor.registerHandler('ANALYZE_PROFILE', handler);
```

### New Handler Registration

```javascript
commandProcessor.registerHandler('linkedin', 'analyze', handler);
```

**Backwards Compatibility**: Old format still works but new format is recommended.

## Troubleshooting

### Commands Not Processing

1. Check if service worker is running: `chrome://extensions → Omnivyra → Inspect views`
2. Verify authentication: `authBridge.isAuthenticated()` should be `true`
3. Check handler registration: `commandProcessor.getRegisteredHandlers()`

### Commands Timing Out

1. Increase timeout in CommandProcessor (for long operations)
2. Optimize handler execution time
3. Check network conditions in DevTools

### Results Not Reaching Backend

1. Verify `/extension/action-result` endpoint exists
2. Check `apiClient.submitCommandResult()` logs
3. Ensure authentication is valid

## API Reference

```javascript
// REGISTRATION
commandProcessor.registerHandler(platform, action, handler)
commandProcessor.registerHandlerLegacy(type, handler)  // Deprecated
commandProcessor.clearHandler(key)
commandProcessor.getRegisteredHandlers()

// QUEUING
commandProcessor.enqueueCommands(commands)  // Returns queuedCount
commandProcessor.processBatch(commands)     // Deprecated, use enqueueCommands
commandProcessor.processCommand(command)    // Deprecated, use enqueueCommands

// STATUS
commandProcessor.getQueueLength()
commandProcessor.getCommandStatus(commandId)
commandProcessor.clearCompletedCommands()
```
