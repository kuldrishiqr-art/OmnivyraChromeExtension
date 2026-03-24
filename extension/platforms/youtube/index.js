/**
 * YOUTUBE PLATFORM MODULE
 * 
 * Handles YouTube-specific data collection and engagement intelligence.
 * Extracts channel information, video analytics, and viewer engagement data.
 */

class YouTubePlatform {
  constructor() {
    this.name = 'youtube';
    this.isInitialized = false;
    this.pageType = null; // 'watch', 'channel', 'search', 'recommendations'
    this.extractedData = {};
  }

  /**
   * Initialize YouTube platform
   * @returns {Promise<void>}
   */
  async init() {
    try {
      console.log('[YouTube] Initializing platform module');

      // Detect current page type
      this.detectPageType();

      // Register command handlers
      this.registerCommandHandlers();

      // Setup page change listener
      this.setupPageChangeListener();

      this.isInitialized = true;

      // Emit initialization event
      if (typeof eventBus !== 'undefined') {
        eventBus.emit('platform:initialized', { platform: this.name });
      }
    } catch (error) {
      console.error('[YouTube] Initialization failed:', error);
    }
  }

  /**
   * Detect current YouTube page type
   * @private
   */
  detectPageType() {
    const url = window.location.href;

    if (url.includes('/watch')) {
      this.pageType = 'watch';
    } else if (url.includes('/channel/') || url.includes('/@')) {
      this.pageType = 'channel';
    } else if (url.includes('/results')) {
      this.pageType = 'search';
    } else if (url.includes('/feed')) {
      this.pageType = 'recommendations';
    } else {
      this.pageType = 'other';
    }

    console.log(`[YouTube] Page type detected: ${this.pageType}`);
  }

  /**
   * Register YouTube-specific command handlers
   * @private
   */
  registerCommandHandlers() {
    if (typeof commandProcessor === 'undefined') return;

    // Handler for video analysis
    commandProcessor.registerHandler('ANALYZE_YOUTUBE_VIDEO', async (payload) => {
      return await this.analyzeVideo(payload);
    });

    // Handler for channel analysis
    commandProcessor.registerHandler('ANALYZE_YOUTUBE_CHANNEL', async (payload) => {
      return await this.analyzeChannel(payload);
    });

    // Handler for engagement metrics
    commandProcessor.registerHandler('EXTRACT_YOUTUBE_ENGAGEMENT', async (payload) => {
      return await this.extractEngagement(payload);
    });
  }

  /**
   * Setup listener for page navigation changes
   * @private
   */
  setupPageChangeListener() {
    let lastUrl = window.location.href;

    const checkUrlChange = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        this.detectPageType();

        if (typeof eventBus !== 'undefined') {
          eventBus.emit('youtube:pageChanged', { pageType: this.pageType });
        }
      }
    };

    // Check for URL changes every 500ms
    setInterval(checkUrlChange, 500);
  }

  /**
   * Analyze current video
   * @param {object} payload - Command payload
   * @returns {Promise<object>}
   */
  async analyzeVideo(payload = {}) {
    try {
      console.log('[YouTube] Analyzing video');

      const videoData = {
        platform: 'youtube',
        pageType: this.pageType,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        video: this.extractVideoInfo(),
        engagement: this.extractVideoEngagement(),
        channel: this.extractChannelInfo(),
        comments: this.extractCommentSample()
      };

      // Send data to backend via API
      if (typeof apiClient !== 'undefined') {
        await apiClient.sendEvents([
          {
            type: 'YouTube_VideoAnalyzed',
            data: videoData
          }
        ]);
      }

      return videoData;
    } catch (error) {
      console.error('[YouTube] Video analysis error:', error);
      throw error;
    }
  }

  /**
   * Analyze YouTube channel
   * @param {object} payload - Command payload
   * @returns {Promise<object>}
   */
  async analyzeChannel(payload = {}) {
    try {
      console.log('[YouTube] Analyzing channel');

      const channelData = {
        platform: 'youtube',
        timestamp: new Date().toISOString(),
        channel: this.extractChannelInfo(),
        stats: this.extractChannelStats(),
        recentVideos: this.extractRecentVideos()
      };

      if (typeof apiClient !== 'undefined') {
        await apiClient.sendEvents([
          {
            type: 'YouTube_ChannelAnalyzed',
            data: channelData
          }
        ]);
      }

      return channelData;
    } catch (error) {
      console.error('[YouTube] Channel analysis error:', error);
      throw error;
    }
  }

  /**
   * Extract engagement metrics
   * @param {object} payload - Command payload
   * @returns {Promise<object>}
   */
  async extractEngagement(payload = {}) {
    try {
      console.log('[YouTube] Extracting engagement metrics');

      const engagementData = {
        platform: 'youtube',
        timestamp: new Date().toISOString(),
        videoEngagement: this.extractVideoEngagement(),
        channelEngagement: this.extractChannelEngagement(),
        trends: this.analyzeTrends()
      };

      return engagementData;
    } catch (error) {
      console.error('[YouTube] Engagement extraction error:', error);
      throw error;
    }
  }

  /**
   * Extract video information from DOM
   * @private
   * @returns {object}
   */
  extractVideoInfo() {
    const titleElement = document.querySelector('h1 yt-formatted-string');
    const descriptionElement = document.querySelector('#description-inner');

    return {
      title: titleElement?.textContent || null,
      videoId: this.extractVideoId(),
      description: descriptionElement?.textContent || null,
      duration: this.extractVideoDuration(),
      uploadDate: document.querySelector('[data-created-date]')?.getAttribute('data-created-date') || null,
      url: window.location.href
    };
  }

  /**
   * Extract video ID from URL
   * @private
   * @returns {string|null}
   */
  extractVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v') || null;
  }

  /**
   * Extract video duration
   * @private
   * @returns {string|null}
   */
  extractVideoDuration() {
    const durationElement = document.querySelector('.ytp-time-duration');
    return durationElement?.textContent || null;
  }

  /**
   * Extract video engagement metrics
   * @private
   * @returns {object}
   */
  extractVideoEngagement() {
    return {
      likes: this.extractNumber('[aria-label*="like"]'),
      comments: this.extractNumber('[aria-label*="comment"]'),
      views: this.extractViewCount(),
      shares: this.extractNumber('[aria-label*="share"]')
    };
  }

  /**
   * Extract view count specifically
   * @private
   * @returns {number}
   */
  extractViewCount() {
    const viewElement = document.querySelector('yt-formatted-string.view-count');
    if (viewElement) {
      const text = viewElement.textContent;
      const match = text.match(/[\d,]+/);
      if (match) {
        return parseInt(match[0].replace(/,/g, ''));
      }
    }
    return 0;
  }

  /**
   * Extract channel information
   * @private
   * @returns {object}
   */
  extractChannelInfo() {
    const channelLink = document.querySelector('a#channel-name');
    const avatarElement = document.querySelector('a#avatar img');

    return {
      name: channelLink?.textContent || null,
      url: channelLink?.href || null,
      avatar: avatarElement?.src || null,
      verified: !!document.querySelector('[aria-label="Verified"]')
    };
  }

  /**
   * Extract channel statistics
   * @private
   * @returns {object}
   */
  extractChannelStats() {
    return {
      subscribers: this.extractSubscriberCount(),
      videoCount: this.extractNumber('[aria-label*="video"]'),
      totalViews: this.extractNumber('[aria-label*="total view"]')
    };
  }

  /**
   * Extract subscriber count
   * @private
   * @returns {number}
   */
  extractSubscriberCount() {
    const subElement = document.querySelector('#subscriber-count');
    if (subElement) {
      const text = subElement.textContent;
      const match = text.match(/[\d.MK]+/);
      if (match) {
        return this.convertShortNumber(match[0]);
      }
    }
    return 0;
  }

  /**
   * Convert shortened number format (1.5M, 2.3K) to actual number
   * @private
   * @param {string} shortNum - Shortened number string
   * @returns {number}
   */
  convertShortNumber(shortNum) {
    const multipliers = { 'K': 1000, 'M': 1000000, 'B': 1000000000 };
    const match = shortNum.match(/^([\d.]+)([KMB]?)$/);

    if (match) {
      const num = parseFloat(match[1]);
      const suffix = match[2] || '';
      return Math.round(num * (multipliers[suffix] || 1));
    }

    return parseInt(shortNum.replace(/[,K]/g, ''));
  }

  /**
   * Extract channel engagement metrics
   * @private
   * @returns {object}
   */
  extractChannelEngagement() {
    return {
      avgLikesPerVideo: this.calculateAverageEngagement('likes'),
      avgCommentsPerVideo: this.calculateAverageEngagement('comments'),
      engagementRate: this.calculateEngagementRate()
    };
  }

  /**
   * Extract recent videos list
   * @private
   * @returns {Array}
   */
  extractRecentVideos() {
    const videos = [];
    const videoElements = document.querySelectorAll('ytd-grid-video-renderer');

    videoElements.forEach((element, index) => {
      if (index < 5) { // Get first 5 recent videos
        const titleElement = element.querySelector('#video-title');
        const viewElement = element.querySelector('#metadata-line span:first-child');

        videos.push({
          title: titleElement?.textContent || null,
          url: titleElement?.href || null,
          views: this.extractNumber(viewElement),
          uploaded: element.querySelector('#metadata-line span:last-child')?.textContent || null
        });
      }
    });

    return videos;
  }

  /**
   * Extract comment sample
   * @private
   * @returns {Array}
   */
  extractCommentSample() {
    const comments = [];
    const commentElements = document.querySelectorAll('ytd-comment-thread-renderer');

    commentElements.forEach((element, index) => {
      if (index < 3) { // Get first 3 comments
        const authorElement = element.querySelector('#author-text');
        const contentElement = element.querySelector('#content-text');
        const likeElement = element.querySelector('[aria-label*="like"]');

        comments.push({
          author: authorElement?.textContent || null,
          content: contentElement?.textContent || null,
          likes: this.extractNumber(likeElement),
          timestamp: element.querySelector('#time')?.textContent || null
        });
      }
    });

    return comments;
  }

  /**
   * Analyze engagement trends
   * @private
   * @returns {object}
   */
  analyzeTrends() {
    return {
      engagementDirection: this.detectTrend(), // 'up', 'down', 'stable'
      peakEngagementTime: this.getPeakEngagementTime(),
      contentSentiment: this.analyzeContentSentiment()
    };
  }

  /**
   * Detect engagement trend
   * @private
   * @returns {string}
   */
  detectTrend() {
    // Simplified trend detection - in production would use historical data
    const recentViews = this.extractViewCount();
    return recentViews > 10000 ? 'up' : 'stable';
  }

  /**
   * Get peak engagement time
   * @private
   * @returns {string|null}
   */
  getPeakEngagementTime() {
    // This would typically analyze historical data
    return 'evening'; // Placeholder
  }

  /**
   * Analyze content sentiment from comments
   * @private
   * @returns {string}
   */
  analyzeContentSentiment() {
    // Simplified sentiment analysis - in production would use ML
    return 'positive'; // Placeholder
  }

  /**
   * Calculate average engagement metric
   * @private
   * @param {string} metricType - Type of metric (likes, comments)
   * @returns {number}
   */
  calculateAverageEngagement(metricType) {
    // Placeholder - would calculate from recent videos
    return 100;
  }

  /**
   * Calculate engagement rate
   * @private
   * @returns {number}
   */
  calculateEngagementRate() {
    // Placeholder - would calculate as (engagement / views) * 100
    return 2.5;
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
   * Utility: Extract number from element
   * @private
   * @param {Element|string} element - DOM element or selector
   * @returns {number}
   */
  extractNumber(element) {
    let text = '';

    if (typeof element === 'string') {
      const el = document.querySelector(element);
      text = el?.textContent || '';
    } else if (element instanceof Element) {
      text = element.textContent || '';
    }

    const match = text.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }
}

// Export singleton instance
const youtubePlatform = new YouTubePlatform();
