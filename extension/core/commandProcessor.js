/**
 * COMMAND PROCESSOR - Backend Command Execution Engine
 * 
 * Implements full command lifecycle:
 * 1. Queue commands from backend
 * 2. Execute sequentially with retry mechanism
 * 3. Track status: pending → executing → success/failed
 * 4. Report results back to backend
 * 5. Emit events via eventBus
 * 
 * Command Format:
 * {
 *   id: string,
 *   platform: "linkedin" | "youtube",
 *   action: string,
 *   payload: object,
 *   metadata: {userId, orgId, timestamp, etc}
 * }
 */

class CommandProcessor {
  // ========================================================================
  // CONFIGURATION
  // ========================================================================

  static MAX_RETRIES = 3;
  static EXECUTION_TIMEOUT = 30000; // 30 seconds
  static RETRY_DELAY = 2000; // 2 seconds base delay

  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================

  constructor() {
    // Map of platform.action -> handler function
    this.handlers = new Map();

    // Command queue and tracking
    this.commandQueue = [];
    this.commandStore = new Map(); // id -> { command, status, attempts, result, error }
    this.isProcessing = false;
    this.currentCommand = null;

    console.log('[CommandProcessor] Initialized');
  }

  // ========================================================================
  // HANDLER MANAGEMENT
  // ========================================================================

  /**
   * Register command handler
   * @param {string} platform - Platform name (e.g., 'linkedin', 'youtube')
   * @param {string} action - Action name (e.g., 'reply_comment', 'analyze_profile')
   * @param {Function} handler - Async function to execute the command
   */
  registerHandler(platform, action, handler) {
    const key = `${platform}.${action}`;
    this.handlers.set(key, handler);
    console.log(`[CommandProcessor] Handler registered: ${key}`);

    // Emit event for handler registration
    if (typeof eventBus !== 'undefined') {
      eventBus.emit('command:handler-registered', { platform, action });
    }
  }

  /**
   * Legacy method for backwards compatibility (deprecated)
   * Use registerHandler(platform, action, handler) instead
   */
  registerHandlerLegacy(commandType, handler) {
    this.handlers.set(commandType, handler);
    console.log(`[CommandProcessor] Legacy handler registered: ${commandType}`);
  }

  /**
   * Get all registered handlers
   * @returns {string[]} Array of "platform.action" keys
   */
  getRegisteredHandlers() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clear specific handler or all handlers
   * @param {string|null} key - Handler key (e.g., 'linkedin.reply_comment'), or null for all
   */
  clearHandler(key = null) {
    if (key) {
      this.handlers.delete(key);
      console.log(`[CommandProcessor] Handler cleared: ${key}`);
    } else {
      this.handlers.clear();
      console.log(`[CommandProcessor] All handlers cleared`);
    }
  }

  // ========================================================================
  // QUEUE MANAGEMENT
  // ========================================================================

  /**
   * Add commands to queue
   * @param {Array<object>} commands - Commands to queue
   * @returns {Promise<number>} Number of commands queued
   */
  async enqueueCommands(commands) {
    if (!Array.isArray(commands)) {
      return 0;
    }

    let queuedCount = 0;

    for (const command of commands) {
      if (this.validateCommand(command)) {
        this.commandQueue.push(command);
        
        // Initialize command tracking
        this.commandStore.set(command.id, {
          command,
          status: 'pending',
          attempts: 0,
          result: null,
          error: null,
          createdAt: Date.now(),
          startedAt: null,
          completedAt: null
        });

        queuedCount++;

        // Emit event
        if (typeof eventBus !== 'undefined') {
          eventBus.emit('command:queued', { commandId: command.id, position: this.commandQueue.length });
        }

        console.log(`[CommandProcessor] Command queued: ${command.id} (platform: ${command.platform}, action: ${command.action})`);
      }
    }

    console.log(`[CommandProcessor] Queued ${queuedCount} commands (queue length: ${this.commandQueue.length})`);

    // Start processing if not already processing
    if (!this.isProcessing) {
      this.processQueue();
    }

    return queuedCount;
  }

  /**
   * Validate command structure
   * @private
   * @param {object} command - Command to validate
   * @returns {boolean}
   */
  validateCommand(command) {
    if (!command || typeof command !== 'object') {
      console.error('[CommandProcessor] Invalid command: not an object');
      return false;
    }

    const required = ['id', 'platform', 'action', 'payload'];
    for (const field of required) {
      if (!command[field]) {
        console.error(`[CommandProcessor] Invalid command: missing ${field}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Get current queue length
   * @returns {number}
   */
  getQueueLength() {
    return this.commandQueue.length;
  }

  /**
   * Get command tracking info
   * @param {string} commandId - Command ID
   * @returns {object|null} Command tracking data or null
   */
  getCommandStatus(commandId) {
    return this.commandStore.get(commandId) || null;
  }

  /**
   * Clear completed commands from store
   * @returns {number} Number of commands cleared
   */
  clearCompletedCommands() {
    let cleared = 0;
    for (const [id, data] of this.commandStore.entries()) {
      if (data.status === 'success' || data.status === 'failed') {
        this.commandStore.delete(id);
        cleared++;
      }
    }
    console.log(`[CommandProcessor] Cleared ${cleared} completed commands`);
    return cleared;
  }

  // ========================================================================
  // SEQUENTIAL PROCESSING
  // ========================================================================

  /**
   * Process command queue sequentially
   * @private
   */
  async processQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    console.log('[CommandProcessor] Started processing queue');

    try {
      while (this.commandQueue.length > 0) {
        const command = this.commandQueue.shift();
        this.currentCommand = command;

        // Process with retries
        await this.processCommandWithRetry(command);

        // Emit progress event
        if (typeof eventBus !== 'undefined') {
          eventBus.emit('command:progress', {
            queueLength: this.commandQueue.length,
            processing: false
          });
        }
      }
    } finally {
      this.isProcessing = false;
      this.currentCommand = null;
      console.log('[CommandProcessor] Queue processing complete');

      // Emit completion event
      if (typeof eventBus !== 'undefined') {
        eventBus.emit('command:queue-empty', {});
      }
    }
  }

  /**
   * Process single command with retry logic
   * @private
   * @param {object} command - Command to process
   */
  async processCommandWithRetry(command) {
    const trackingData = this.commandStore.get(command.id);
    if (!trackingData) {
      console.error(`[CommandProcessor] No tracking data for command: ${command.id}`);
      return;
    }

    for (let attempt = 1; attempt <= CommandProcessor.MAX_RETRIES; attempt++) {
      try {
        trackingData.attempts = attempt;
        trackingData.status = 'executing';
        trackingData.startedAt = Date.now();

        // Emit event
        if (typeof eventBus !== 'undefined') {
          eventBus.emit('command:executing', {
            commandId: command.id,
            platform: command.platform,
            action: command.action,
            attempt
          });
        }

        console.log(
          `[CommandProcessor] Executing command ${command.id} ` +
          `(${command.platform}.${command.action}) - attempt ${attempt}/${CommandProcessor.MAX_RETRIES}`
        );

        // Execute command with timeout
        const result = await Promise.race([
          this.executeCommand(command),
          this.createTimeout(CommandProcessor.EXECUTION_TIMEOUT)
        ]);

        // Success
        trackingData.status = 'success';
        trackingData.result = result;
        trackingData.completedAt = Date.now();

        console.log(
          `[CommandProcessor] Command succeeded: ${command.id} (attempt ${attempt}, duration: ${trackingData.completedAt - trackingData.startedAt}ms)`
        );

        // Emit success event
        if (typeof eventBus !== 'undefined') {
          eventBus.emit('command:success', {
            commandId: command.id,
            platform: command.platform,
            action: command.action,
            result,
            attempt,
            duration: trackingData.completedAt - trackingData.startedAt
          });
        }

        // Report to backend
        await this.submitResult(command.id, 'success', result);
        return;

      } catch (error) {
        trackingData.error = error.message;

        console.error(
          `[CommandProcessor] Command failed (attempt ${attempt}/${CommandProcessor.MAX_RETRIES}): ` +
          `${command.id} - ${error.message}`
        );

        // Emit retry/failure event
        if (typeof eventBus !== 'undefined') {
          eventBus.emit('command:attempt-failed', {
            commandId: command.id,
            platform: command.platform,
            action: command.action,
            attempt,
            error: error.message,
            willRetry: attempt < CommandProcessor.MAX_RETRIES
          });
        }

        // If not last attempt, wait before retry
        if (attempt < CommandProcessor.MAX_RETRIES) {
          const delay = CommandProcessor.RETRY_DELAY * attempt; // Exponential backoff
          console.log(`[CommandProcessor] Retrying in ${delay}ms...`);
          await this.delay(delay);
        }
      }
    }

    // All retries exhausted
    trackingData.status = 'failed';
    trackingData.completedAt = Date.now();

    console.error(`[CommandProcessor] Command failed after all retries: ${command.id}`);

    // Emit final failure event
    if (typeof eventBus !== 'undefined') {
      eventBus.emit('command:failed', {
        commandId: command.id,
        platform: command.platform,
        action: command.action,
        error: trackingData.error,
        attempts: trackingData.attempts,
        duration: trackingData.completedAt - trackingData.startedAt
      });
    }

    // Report final failure to backend
    await this.submitResult(command.id, 'failed', {
      error: trackingData.error,
      attempts: trackingData.attempts
    });
  }

  /**
   * Execute command with appropriate handler
   * @private
   * @param {object} command - Command to execute
   * @returns {Promise<object>} Execution result
   */
  async executeCommand(command) {
    const { platform, action, payload, metadata } = command;

    // Try new format first: platform.action
    let handler = this.handlers.get(`${platform}.${action}`);

    // Fall back to legacy format for backwards compatibility
    if (!handler) {
      handler = this.handlers.get(action);
    }

    if (!handler) {
      throw new Error(`No handler found for ${platform}.${action}`);
    }

    // Execute handler
    const result = await handler(payload, metadata, command);

    return result;
  }

  /**
   * Create timeout promise
   * @private
   * @param {number} ms - Timeout in milliseconds
   * @returns {Promise<never>}
   */
  createTimeout(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(`Command execution timeout after ${ms}ms`));
      }, ms)
    );
  }

  /**
   * Delay helper for retries
   * @private
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================================================
  // RESULT SUBMISSION
  // ========================================================================

  /**
   * Submit command result to backend
   * @private
   * @param {string} commandId - Command ID
   * @param {string} status - 'success' or 'failed'
   * @param {object} result - Result or error data
   */
  async submitResult(commandId, status, result) {
    try {
      if (typeof apiClient === 'undefined') {
        console.warn(`[CommandProcessor] apiClient not available, cannot submit result for ${commandId}`);
        return;
      }

      console.log(`[CommandProcessor] Submitting result for ${commandId}: ${status}`);

      const submitResult = await apiClient.submitCommandResult(commandId, status, result);

      if (!submitResult.success) {
        console.error(`[CommandProcessor] Failed to submit result for ${commandId}:`, submitResult.message);
      }
    } catch (error) {
      console.error(`[CommandProcessor] Error submitting result: ${error.message}`);
    }
  }

  // ========================================================================
  // BATCH OPERATIONS (LEGACY)
  // ========================================================================

  /**
   * Process a batch of commands (legacy method, now uses queue)
   * @deprecated Use enqueueCommands() instead
   * @param {Array<object>} commands - Commands to process
   */
  async processBatch(commands) {
    return await this.enqueueCommands(commands);
  }

  /**
   * Process single command (legacy method)
   * @deprecated Use enqueueCommands() instead
   * @param {object} command - Command to process
   */
  async processCommand(command) {
    await this.enqueueCommands([command]);
  }
}

// Attach to window (content script context)
const commandProcessorTarget = typeof globalThis !== 'undefined' ? globalThis : window;
if (commandProcessorTarget) {
  commandProcessorTarget.commandProcessor = new CommandProcessor();
}
