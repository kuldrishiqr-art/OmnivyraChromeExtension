/**
 * LINKEDIN SCRAPER - Safe Comment Extraction
 * 
 * Extracts visible LinkedIn comments for batch sync.
 * 
 * SAFETY CONSTRAINTS:
 * - No aggressive scrolling or clicking
 * - Only reads visible DOM elements (innerText, attributes)
 * - Maximum 20 comments per run (hardcoded)
 * - Random delays between items (800-2000ms)
 * - No sensitive data extraction (profiles, connections, DMs)
 */

class LinkedInScraper {
  // ========================================================================
  // CONFIGURATION
  // ========================================================================

  CONFIG = {
    MAX_COMMENTS: 20,               // Absolute maximum per run
    ITEM_DELAY_MIN: 800,            // Min delay between items (ms)
    ITEM_DELAY_MAX: 2000,           // Max delay between items (ms)
    DOM_TIMEOUT: 5000,              // Timeout for DOM operations (ms)
    VISIBLE_RETRY_ATTEMPTS: 3       // Retry count for visibility check
  };

  // ========================================================================
  // SELECTORS - LinkedIn UI Patterns
  // ========================================================================

  SELECTORS = {
    // Comment containers - can be nested div or article elements
    COMMENT_CONTAINER: '[data-urn*="comment"]',
    COMMENT_ALT: 'div[data-test-id*="comment"]',
    
    // Within a comment
    CONTENT: '.show-more-less-html__markup',          // Comment text wrapper
    AUTHOR_NAME: 'a.app-aware-link--is-visible[href*="/in/"]',  // Author profile link
    AUTHOR_LINK: 'a.app-aware-link--is-visible[href*="/in/"]',  // Profile URL
    TIMESTAMP: 'span:contains("ago"), time, [data-test-id*="time"]'  // Comment timestamp
  };

  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================

  constructor() {
    console.log('[LinkedInScraper] Initialized');
  }

  // ========================================================================
  // MAIN SCRAPING METHOD
  // ========================================================================

  /**
   * Scrape visible LinkedIn comments from current page
   * 
   * @returns {Promise<Array>} Array of normalized comment events
   * 
   * Event format:
   * {
   *   platform: 'linkedin',
   *   event_type: 'comment',
   *   platform_message_id: <unique_id>,
   *   data: {
   *     content: <comment_text>,
   *     author_name: <person_name>,
   *     author_profile_url: <linkedin_profile>,
   *     thread_id: <post_id>,
   *     created_at: <timestamp>
   *   }
   * }
   */
  async scrapeLinkedInComments() {
    const startTime = Date.now();

    console.log('[LinkedInScraper] Starting comment scrape');

    try {
      // Step 1: Find visible comment elements on page
      const commentElements = this.findVisibleComments();

      console.log(`[LinkedInScraper] Found ${commentElements.length} visible comments`);

      if (commentElements.length === 0) {
        console.log('[LinkedInScraper] No visible comments found on page');
        return [];
      }

      // Step 2: Extract data from each comment with delays
      const events = [];

      for (let i = 0; i < commentElements.length; i++) {
        // Enforce max comments per run
        if (i >= this.CONFIG.MAX_COMMENTS) {
          console.log(`[LinkedInScraper] Hit max comments limit (${this.CONFIG.MAX_COMMENTS})`);
          break;
        }

        try {
          // Safe delay between items (no aggressive parsing)
          if (i > 0) {
            await this.randomDelay(
              this.CONFIG.ITEM_DELAY_MIN,
              this.CONFIG.ITEM_DELAY_MAX
            );
          }

          // Extract comment data
          const event = this.extractCommentData(commentElements[i], i);

          if (event) {
            events.push(event);
            console.log(`[LinkedInScraper] Extracted comment ${i + 1}`);
          }

        } catch (error) {
          console.error(`[LinkedInScraper] Error extracting comment ${i}:`, error);
          continue; // Skip this comment, move to next
        }
      }

      const duration = Date.now() - startTime;

      console.log(
        `[LinkedInScraper] Scrape complete: ${events.length} events collected in ${duration}ms`
      );

      return events;

    } catch (error) {
      console.error('[LinkedInScraper] Fatal error during scrape:', error);
      return [];
    }
  }

  // ========================================================================
  // VISIBLE COMMENT DETECTION
  // ========================================================================

  /**
   * Find visible comment elements on current page
   * 
   * @private
   * @returns {Array<Element>} Array of visible comment DOM elements
   */
  findVisibleComments() {
    const comments = [];

    try {
      // Try primary selector
      const primaryElements = Array.from(
        document.querySelectorAll(this.SELECTORS.COMMENT_CONTAINER)
      );

      console.log(`[LinkedInScraper] Primary selector found ${primaryElements.length} elements`);

      // Try fallback selector if primary yields little
      let elementsToCheck = primaryElements;

      if (primaryElements.length < 3) {
        const altElements = Array.from(
          document.querySelectorAll(this.SELECTORS.COMMENT_ALT)
        );

        console.log(`[LinkedInScraper] Alt selector found ${altElements.length} elements`);

        elementsToCheck = altElements;
      }

      // Filter to only visible elements
      for (const element of elementsToCheck) {
        if (this.isElementVisible(element)) {
          comments.push(element);
        }
      }

      return comments;

    } catch (error) {
      console.error('[LinkedInScraper] Error finding visible comments:', error);
      return [];
    }
  }

  /**
   * Check if element is visible in viewport
   * 
   * @private
   * @param {Element} element - DOM element to check
   * @returns {boolean} True if element is visible
   */
  isElementVisible(element) {
    try {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      // Check display property
      if (style.display === 'none') {
        return false;
      }

      // Check visibility
      if (style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }

      // Check opacity (less strict, accept semi-visible)
      if (parseFloat(style.opacity) < 0.1) {
        return false;
      }

      // Check if in viewport (or at least not way off-screen)
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        return false;
      }

      if (rect.right < 0 || rect.left > window.innerWidth) {
        return false;
      }

      return true;

    } catch (error) {
      console.error('[LinkedInScraper] Error checking visibility:', error);
      return false;
    }
  }

  // ========================================================================
  // COMMENT DATA EXTRACTION
  // ========================================================================

  /**
   * Extract structured data from a single comment element
   * 
   * @private
   * @param {Element} commentElement - Comment DOM element
   * @param {number} index - Index in collection (for ID generation)
   * @returns {object|null} Normalized event object or null if extraction failed
   */
  extractCommentData(commentElement, index) {
    try {
      // Extract comment text content
      const content = this.extractContent(commentElement);

      if (!content || content.trim().length === 0) {
        console.log('[LinkedInScraper] Comment has empty content, skipping');
        return null;
      }

      // Extract author information
      const authorName = this.extractAuthorName(commentElement);
      const authorProfileUrl = this.extractAuthorProfileUrl(commentElement);

      // Extract or generate identifiers
      const threadId = this.extractThreadId();
      const platformMessageId = this.generatePlatformMessageId(
        commentElement,
        threadId,
        index
      );

      // Extract timestamp (if available, else use current time)
      const createdAt = this.extractTimestamp(commentElement) || Date.now();

      // Build normalized event
      const event = {
        platform: 'linkedin',
        event_type: 'comment',
        platform_message_id: platformMessageId,
        data: {
          content: content.trim(),
          author_name: authorName || 'Unknown Author',
          author_profile_url: authorProfileUrl || null,
          thread_id: threadId,
          created_at: createdAt
        }
      };

      return event;

    } catch (error) {
      console.error('[LinkedInScraper] Error extracting comment data:', error);
      return null;
    }
  }

  /**
   * Extract comment text content safely
   * 
   * @private
   * @param {Element} commentElement - Comment DOM element
   * @returns {string} Comment text content
   */
  extractContent(commentElement) {
    try {
      // Try primary selector for content
      let contentElement = commentElement.querySelector(this.SELECTORS.CONTENT);

      if (!contentElement) {
        // Fallback: Look for paragraphs or any text container
        contentElement = commentElement.querySelector('p, [role="article"] p, .show-more-less');

        if (!contentElement) {
          // Last resort: Use innerText from main container
          contentElement = commentElement;
        }
      }

      if (!contentElement) {
        return '';
      }

      // Get text content safely via innerText (prevents XSS)
      let text = contentElement.innerText || contentElement.textContent || '';

      // Clean up excessive whitespace
      text = text.replace(/\s+/g, ' ').trim();

      // Remove "See more", "Show less" artifacts
      text = text.replace(/\b(See more|Show less|See 1 more|See \d+ more)\b/gi, '').trim();

      return text;

    } catch (error) {
      console.error('[LinkedInScraper] Error extracting content:', error);
      return '';
    }
  }

  /**
   * Extract author name
   * 
   * @private
   * @param {Element} commentElement - Comment DOM element
   * @returns {string|null} Author name or null if not found
   */
  extractAuthorName(commentElement) {
    try {
      // Look for author link (typically has href with /in/)
      const authorLink = commentElement.querySelector(this.SELECTORS.AUTHOR_NAME);

      if (authorLink) {
        const name = authorLink.innerText || authorLink.textContent;

        if (name) {
          return name.trim();
        }
      }

      // Fallback: Look for heading or title with author name
      const heading = commentElement.querySelector('h3, .h5, [class*="name"], [class*="author"]');

      if (heading) {
        const name = heading.innerText || heading.textContent;

        if (name) {
          return name.trim();
        }
      }

      return null;

    } catch (error) {
      console.error('[LinkedInScraper] Error extracting author name:', error);
      return null;
    }
  }

  /**
   * Extract author profile URL
   * 
   * @private
   * @param {Element} commentElement - Comment DOM element
   * @returns {string|null} Profile URL or null if not found
   */
  extractAuthorProfileUrl(commentElement) {
    try {
      const authorLink = commentElement.querySelector(this.SELECTORS.AUTHOR_LINK);

      if (authorLink && authorLink.href) {
        return authorLink.href;
      }

      return null;

    } catch (error) {
      console.error('[LinkedInScraper] Error extracting author profile URL:', error);
      return null;
    }
  }

  /**
   * Extract thread ID (post ID) from current URL or page data
   * 
   * @private
   * @returns {string} Thread ID
   */
  extractThreadId() {
    try {
      // Try to extract from URL parameters (posts typically have ?urn or similar)
      const currentUrl = window.location.href;

      // Look for post/activity ID in URL
      const postMatch = currentUrl.match(
        /(?:posts|activities)\/(\d+)|urn[\w-]*post:activity:(\d+)/i
      );

      if (postMatch && (postMatch[1] || postMatch[2])) {
        return postMatch[1] || postMatch[2];
      }

      // Fallback: Use current hostname + path hash
      const threadId = btoa(currentUrl).substring(0, 16);

      return threadId;

    } catch (error) {
      console.error('[LinkedInScraper] Error extracting thread ID:', error);

      // Fallback: Generate from timestamp
      return `thread_${Date.now()}`;
    }
  }

  /**
   * Extract timestamp from comment element
   * 
   * @private
   * @param {Element} commentElement - Comment DOM element
   * @returns {number|null} Unix timestamp or null if not found
   */
  extractTimestamp(commentElement) {
    try {
      // Look for time element
      const timeElement = commentElement.querySelector('time, [data-test-id*="time"]');

      if (timeElement) {
        // Try to get datetime attribute
        const datetime = timeElement.getAttribute('datetime');

        if (datetime) {
          const timestamp = new Date(datetime).getTime();

          if (!isNaN(timestamp)) {
            return timestamp;
          }
        }
      }

      // Fallback: Parse relative time like "2 hours ago"
      const timeText = timeElement?.innerText || '';

      if (timeText) {
        const parsed = this.parseRelativeTime(timeText);

        if (parsed) {
          return parsed;
        }
      }

      return null;

    } catch (error) {
      console.error('[LinkedInScraper] Error extracting timestamp:', error);
      return null;
    }
  }

  /**
   * Parse relative time strings like "2 hours ago" to Unix timestamp
   * 
   * @private
   * @param {string} timeText - Relative time text
   * @returns {number|null} Unix timestamp or null if parsing failed
   */
  parseRelativeTime(timeText) {
    try {
      const now = Date.now();

      // Match patterns like "2 hours ago", "1 day ago", etc
      const match = timeText.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);

      if (!match) {
        return null;
      }

      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      let milliseconds = 0;

      switch (unit) {
        case 'second':
          milliseconds = value * 1000;
          break;
        case 'minute':
          milliseconds = value * 60 * 1000;
          break;
        case 'hour':
          milliseconds = value * 60 * 60 * 1000;
          break;
        case 'day':
          milliseconds = value * 24 * 60 * 60 * 1000;
          break;
        case 'week':
          milliseconds = value * 7 * 24 * 60 * 60 * 1000;
          break;
        case 'month':
          milliseconds = value * 30 * 24 * 60 * 60 * 1000;
          break;
        case 'year':
          milliseconds = value * 365 * 24 * 60 * 60 * 1000;
          break;
      }

      return now - milliseconds;

    } catch (error) {
      console.error('[LinkedInScraper] Error parsing relative time:', error);
      return null;
    }
  }

  // ========================================================================
  // IDENTIFIER GENERATION
  // ========================================================================

  /**
   * Generate unique platform_message_id for deduplication
   * 
   * @private
   * @param {Element} commentElement - Comment DOM element
   * @param {string} threadId - Thread/post ID
   * @param {number} index - Index in collection
   * @returns {string} Unique platform_message_id
   */
  generatePlatformMessageId(commentElement, threadId, index) {
    try {
      // Try to get data-urn attribute which contains LinkedIn's unique ID
      const urn = commentElement.getAttribute('data-urn');

      if (urn) {
        return urn;
      }

      // Fallback: Create ID from thread + author + content hash
      const authorElement = commentElement.querySelector('a[href*="/in/"]');
      const authorName = authorElement?.innerText || 'unknown';

      const contentElement = commentElement.querySelector('[class*="markup"], p');
      const content = contentElement?.innerText || '';

      // Create deterministic hash from components
      const hashInput = `${threadId}:${authorName}:${content.substring(0, 50)}`;
      const messageId = this.simpleHash(hashInput);

      return messageId;

    } catch (error) {
      console.error('[LinkedInScraper] Error generating platform_message_id:', error);

      // Fallback: Use thread + index
      return `${threadId}_${index}`;
    }
  }

  /**
   * Simple deterministic hash for message ID generation
   * 
   * @private
   * @param {string} str - String to hash
   * @returns {string} Hash digest
   */
  simpleHash(str) {
    let hash = 0;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return `msg_${Math.abs(hash).toString(36)}`;
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Random delay (in milliseconds)
   * Used for human-like behavior, no aggressive scraping
   * 
   * @private
   * @param {number} min - Minimum delay (ms)
   * @param {number} max - Maximum delay (ms)
   * @returns {Promise<void>}
   */
  async randomDelay(min, max) {
    return new Promise((resolve) => {
      const delay = Math.floor(Math.random() * (max - min + 1)) + min;
      setTimeout(resolve, delay);
    });
  }

  // ========================================================================
  // STATUS/DEBUG METHODS
  // ========================================================================

  /**
   * Get total visible comments on current page (for debugging)
   * @returns {number} Count of visible comments
   */
  getVisibleCommentCount() {
    return this.findVisibleComments().length;
  }

  /**
   * Get current page thread ID (for debugging)
   * @returns {string} Thread ID
   */
  getCurrentThreadId() {
    return this.extractThreadId();
  }
}

// Attach to window (content scripts only)
const linkedinScraperTarget = typeof globalThis !== 'undefined' ? globalThis : window;
if (linkedinScraperTarget) {
  linkedinScraperTarget.linkedinScraper = new LinkedInScraper();
}
