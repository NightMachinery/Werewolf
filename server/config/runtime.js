const DEFAULT_PUBLIC_BASE_URL = 'https://play-werewolf.app';
const DEFAULT_REDIS_CHANNEL = 'active_game_stream';

function getSanitizedPublicBaseUrl () {
    const raw = process.env.PUBLIC_BASE_URL?.trim();
    if (!raw) {
        return DEFAULT_PUBLIC_BASE_URL;
    }

    try {
        const parsed = new URL(raw);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        if (pathname && pathname !== '') {
            throw new Error('PUBLIC_BASE_URL cannot include a path.');
        }
        if (parsed.search || parsed.hash) {
            throw new Error('PUBLIC_BASE_URL cannot include query parameters or fragments.');
        }
        return parsed.origin;
    } catch (e) {
        console.warn('Ignoring invalid PUBLIC_BASE_URL:', e.message);
        return DEFAULT_PUBLIC_BASE_URL;
    }
}

function getPublicRuntimeConfig () {
    const publicBaseUrl = getSanitizedPublicBaseUrl();
    const parsed = new URL(publicBaseUrl);
    return {
        publicBaseUrl,
        publicOrigin: parsed.origin,
        publicProtocol: parsed.protocol,
        publicHost: parsed.host,
        forceHttps: parsed.protocol === 'https:',
        redisChannelActiveGameStream: process.env.REDIS_CHANNEL_ACTIVE_GAME_STREAM?.trim() || DEFAULT_REDIS_CHANNEL
    };
}

module.exports = { getPublicRuntimeConfig, DEFAULT_PUBLIC_BASE_URL, DEFAULT_REDIS_CHANNEL };
