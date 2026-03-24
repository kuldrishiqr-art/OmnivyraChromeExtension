#!/usr/bin/env node

/**
 * SCRAPER + SYNC ENGINE TEST RUNNER
 * 
 * Standalone Node.js executable for testing:
 * - DOM simulation
 * - Scraper without LinkedIn
 * - Sync engine batching
 * - Event validation
 * 
 * Run: node scraper-sync-test-runner.js
 */

// ============================================================================
// MOCK DOM IMPLEMENTATION
// ============================================================================

class MockElement {
  constructor(data = {}) {
    this.textContent = data.textContent || '';
    this.href = data.href || '';
    this.dataset = { urn: data.urn || '' };
  }
}

class MockDocument {
  constructor(mockComments = []) {
    this.mockComments = mockComments;
  }

  querySelectorAll(selector) {
    if (selector === '[data-urn*="comment"]') {
      return this.mockComments;
    }
    return [];
  }
}

class MockCommentElement {
  constructor(commentData) {
    this.data = commentData;
  }

  querySelector(selector) {
    if (selector === '.show-more-less-html__markup') {
      return new MockElement({ textContent: this.data.content });
    }
    if (selector === 'a.app-aware-link--is-visible') {
      return new MockElement({ 
        textContent: this.data.author,
        href: `/in/${this.data.authorId}`
      });
    }
    if (selector === 'span:last-child') {
      return new MockElement({ textContent: this.data.timestamp });
    }
    return null;
  }
}

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_COMMENTS_DATA = [
  {
    content: 'This is a great post! Really helpful insights.',
    author: 'John Doe',
    authorId: 'john-doe-123',
    timestamp: '2 hours ago'
  },
  {
    content: 'Completely agree with this analysis. Well articulated.',
    author: 'Jane Smith',
    authorId: 'jane-smith-456',
    timestamp: '1 hour ago'
  },
  {
    content: 'This is valuable information. Thanks for sharing!',
    author: 'Bob Wilson',
    authorId: 'bob-wilson-789',
    timestamp: '30 minutes ago'
  },
  {
    // Duplicate of first comment (for dedup testing)
    content: 'This is a great post! Really helpful insights.',
    author: 'John Doe',
    authorId: 'john-doe-123',
    timestamp: '2 hours ago'
  }
];

// ============================================================================
// SCRAPER IMPLEMENTATION
// ============================================================================

class Scraper {
  constructor() {
    this.CONFIG = {
      MAX_COMMENTS: 20,
      ITEM_DELAY_MIN: 50,   // Shorter for test
      ITEM_DELAY_MAX: 100
    };
    
    this.SELECTORS = {
      COMMENT_CONTAINER: '[data-urn*="comment"]',
      CONTENT: '.show-more-less-html__markup',
      AUTHOR_NAME: 'a.app-aware-link--is-visible',
      TIMESTAMP: 'span:last-child'
    };
  }

  async scrapeFromDocument(doc) {
    console.log('[Scraper] Starting scrape from document...');
    
    const comments = [];
    const commentElements = doc.querySelectorAll(this.SELECTORS.COMMENT_CONTAINER);
    
    console.log(`[Scraper] Found ${commentElements.length} comment elements\n`);
    
    for (let i = 0; i < Math.min(commentElements.length, this.CONFIG.MAX_COMMENTS); i++) {
      // Small delay between extractions
      await this.delay(
        this.CONFIG.ITEM_DELAY_MIN,
        this.CONFIG.ITEM_DELAY_MAX
      );
      
      const element = commentElements[i];
      const comment = this.extractComment(element);
      
      if (comment) {
        comments.push(comment);
        console.log(`  ✓ Comment ${i + 1}: "${comment.text.substring(0, 50)}..."`);
      }
    }
    
    return comments;
  }

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
      
      return {
        text,
        author,
        authorId: this.extractAuthorId(authorLink),
        timestamp,
        authorLink
      };
    } catch (error) {
      console.error(`  ✗ Error extracting comment: ${error.message}`);
      return null;
    }
  }

  extractAuthorId(link) {
    const match = link.match(/\/in\/([^/]+)/);
    return match ? match[1] : 'unknown';
  }

  delay(min, max) {
    const ms = Math.floor(Math.random() * (max - min)) + min;
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// EVENT CREATION
// ============================================================================

function createEvent(comment) {
  const eventId = `linkedin_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  return {
    id: eventId,
    platform: 'linkedin',
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
// SYNC ENGINE
// ============================================================================

class SyncEngine {
  constructor() {
    this.CONFIG = {
      MAX_EVENTS_PER_RUN: 20,
      BATCH_SIZE: 5,
      BATCH_DELAY_MIN: 50,
      BATCH_DELAY_MAX: 100
    };
    
    this.sentBatches = [];
  }

  async runBatchSync(comments) {
    console.log(`[SyncEngine] Starting batch sync with ${comments.length} comments...\n`);
    
    // Step 1: Create events
    const events = comments.map(comment => createEvent(comment));
    console.log(`[SyncEngine] Created ${events.length} events\n`);
    
    // Step 2: Deduplicate
    const dedupedEvents = this.deduplicateEvents(events);
    console.log(`[SyncEngine] After dedup: ${dedupedEvents.length} unique events\n`);
    
    // Step 3: Batch and send
    await this.sendInBatches(dedupedEvents);
    
    return {
      success: true,
      eventsCollected: events.length,
      eventsDeduplicated: dedupedEvents.length,
      batchesSent: this.sentBatches.length,
      sentBatches: this.sentBatches
    };
  }

  deduplicateEvents(events) {
    const deduped = [];
    const seen = new Set();
    
    for (const event of events) {
      const hash = this.hashEvent(event);
      
      if (!seen.has(hash)) {
        seen.add(hash);
        deduped.push(event);
      }
    }
    
    return deduped;
  }

  hashEvent(event) {
    return `${event.data.author_name}:${event.data.content}`;
  }

  async sendInBatches(events) {
    const batches = [];
    
    for (let i = 0; i < events.length; i += this.CONFIG.BATCH_SIZE) {
      batches.push(events.slice(i, i + this.CONFIG.BATCH_SIZE));
    }
    
    console.log(`[SyncEngine] Sending ${batches.length} batches:\n`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      // Delay between batches
      if (i > 0) {
        const delay = Math.floor(
          Math.random() * (this.CONFIG.BATCH_DELAY_MAX - this.CONFIG.BATCH_DELAY_MIN)
        ) + this.CONFIG.BATCH_DELAY_MIN;
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const result = await this.mockApiSend(batch, i + 1, batches.length);
      this.sentBatches.push(result);
    }
    
    console.log(`[SyncEngine] ✓ All batches sent\n`);
  }

  async mockApiSend(batch, batchIndex, totalBatches) {
    console.log(`  Batch ${batchIndex}/${totalBatches}: Sending ${batch.length} events`);
    
    return {
      batchIndex,
      batchSize: batch.length,
      status: 'sent',
      timestamp: new Date().toISOString()
    };
  }
}

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runTests() {
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  CHROME EXTENSION TEST - Scraper + Sync Engine (No LinkedIn)      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  
  const results = {
    tests: [],
    passed: 0,
    failed: 0
  };
  
  try {
    // TEST 1: Parse Mock HTML
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Create Mock Document');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const mockElements = MOCK_COMMENTS_DATA.map(data => new MockCommentElement(data));
    const mockDoc = new MockDocument(mockElements);
    
    console.log(`✓ Created mock document with ${mockElements.length} comment elements\n`);
    results.passed++;
    results.tests.push({ name: 'Mock Document', status: 'PASS' });
    
    // TEST 2: Scrape Comments
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Scrape Comments from Mock DOM');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const scraper = new Scraper();
    const comments = await scraper.scrapeFromDocument(mockDoc);
    
    if (comments.length === 0) throw new Error('No comments scraped');
    
    console.log(`\n✓ Successfully scraped ${comments.length} comments\n`);
    results.passed++;
    results.tests.push({ name: 'Scraper', status: 'PASS' });
    
    // TEST 3: Event Structure Validation
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Validate Event Structure');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const event = createEvent(comments[0]);
    const requiredFields = ['id', 'platform', 'event_type', 'platform_message_id', 'created_at', 'data'];
    const dataFields = ['content', 'author_name', 'author_id', 'timestamp', 'author_profile_url'];
    
    let valid = true;
    for (const field of requiredFields) {
      if (!(field in event)) {
        console.log(`  ✗ Missing field: ${field}`);
        valid = false;
      }
    }
    
    for (const field of dataFields) {
      if (!(field in event.data)) {
        console.log(`  ✗ Missing data field: ${field}`);
        valid = false;
      }
    }
    
    if (valid) {
      console.log('✓ All required fields present\n');
      console.log('Sample Event Structure:');
      console.log(JSON.stringify(event, null, 2));
      console.log();
      results.passed++;
    } else {
      throw new Error('Event structure validation failed');
    }
    
    results.tests.push({ name: 'Event Structure', status: 'PASS' });
    
    // TEST 4: Sync Engine
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 4: Sync Engine (Batching + Deduplication)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const syncEngine = new SyncEngine();
    const syncResult = await syncEngine.runBatchSync(comments);
    
    console.log('Sync Complete:');
    console.log(`  Original events:        ${syncResult.eventsCollected}`);
    console.log(`  After deduplication:    ${syncResult.eventsDeduplicated}`);
    console.log(`  Duplicates removed:     ${syncResult.eventsCollected - syncResult.eventsDeduplicated}`);
    console.log(`  Batches sent:           ${syncResult.batchesSent}`);
    console.log();
    
    results.passed++;
    results.tests.push({ name: 'Sync Engine', status: 'PASS' });
    
  } catch (error) {
    console.error(`\n✗ TEST FAILED: ${error.message}\n`);
    results.failed++;
    results.tests.push({ name: 'Error', status: 'FAIL', error: error.message });
  }
  
  // SUMMARY
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  TEST RESULTS SUMMARY                                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  
  for (const test of results.tests) {
    const icon = test.status === 'PASS' ? '✓' : '✗';
    console.log(`${icon} ${test.name}: ${test.status}`);
    if (test.error) console.log(`  Error: ${test.error}`);
  }
  
  console.log(`\nResults: ${results.passed}/${results.passed + results.failed} tests passed\n`);
  
  if (results.failed === 0) {
    console.log('🎉 ALL TESTS PASSED!\n');
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED\n');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
