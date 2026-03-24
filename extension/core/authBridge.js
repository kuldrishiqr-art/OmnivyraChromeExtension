/**
 * AUTH BRIDGE - Authentication Management
 * 
 * Handles secure authentication with Omnivyra backend.
 * Manages session tokens, validation, and sync configuration.
 * Accepts tokens from web app via postMessage and popup triggers.
 */

class AuthBridge {
  constructor() {
    this.isAuthenticated = false;
    this.user = null;
    this.userId = null;
    this.orgId = null;
    this.sessionToken = null;
    this.tokenExpiry = null;
    this.validationResult = null;
    this.syncConfig = null;
    this.isValidating = false;
  }

  /**
   * Initialize auth state from storage and validate with backend
   * @returns {Promise<{success: boolean, state: 'authenticated' | 'idle' | 'invalid'}>}
   */
  async init() {
    try {
      console.log('[AuthBridge] Initializing authentication');

      // Load auth from secure storage
      const storedAuth = await this.loadAuthFromStorage();

      if (!storedAuth) {
        console.log('[AuthBridge] No stored authentication found - idle state');
        return { success: true, state: 'idle' };
      }

      // Restore auth state
      this.userId = storedAuth.userId;
      this.orgId = storedAuth.orgId;
      this.sessionToken = storedAuth.sessionToken;
      this.tokenExpiry = storedAuth.tokenExpiry;
      this.user = storedAuth.user;

      // Validate token with backend
      const validationResult = await this.validateSessionWithBackend();

      if (!validationResult.success) {
        console.warn('[AuthBridge] Validation failed - clearing auth state');
        await this.clearAuthState();
        return { success: true, state: 'invalid' };
      }

      this.isAuthenticated = true;
      this.validationResult = validationResult;

      // Store sync configuration
      if (validationResult.sync_mode && validationResult.polling_interval) {
        await this.storeSyncConfig({
          sync_mode: validationResult.sync_mode,
          polling_interval: validationResult.polling_interval
        });
      }

      console.log('[AuthBridge] Authentication validated successfully');
      return { success: true, state: 'authenticated' };
    } catch (error) {
      console.error('[AuthBridge] Initialization error:', error);
      return { success: false, state: 'idle', error: error.message };
    }
  }

  /**
   * Load authentication from secure storage
   * @private
   * @returns {Promise<object|null>}
   */
  async loadAuthFromStorage() {
    try {
      const data = await chrome.storage.local.get('omnivyra_auth');
      if (data.omnivyra_auth) {
        return data.omnivyra_auth;
      }
      return null;
    } catch (error) {
      console.error('[AuthBridge] Failed to load auth from storage:', error);
      return null;
    }
  }

  /**
   * Accept session token from web app via postMessage or popup
   * @param {object} tokenData - Token data from web app
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async acceptSessionToken(tokenData) {
    try {
      // Validate token data structure
      if (!tokenData.sessionToken || !tokenData.userId || !tokenData.orgId) {
        return {
          success: false,
          message: 'Invalid token data: missing required fields'
        };
      }

      console.log('[AuthBridge] Accepting session token from web app');

      // Store token data securely
      this.sessionToken = tokenData.sessionToken;
      this.userId = tokenData.userId;
      this.orgId = tokenData.orgId;
      this.user = tokenData.user || { id: tokenData.userId };
      this.tokenExpiry = tokenData.expiresAt || Date.now() + 24 * 60 * 60 * 1000; // 24h default

      // Persist to storage
      await this.persistAuthToStorage();

      // Validate with backend immediately
      const validationResult = await this.validateSessionWithBackend();

      if (!validationResult.success) {
        await this.clearAuthState();
        return {
          success: false,
          message: 'Token validation failed with backend'
        };
      }

      this.isAuthenticated = true;
      this.validationResult = validationResult;

      // Store sync configuration
      if (validationResult.sync_mode && validationResult.polling_interval) {
        await this.storeSyncConfig({
          sync_mode: validationResult.sync_mode,
          polling_interval: validationResult.polling_interval
        });
      }

      console.log('[AuthBridge] Session token accepted and validated');

      return {
        success: true,
        message: 'Session token accepted and validated'
      };
    } catch (error) {
      console.error('[AuthBridge] Error accepting session token:', error);
      await this.clearAuthState();
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Validate session token with backend
   * @private
   * @returns {Promise<{success: boolean, valid?: boolean, sync_mode?: string, polling_interval?: number}>}
   */
  async validateSessionWithBackend() {
    try {
      if (!this.sessionToken) {
        return { success: false, valid: false };
      }

      if (this.isValidating) {
        console.log('[AuthBridge] Validation already in progress');
        return { success: false };
      }

      this.isValidating = true;

      const response = await fetch('https://api.omnivyra.io/extension/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.sessionToken}`
        },
        body: JSON.stringify({
          userId: this.userId,
          orgId: this.orgId,
          timestamp: new Date().toISOString()
        })
      });

      this.isValidating = false;

      if (!response.ok) {
        if (response.status === 401) {
          console.warn('[AuthBridge] Token expired or invalid (401)');
          await this.clearAuthState();
          return { success: false, valid: false };
        }
        console.error('[AuthBridge] Backend validation error:', response.statusText);
        return { success: false };
      }

      const data = await response.json();

      if (!data.valid) {
        console.warn('[AuthBridge] Backend validation failed');
        await this.clearAuthState();
        return { success: false, valid: false };
      }

      console.log('[AuthBridge] Backend validation successful');

      return {
        success: true,
        valid: true,
        sync_mode: data.sync_mode || 'batch',
        polling_interval: data.polling_interval || 300000 // 5 min default
      };
    } catch (error) {
      console.error('[AuthBridge] Validation error:', error);
      this.isValidating = false;
      return { success: false };
    }
  }

  /**
   * Persist auth state to secure storage
   * @private
   * @returns {Promise<void>}
   */
  async persistAuthToStorage() {
    try {
      const authData = {
        userId: this.userId,
        orgId: this.orgId,
        sessionToken: this.sessionToken,
        user: this.user,
        tokenExpiry: this.tokenExpiry,
        storedAt: new Date().toISOString()
      };

      await chrome.storage.local.set({ omnivyra_auth: authData });
      console.log('[AuthBridge] Auth persisted to storage');
    } catch (error) {
      console.error('[AuthBridge] Failed to persist auth:', error);
      throw error;
    }
  }

  /**
   * Clear all authentication state
   * @private
   * @returns {Promise<void>}
   */
  async clearAuthState() {
    try {
      this.isAuthenticated = false;
      this.user = null;
      this.userId = null;
      this.orgId = null;
      this.sessionToken = null;
      this.tokenExpiry = null;
      this.validationResult = null;
      this.syncConfig = null;

      await chrome.storage.local.remove('omnivyra_auth');
      console.log('[AuthBridge] Auth state cleared');
    } catch (error) {
      console.error('[AuthBridge] Error clearing auth state:', error);
    }
  }

  /**
   * Store sync configuration from backend
   * @private
   * @param {object} config - Sync configuration
   * @returns {Promise<void>}
   */
  async storeSyncConfig(config) {
    try {
      const syncConfig = {
        sync_mode: config.sync_mode,
        polling_interval: config.polling_interval,
        storedAt: new Date().toISOString()
      };

      await chrome.storage.local.set({ omnivyra_sync_config: syncConfig });
      this.syncConfig = syncConfig;
      console.log('[AuthBridge] Sync config stored:', syncConfig);
    } catch (error) {
      console.error('[AuthBridge] Failed to store sync config:', error);
    }
  }

  /**
   * Logout and clear session
   * @returns {Promise<void>}
   */
  async logout() {
    console.log('[AuthBridge] Logging out');
    await this.clearAuthState();
  }

  /**
   * Check if token is expired
   * @returns {boolean}
   */
  isTokenExpired() {
    if (!this.tokenExpiry) return true;
    return Date.now() > this.tokenExpiry;
  }

  /**
   * Get current session token
   * @returns {string|null}
   */
  getSessionToken() {
    if (this.isTokenExpired()) {
      return null;
    }
    return this.sessionToken;
  }

  /**
   * Get current user ID
   * @returns {string|null}
   */
  getUserId() {
    return this.isAuthenticated ? this.userId : null;
  }

  /**
   * Get current organization ID
   * @returns {string|null}
   */
  getOrgId() {
    return this.isAuthenticated ? this.orgId : null;
  }

  /**
   * Get current user info
   * @returns {object|null}
   */
  getUser() {
    return this.isAuthenticated ? this.user : null;
  }

  /**
   * Get complete authentication state
   * @returns {object}
   */
  getAuth() {
    return {
      isAuthenticated: this.isAuthenticated,
      userId: this.userId,
      orgId: this.orgId,
      user: this.user,
      sessionToken: this.isTokenExpired() ? null : this.sessionToken,
      syncConfig: this.syncConfig
    };
  }

  /**
   * Check authentication status
   * @returns {boolean}
   */
  isAuthenticated() {
    return this.isAuthenticated && !this.isTokenExpired();
  }

  /**
   * Get sync configuration
   * @returns {object|null}
   */
  getSyncConfig() {
    return this.syncConfig || null;
  }

  /**
   * Revalidate current session with backend
   * @returns {Promise<{success: boolean, valid: boolean}>}
   */
  async revalidateSession() {
    if (!this.isAuthenticated) {
      return { success: false, valid: false };
    }

    const result = await this.validateSessionWithBackend();
    return {
      success: result.success,
      valid: result.valid || false
    };
  }
}

// Export singleton instance
const authBridge = new AuthBridge();
