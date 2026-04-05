const path = require('path');

const runtimeModulePath = path.resolve(__dirname, '../../../../server/config/runtime.js');
const globalsModulePath = path.resolve(__dirname, '../../../../server/config/globals.js');

function clearModule (modulePath) {
    delete require.cache[modulePath];
}

describe('server runtime config', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        clearModule(runtimeModulePath);
        clearModule(globalsModulePath);
    });

    it('should derive public runtime config from PUBLIC_BASE_URL and REDIS_CHANNEL_ACTIVE_GAME_STREAM', () => {
        process.env.PUBLIC_BASE_URL = 'http://mafia.example.test/';
        process.env.REDIS_CHANNEL_ACTIVE_GAME_STREAM = 'werewolf:mafia-example-test:active_game_stream';

        clearModule(runtimeModulePath);
        const { getPublicRuntimeConfig } = require(runtimeModulePath);
        const config = getPublicRuntimeConfig();

        expect(config.publicBaseUrl).toEqual('http://mafia.example.test');
        expect(config.publicOrigin).toEqual('http://mafia.example.test');
        expect(config.publicProtocol).toEqual('http:');
        expect(config.publicHost).toEqual('mafia.example.test');
        expect(config.forceHttps).toBeFalse();
        expect(config.redisChannelActiveGameStream).toEqual('werewolf:mafia-example-test:active_game_stream');
    });

    it('should fall back to the default public URL when PUBLIC_BASE_URL is invalid', () => {
        process.env.PUBLIC_BASE_URL = 'https://example.com/bad-path';
        spyOn(console, 'warn');

        clearModule(runtimeModulePath);
        const { getPublicRuntimeConfig, DEFAULT_PUBLIC_BASE_URL } = require(runtimeModulePath);
        const config = getPublicRuntimeConfig();

        expect(config.publicBaseUrl).toEqual(DEFAULT_PUBLIC_BASE_URL);
        expect(config.forceHttps).toBeTrue();
        expect(console.warn).toHaveBeenCalled();
    });

    it('should make production globals use the configured public origin and redis channel', () => {
        process.env.NODE_ENV = 'production';
        process.env.PUBLIC_BASE_URL = 'http://mafia.internal.test';
        process.env.REDIS_CHANNEL_ACTIVE_GAME_STREAM = 'werewolf:mafia-internal-test:active_game_stream';

        clearModule(runtimeModulePath);
        clearModule(globalsModulePath);
        const { CORS_OPTIONS, REDIS_CHANNELS } = require(globalsModulePath);

        expect(CORS_OPTIONS.origin).toEqual('http://mafia.internal.test');
        expect(REDIS_CHANNELS.ACTIVE_GAME_STREAM).toEqual('werewolf:mafia-internal-test:active_game_stream');
    });
});
