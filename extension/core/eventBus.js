/**
 * EVENT BUS - Pub/Sub System for Internal Extension Communication
 * 
 * Provides a centralized event emitter for all modules to communicate
 * without tight coupling. Follows observer pattern for scalability.
 */

class EventBus {
  constructor() {
    // Map of event name -> Set of listener functions
    this.events = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} eventName - Name of the event
   * @param {Function} listener - Callback function to execute
   * @returns {Function} Unsubscribe function
   */
  on(eventName, listener) {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }
    this.events.get(eventName).add(listener);

    // Return unsubscribe function for convenience
    return () => this.off(eventName, listener);
  }

  /**
   * Subscribe to event, execute once, then unsubscribe
   * @param {string} eventName - Name of the event
   * @param {Function} listener - Callback function
   */
  once(eventName, listener) {
    const wrapper = (data) => {
      listener(data);
      this.off(eventName, wrapper);
    };
    this.on(eventName, wrapper);
  }

  /**
   * Unsubscribe from an event
   * @param {string} eventName - Name of the event
   * @param {Function} listener - Callback function to remove
   */
  off(eventName, listener) {
    if (this.events.has(eventName)) {
      this.events.get(eventName).delete(listener);
      if (this.events.get(eventName).size === 0) {
        this.events.delete(eventName);
      }
    }
  }

  /**
   * Emit an event to all subscribers
   * @param {string} eventName - Name of the event
   * @param {*} data - Data to pass to listeners
   */
  emit(eventName, data) {
    if (this.events.has(eventName)) {
      this.events.get(eventName).forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in listener for event '${eventName}':`, error);
        }
      });
    }
  }

  /**
   * Get all event names currently registered
   * @returns {string[]} Array of event names
   */
  getEventNames() {
    return Array.from(this.events.keys());
  }

  /**
   * Clear all events and listeners
   */
  clear() {
    this.events.clear();
  }
}

// Export singleton instance
const eventBus = new EventBus();
