const express = require('express');
const router = express.Router({ strict: true });
const path = require('path');
const rateLimit = require('express-rate-limit').default;
const { sendConfiguredHtml } = require('./util');

const htmlPageLimiter = rateLimit({
    windowMs: 60000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});

router.get('/', htmlPageLimiter, async function (request, response, next) {
    try {
        await sendConfiguredHtml(response, path.join(__dirname, '../../client/src/views/home.html'));
    } catch (e) {
        next(e);
    }
});

router.get('/create', htmlPageLimiter, async function (request, response, next) {
    try {
        await sendConfiguredHtml(response, path.join(__dirname, '../../client/src/views/create.html'));
    } catch (e) {
        next(e);
    }
});

router.get('/join/:code', htmlPageLimiter, async function (request, response, next) {
    try {
        await sendConfiguredHtml(response, path.join(__dirname, '../../client/src/views/join.html'));
    } catch (e) {
        next(e);
    }
});

router.get('/how-to-use', htmlPageLimiter, async function (request, response, next) {
    try {
        await sendConfiguredHtml(response, path.join(__dirname, '../../client/src/views/how-to-use.html'));
    } catch (e) {
        next(e);
    }
});

router.get('/game/:code', htmlPageLimiter, async function (request, response, next) {
    try {
        await sendConfiguredHtml(response, path.join(__dirname, '../../client/src/views/game.html'));
    } catch (e) {
        next(e);
    }
});

router.get('/liveness_check', htmlPageLimiter, (req, res) => {
    res.sendStatus(200);
});

router.get('/readiness_check', htmlPageLimiter, (req, res) => {
    res.sendStatus(200);
});

module.exports = router;
