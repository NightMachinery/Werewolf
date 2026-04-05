const fs = require('fs');
const { DEFAULT_PUBLIC_BASE_URL, getPublicRuntimeConfig } = require('../config/runtime');

function checkIfFileExists (file) {
    return fs.promises.access(file, fs.constants.F_OK)
        .then(() => true)
        .catch((e) => { console.error(e); return false; });
}

async function sendConfiguredHtml (res, filePath) {
    const html = await fs.promises.readFile(filePath, 'utf8');
    const { publicBaseUrl } = getPublicRuntimeConfig();
    res.type('html').send(html.replaceAll(DEFAULT_PUBLIC_BASE_URL, publicBaseUrl));
}

module.exports = {
    checkIfFileExists,
    sendConfiguredHtml
};
