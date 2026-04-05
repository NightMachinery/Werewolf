const fs = require('fs');
const os = require('os');
const path = require('path');

const utilModulePath = path.resolve(__dirname, '../../../../server/routes/util.js');
const runtimeModulePath = path.resolve(__dirname, '../../../../server/config/runtime.js');

function clearModule (modulePath) {
    delete require.cache[modulePath];
}

describe('server route utilities', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        clearModule(utilModulePath);
        clearModule(runtimeModulePath);
    });

    it('should replace the default public base URL when serving configured html', async () => {
        process.env.PUBLIC_BASE_URL = 'http://mafia.internal.test';
        clearModule(runtimeModulePath);
        clearModule(utilModulePath);
        const { sendConfiguredHtml } = require(utilModulePath);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'werewolf-html-'));
        const htmlPath = path.join(tempDir, 'index.html');
        fs.writeFileSync(htmlPath, '<meta property="og:url" content="https://play-werewolf.app/create">');

        let body = null;
        const res = {
            type: () => res,
            send: (value) => {
                body = value;
                return res;
            }
        };

        await sendConfiguredHtml(res, htmlPath);

        expect(body).toContain('http://mafia.internal.test/create');
        expect(body).not.toContain('https://play-werewolf.app/create');
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
