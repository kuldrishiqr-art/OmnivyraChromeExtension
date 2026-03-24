/**
 * LINKEDIN PLATFORM MODULE
 * 
 * Handles LinkedIn-specific data collection and intelligence gathering.
 * Extracts profile information, activity feeds, and engagement metrics.
 */

class LinkedInPlatform {
  constructor() {
    this.name = 'linkedin';
    this.isInitialized = false;
    this.pageType = null; // 'profile', 'feed', 'job', 'company'
    this.extractedData = {};
  }

  /**
   * Initialize LinkedIn platform
   * @returns {Promise<void>}
   */
  async init() {
    try {
      console.log('[LinkedIn] Initializing platform module');
      
      // Detect current page type
      this.detectPageType();

      // Register command handlers
      this.registerCommandHandlers();

      // Listen for page changes
      this.setupPageChangeListener();

      this.isInitialized = true;
      
      // Emit initialization event
      if (typeof eventBus !== 'undefined') {
        eventBus.emit('platform:initialized', { platform: this.name });
      }
    } catch (error) {
      console.error('[LinkedIn] Initialization failed:', error);
    }
  }

  /**
   * Detect current LinkedIn page type
   * @private
   */
  detectPageType() {
    const url = window.location.href;

    if (url.includes('/in/')) {
      this.pageType = 'profile';
    } else if (url.includes('/feed')) {
      this.pageType = 'feed';
    } else if (url.includes('/jobs/')) {
      this.pageType = 'job';
    } else if (url.includes('/company/')) {
      this.pageType = 'company';
    } else {
      this.pageType = 'other';
    }

    console.log(`[LinkedIn] Page type detected: ${this.pageType}`);
  }

  /**
   * Register LinkedIn-specific command handlers
   * @private
   */
  registerCommandHandlers() {
    if (typeof commandProcessor === 'undefined') return;

    // Handler for profile analysis
    commandProcessor.registerHandler('ANALYZE_LINKEDIN_PROFILE', async (payload) => {
      return await this.analyzeProfile(payload);
    });

    // Handler for feed analysis
    commandProcessor.registerHandler('ANALYZE_LINKEDIN_FEED', async (payload) => {
      return await this.analyzeFeed(payload);
    });

    // Handler for connection data
    commandProcessor.registerHandler('EXTRACT_LINKEDIN_CONNECTIONS', async (payload) => {
      return await this.extractConnections(payload);
    });
  }

  /**
   * Setup listener for page navigation changes
   * @private
   */
  setupPageChangeListener() {
    // Listen for URL changes (LinkedIn uses client-side routing)
    let lastUrl = window.location.href;

    const checkUrlChange = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        this.detectPageType();

        if (typeof eventBus !== 'undefined') {
          eventBus.emit('linkedin:pageChanged', { pageType: this.pageType });
        }
      }
    };

    // Check for URL changes every 500ms
    setInterval(checkUrlChange, 500);
  }

  /**
   * Analyze current LinkedIn profile
   * @param {object} payload - Command payload
   * @returns {Promise<object>}
   */
  async analyzeProfile(payload = {}) {
    try {
      console.log('[LinkedIn] Analyzing profile');

      const profileData = {
        platform: 'linkedin',
        pageType: this.pageType,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        profile: this.extractProfileInfo(),
        engagement: this.extractEngagementMetrics()
      };

      // Send data to backend via API
      if (typeof apiClient !== 'undefined') {
        const result = await apiClient.sendEvents([
          {
            type: 'LinkedIn_ProfileAnalyzed',
            data: profileData
          }
        ]);

        return { success: result.success, data: profileData };
      }

      return profileData;
    } catch (error) {
      console.error('[LinkedIn] Profile analysis error:', error);
      throw error;
    }
  }

  /**
   * Analyze LinkedIn feed
   * @param {object} payload - Command payload
   * @returns {Promise<object>}
   */
  async analyzeFeed(payload = {}) {
    try {
      console.log('[LinkedIn] Analyzing feed');

      const feedData = {
        platform: 'linkedin',
        timestamp: new Date().toISOString(),
        posts: this.extractFeedPosts(),
        recommendations: this.analyzeRecommendations()
      };

      if (typeof apiClient !== 'undefined') {
        await apiClient.sendEvents([
          {
            type: 'LinkedIn_FeedAnalyzed',
            data: feedData
          }
        ]);
      }

      return feedData;
    } catch (error) {
      console.error('[LinkedIn] Feed analysis error:', error);
      throw error;
    }
  }

  /**
   * Extract profile information from DOM
   * @private
   * @returns {object}
   */
  extractProfileInfo() {
    const profileInfo = {
      name: this.querySelector('[data-test-id="topcard-profile-name"]')?.textContent || null,
      headline: this.querySelector('[data-test-id="topcard-headline"]')?.textContent || null,
      location: this.querySelector('[data-test-id="topcard-location"]')?.textContent || null,
      about: this.querySelector('[data-test-id="about"]')?.textContent || null
    };

    return profileInfo;
  }

  /**
   * Extract engagement metrics from profile
   * @private
   * @returns {object}
   */
  extractEngagementMetrics() {
    return {
      followers: this.extractNumber('[data-test-id="follower-count"]'),
      connections: this.extractNumber('[data-test-id="connection-count"]'),
      recommendations: this.extractNumber('[data-test-id="recommendation-count"]')
    };
  }

  /**
   * Extract feed posts
   * @private
   * @returns {Array}
   */
  extractFeedPosts() {
    const posts = [];
    const postElements = document.querySelectorAll('[data-id^="update-"]');

    postElements.forEach(element => {
      const post = {
        id: element.getAttribute('data-id'),
        author: element.querySelector('[data-test-id="comment-name"]')?.textContent || null,
        content: element.querySelector('[data-test-id="feed-post-text"]')?.textContent || null,
        timestamp: element.querySelector('[data-test-id="post-timestamp"]')?.textContent || null,
        likes: this.extractNumber(element.querySelector('[data-test-id="reactions-count"]')),
        comments: this.extractNumber(element.querySelector('[data-test-id="comments-count"]')),
        shares: this.extractNumber(element.querySelector('[data-test-id="shares-count"]'))
      };

      posts.push(post);
    });

    return posts;
  }

  /**
   * Analyze recommendations trends
   * @private
   * @returns {object}
   */
  analyzeRecommendations() {
    return {
      given: this.extractNumber('[data-test-id="given-recommendations-count"]'),
      received: this.extractNumber('[data-test-id="received-recommendations-count"]'),
      categories: this.extractRecommendationCategories()
    };
  }

  /**
   * Extract recommendation categories
   * @private
   * @returns {Array}
   */
  extractRecommendationCategories() {
    const categories = [];
    const categoryElements = document.querySelectorAll('[data-test-id="recommendation-category"]');

    categoryElements.forEach(element => {
      categories.push({
        name: element.textContent,
        count: this.extractNumber(element.nextElementSibling)
      });
    });

    return categories;
  }

  /**
   * Extract connection data
   * @param {object} payload - Command payload
   * @returns {Promise<object>}
   */
  async extractConnections(payload = {}) {
    try {
      console.log('[LinkedIn] Extracting connections');

      const connectionData = {
        platform: 'linkedin',
        timestamp: new Date().toISOString(),
        totalConnections: this.extractNumber('[data-test-id="connection-count"]'),
        recentConnections: this.extractRecentConnections()
      };

      return connectionData;
    } catch (error) {
      console.error('[LinkedIn] Connection extraction error:', error);
      throw error;
    }
  }

  /**
   * Extract recent connections list
   * @private
   * @returns {Array}
   */
  extractRecentConnections() {
    const connections = [];
    const connectionElements = document.querySelectorAll('[data-test-id="connection-item"]');

    connectionElements.forEach(element => {
      connections.push({
        name: element.querySelector('[data-test-id="person-name"]')?.textContent || null,
        headline: element.querySelector('[data-test-id="person-headline"]')?.textContent || null,
        url: element.querySelector('a')?.href || null
      });
    });

    return connections;
  }

  /**
   * Utility: Query selector with fallback
   * @private
   * @param {string} selector - CSS selector
   * @returns {Element|null}
   */
  querySelector(selector) {
    return document.querySelector(selector);
  }

  /**
   * Utility: Extract number from text
   * @private
   * @param {Element|string} element - DOM element or selector
   * @returns {number}
   */
  extractNumber(element) {
    let text = '';

    if (typeof element === 'string') {
      text = document.querySelector(element)?.textContent || '';
    } else if (element instanceof Element) {
      text = element.textContent || '';
    }

    const match = text.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }
}

// Export singleton instance
const linkedinPlatform = new LinkedInPlatform();

// ES6 export for service worker
export default LinkedInPlatform;

// Attach to window for content scripts
if (typeof window !== 'undefined') {
  window.linkedinPlatform = linkedinPlatform;
}
