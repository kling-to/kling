/**
 * Platform adapter registry
 * Manages and provides access to platform-specific adapters
 */
class PlatformRegistry {
    adapters = new Map();
    configs = new Map();
    /**
     * Register a platform adapter
     */
    register(adapter, config) {
        this.adapters.set(adapter.platform, adapter);
        this.configs.set(adapter.platform, config);
    }
    /**
     * Get a platform adapter
     */
    getAdapter(platform) {
        return this.adapters.get(platform);
    }
    /**
     * Get platform configuration
     */
    getConfig(platform) {
        return this.configs.get(platform);
    }
    /**
     * Check if a platform is registered
     */
    hasAdapter(platform) {
        return this.adapters.has(platform);
    }
    /**
     * Get all registered platforms
     */
    getRegisteredPlatforms() {
        return Array.from(this.adapters.keys());
    }
    /**
     * Get adapter or throw if not found
     */
    getAdapterOrThrow(platform) {
        const adapter = this.adapters.get(platform);
        if (!adapter) {
            throw new Error(`No adapter registered for platform: ${platform}`);
        }
        return adapter;
    }
}
// Singleton instance
export const platformRegistry = new PlatformRegistry();
