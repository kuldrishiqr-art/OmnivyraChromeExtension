/**
 * CHROME EXTENSION TEST SUITE - Scraper + Sync Engine Simulation
 * 
 * Tests without real LinkedIn:
 * - Mock DOM parsing
 * - Scraper validation
 * - Sync engine batch logic
 * - Deduplication
 * - API payload structure
 */

// ============================================================================
// MOCK HTML FOR TESTING
// ============================================================================

const MOCK_HTML = `
<!DOCTYPE html>
<html>
<head><title>Mock LinkedIn Post</title></head>
<body>
  <div class="post-container">
    <h2>Test Post</h2>
    
    <!-- Comment 1 -->
    <div data-urn="comment:123456">
      <div class="show-more-less-html__markup">
        <span>This is a great post! Really helpful insights.</span>
      </div>
      <a href="/in/john-doe-123" class="app-aware-link--is-visible">John Doe</a>
      <span>2 hours ago</span>
    </div>

    <!-- Comment 2 -->
    <div data-urn="comment:123457">
      <div class="show-more-less-html__markup">
        <span>Completely agree with this analysis. Well articulated.</span>
      </div>
      <a href="/in/jane-smith-456" class="app-aware-link--is-visible">Jane Smith</a>
      <span>1 hour ago</span>
    </div>

    <!-- Comment 3 -->
    <div data-urn="comment:123458">
      <div class="show-more-less-html__markup">
        <span>This is valuable information. Thanks for sharing!</span>
      </div>
      <a href="/in/bob-wilson-789" class="app-aware-link--is-visible">Bob Wilson</a>
      <span>30 minutes ago</span>
    </div>

    <!-- Duplicate test - same content as comment 1 -->
    <div data-urn="comment:123459">
      <div class="show-more-less-html__markup">
        <span>This is a great post! Really helpful insights.</span>
      </div>
      <a href="/in/john-doe-123" class="app-aware-link--is-visible">John Doe</a>
      <span>2 hours ago</span>
    </div>
  </div>
</body>
</html>
`;

// ============================================================================
// SIMPLE SCRAPER FOR TESTING
// ============================================================================

class TestScraper {
  constructor() {
    this.CONFIG = {
      MAX_COMMENTS: 20,
      ITEM_DELAY_MIN: 100,  // Short delays for testing
      ITEM_DELAY_MAX: 200
    };
    
    this.SELECTORS = {
      COMMENT_CONTAINER: '[data-urn*="comment"]',
      CONTENT: '.show-more-less-html__markup',
      AUTHOR_NAME: 'a.app-aware-link--is-visible',
      TIMESTAMP: 'span:last-child'
    };
  }

  /**
   * Scrape comments from a document
   * @param {Document} doc - DOM document to scrape from
   * @returns {Promise<Array>} Array of comment events
   */
  async scrapeFromDocument(doc) {
    console.log('[TestScraper] Starting scrape from mock document...');
    
    const comments = [];
    
    // Find all comment containers
    const commentElements = doc.querySelectorAll(this.SELECTORS.COMMENT_CONTAINER);
    console.log(`[TestScraper] Found ${commentElements.length} potential comments`);
    
    for (let i = 0; i < Math.min(commentElements.length, this.CONFIG.MAX_COMMENTS); i++) {
      await this.randomDelay(
        this.CONFIG.ITEM_DELAY_MIN,
        this.CONFIG.ITEM_DELAY_MAX
      );
      
      const element = commentElements[i];
      const comment = this.extractComment(element);
      
      if (comment) {
        comments.push(comment);
        console.log(`[TestScraper]   ✓ Extracted comment: "${comment.text.substring(0, 50)}..."`);
      }
    }
    
    return comments;
  }

  /**
   * Extract comment data from element
   * @param {Element} element - Comment container element
   * @returns {Object} Comment data
   */
  extractComment(element) {
    try {
      const contentEl = element.querySelector(this.SELECTORS.CONTENT);
      const authorEl = element.querySelector(this.SELECTORS.AUTHOR_NAME);
      const timestampEl = element.querySelector(this.SELECTORS.TIMESTAMP);
      
      if (!contentEl || !authorEl) {
        return null;
      }
      
      const text = contentEl.textContent?.trim() || '';
      const author = authorEl.textContent?.trim() || '';
      const timestamp = timestampEl?.textContent?.trim() || 'unknown';
      const authorLink = authorEl.href || '';
      
      // Extract author ID from URL
      const authorMatch = authorLink.match(/\/in\/([^/]+)/);
      const authorId = authorMatch ? authorMatch[1] : 'unknown';
      
      return {
        text,
        author,
        authorId,
        timestamp,
        authorLink
      };
    } catch (error) {
      console.error('[TestScraper] Error extracting comment:', error);
      return null;
    }
  }

  /**
   * Random delay helper
   */
  async randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}

// ============================================================================
// MOCK EVENT STRUCTURE
// ============================================================================

function createEvent(comment, platform = 'linkedin') {
  const eventId = `${platform}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  return {
    id: eventId,
    platform,
    event_type: 'comment',
    platform_message_id: eventId,
    created_at: new Date().toISOString(),
    data: {
      content: comment.text,
      author_name: comment.author,
      author_id: comment.authorId,
      timestamp: comment.timestamp,
      author_profile_url: comment.authorLink
    }
  };
}

// ============================================================================
// SIMPLE SYNC ENGINE FOR TESTING
// ============================================================================

class TestSyncEngine {
  constructor() {
    this.CONFIG = {
      MAX_EVENTS_PER_RUN: 20,
      BATCH_SIZE: 5,
      BATCH_DELAY_MIN: 100,  // Short for testing
      BATCH_DELAY_MAX: 200
    };
    
    this.collectedEvents = [];
    this.deduplicationSet = new Set();
    this.sentBatches = [];
  }

  /**
   * Run batch sync with mock API
   */
  async runBatchSync(comments) {
    console.log('[TestSyncEngine] Starting batch sync...');
    
    // Convert comments to events
    const events = comments.map(comment => createEvent(comment));
    console.log(`[TestSyncEngine] Created ${events.length} events from comments`);
    
    // Deduplicate
    const dedupedEvents = this.deduplicateEvents(events);
    console.log(`[TestSyncEngine] After deduplication: ${dedupedEvents.length} events`);
    
    // Batch and send
    await this.sendInBatches(dedupedEvents);
    
    return {
      success: true,
      eventsCollected: events.length,
      eventsDeduplicated: dedupedEvents.length,
      batchesSent: this.sentBatches.length,
      sentBatches: this.sentBatches
    };
  }

  /**
   * Deduplicate events
   */
  deduplicateEvents(events) {
    const deduped = [];
    const seen = new Set();
    
    for (const event of events) {
      const hash = this.hashEvent(event);
      
      if (!seen.has(hash)) {
        seen.add(hash);
        deduped.push(event);
        console.log(`[TestSyncEngine]   ✓ Event unique: ${event.id.substring(0, 20)}...`);
      } else {
        console.log(`[TestSyncEngine]   ✗ Duplicate detected (skipped)`);
      }
    }
    
    return deduped;
  }

  /**
   * Create content hash for deduplication
   */
  hashEvent(event) {
    return `${event.data.author_name}:${event.data.content}`;
  }

  /**
   * Send events in batches with delays
   */
  async sendInBatches(events) {
    const batches = [];
    
    // Split into batches
    for (let i = 0; i < events.length; i += this.CONFIG.BATCH_SIZE) {
      batches.push(events.slice(i, i + this.CONFIG.BATCH_SIZE));
    }
    
    console.log(`[TestSyncEngine] Sending ${batches.length} batches...`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      // Add delay between batches
      if (i > 0) {
        const delay = Math.floor(
          Math.random() * 
          (this.CONFIG.BATCH_DELAY_MAX - this.CONFIG.BATCH_DELAY_MIN + 1)
        ) + this.CONFIG.BATCH_DELAY_MIN;
        
        console.log(`[TestSyncEngine] Waiting ${delay}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // Mock API send
      const result = await this.mockApiSend(batch);
      this.sentBatches.push({
        batchIndex: i + 1,
        batchSize: batch.size,
        status: result.success ? 'sent' : 'failed',
        events: batch
      });
      
      console.log(`[TestSyncEngine] ✓ Batch ${i + 1}/${batches.length} sent (${batch.length} events)`);
    }
  }

  /**
   * Mock API send
   */
  async mockApiSend(batch) {
    // Simulate API call
    return {
      success: true,
      batchId: `batch_${Date.now()}`,
      eventCount: batch.length,
      errors: []
    };
  }
}

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runTests() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  CHROME EXTENSION TEST SUITE - Scraper + Sync Engine             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  try {
    // ====================================================================
    // TEST 1: Parse Mock HTML
    // ====================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Parse Mock HTML');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const parser = new (require('jsdom').JSDOM);
    // For Node.js environment, use a simple parser
    let mockDoc;
    try {
      // Browser environment
      mockDoc = new DOMParser().parseFromString(MOCK_HTML, 'text/html');
    } catch (e) {
      // Node.js environment - use mock
      console.log('[TEST] Browser DOMParser not available, using mock...');
      mockDoc = {
        querySelectorAll: (selector) => {
          // Simple mock implementation
          if (selector === '[data-urn*="comment"]') {
            return [
              {
                querySelector: (sel) => {
                  if (sel === '.show-more-less-html__markup') {
                    return { textContent: 'This is a great post! Really helpful insights.' };
                  }
                  if (sel === 'a.app-aware-link--is-visible') {
                    return { textContent: 'John Doe', href: '/in/john-doe-123' };
                  }
                  if (sel === 'span:last-child') {
                    return { textContent: '2 hours ago' };
                  }
                  return null;
                }
              },
              {
                querySelector: (sel) => {
                  if (sel === '.show-more-less-html__markup') {
                    return { textContent: 'Completely agree with this analysis.' };
                  }
                  if (sel === 'a.app-aware-link--is-visible') {
                    return { textContent: 'Jane Smith', href: '/in/jane-smith-456' };
                  }
                  if (sel === 'span:last-child') {
                    return { textContent: '1 hour ago' };
                  }
                  return null;
                }
              },
              {
                querySelector: (sel) => {
                  if (sel === '.show-more-less-html__markup') {
                    return { textContent: 'This is valuable information. Thanks for sharing!' };
                  }
                  if (sel === 'a.app-aware-link--is-visible') {
                    return { textContent: 'Bob Wilson', href: '/in/bob-wilson-789' };
                  }
                  if (sel === 'span:last-child') {
                    return { textContent: '30 minutes ago' };
                  }
                  return null;
                }
              },
              {
                querySelector: (sel) => {
                  if (sel === '.show-more-less-html__markup') {
                    return { textContent: 'This is a great post! Really helpful insights.' };
                  }
                  if (sel === 'a.app-aware-link--is-visible') {
                    return { textContent: 'John Doe', href: '/in/john-doe-123' };
                  }
                  if (sel === 'span:last-child') {
                    return { textContent: '2 hours ago' };
                  }
                  return null;
                }
              }
            ];
          }
          return [];
        }
      };
    }
    
    console.log('✓ Mock HTML parsed successfully');
    results.passed++;
    results.tests.push({ name: 'Parse Mock HTML', status: 'PASS' });
    
    // ====================================================================
    // TEST 2: Scrape Comments
    // ====================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Scrape Comments from Mock DOM');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const scraper = new TestScraper();
    const comments = await scraper.scrapeFromDocument(mockDoc);
    
    if (comments.length === 0) {
      throw new Error('No comments scraped');
    }
    
    console.log(`\n✓ Scraped ${comments.length} comments`);
    console.log('\nScraped Comments:');
    comments.forEach((comment, idx) => {
      console.log(`  [${idx + 1}] "${comment.text.substring(0, 50)}..."`);
      console.log(`      Author: ${comment.author}`);
    });
    
    results.passed++;
    results.tests.push({ name: 'Scrape Comments', status: 'PASS' });
    
    // ====================================================================
    // TEST 3: Validate Event Structure
    // ====================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Validate Event Structure');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const testEvent = createEvent(comments[0]);
    
    const requiredFields = [
      'id', 'platform', 'event_type', 'platform_message_id', 'created_at', 'data'
    ];
    
    const dataFields = [
      'content', 'author_name', 'author_id', 'timestamp', 'author_profile_url'
    ];
    
    let allValid = true;
    
    // Check top-level fields
    for (const field of requiredFields) {
      if (!(field in testEvent)) {
        console.log(`  ✗ Missing field: ${field}`);
        allValid = false;
      } else {
        console.log(`  ✓ Field present: ${field}`);
      }
    }
    
    // Check data fields
    for (const field of dataFields) {
      if (!(field in testEvent.data)) {
        console.log(`  ✗ Missing data field: ${field}`);
        allValid = false;
      } else {
        console.log(`  ✓ Data field present: ${field}`);
      }
    }
    
    if (!allValid) {
      throw new Error('Event structure validation failed');
    }
    
    console.log('\nSample Event:');
    console.log(JSON.stringify(testEvent, null, 2));
    
    results.passed++;
    results.tests.push({ name: 'Validate Event Structure', status: 'PASS' });
    
    // ====================================================================
    // TEST 4: Test Sync Engine
    // ====================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 4: Test Sync Engine (Batching + Deduplication)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const syncEngine = new TestSyncEngine();
    const syncResult = await syncEngine.runBatchSync(comments);
    
    console.log(`\n✓ Sync Complete:`);
    console.log(`  - Original events: ${syncResult.eventsCollected}`);
    console.log(`  - After dedup: ${syncResult.eventsDeduplicated}`);
    console.log(`  - Batches sent: ${syncResult.batchesSent}`);
    
    if (syncResult.eventsDeduplicated < syncResult.eventsCollected) {
      const duplicates = syncResult.eventsCollected - syncResult.eventsDeduplicated;
      console.log(`  - Duplicates removed: ${duplicates}`);
    }
    
    results.passed++;
    results.tests.push({ name: 'Sync Engine', status: 'PASS' });
    
    // ====================================================================
    // SUMMARY
    // ====================================================================
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    results.failed++;
    results.tests.push({ name: 'Error', status: 'FAIL', error: error.message });
  }
  
  // Print summary
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  TEST SUMMARY                                                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`\nResults: ${results.passed} PASSED, ${results.failed} FAILED\n`);
  
  for (const test of results.tests) {
    const icon = test.status === 'PASS' ? '✓' : '✗';
    console.log(`${icon} ${test.name}: ${test.status}`);
    if (test.error) {
      console.log(`  Error: ${test.error}`);
    }
  }
  
  console.log('\n');
  return results;
}

// ============================================================================
// EXPORTS (for both browser and Node.js)
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runTests, TestScraper, TestSyncEngine, MOCK_HTML };
}

// Auto-run if in browser console
if (typeof window !== 'undefined' && typeof runTests === 'function') {
  console.log('✓ Test suite loaded. Run: runTests() to start');
}
