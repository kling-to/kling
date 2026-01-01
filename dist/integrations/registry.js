class PlatformRegistry {
    adapters = new Map();
    configs = new Map();
    register(adapter, config) {
        this.adapters.set(adapter.platform, adapter);
        this.configs.set(adapter.platform, config);
    }
    getAdapter(platform) {
        return this.adapters.get(platform);
    }
    getConfig(platform) {
        return this.configs.get(platform);
    }
    hasAdapter(platform) {
        return this.adapters.has(platform);
    }
    getRegisteredPlatforms() {
        return Array.from(this.adapters.keys());
    }
    getAdapterOrThrow(platform) {
        const adapter = this.adapters.get(platform);
        if (!adapter) {
            throw new Error(`No adapter registered for platform: ${platform}`);
        }
        return adapter;
    }
}
export const platformRegistry = new PlatformRegistry();
