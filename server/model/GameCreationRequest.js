const { ERROR_MESSAGES, PRIMITIVES, ALIGNMENT } = require('../config/globals');

class GameCreationRequest {
    constructor (
        deck,
        hasTimer,
        timerParams,
        moderatorName,
        hasDedicatedModerator,
        isTestGame,
        settings = null
    ) {
        this.deck = deck;
        this.hasTimer = hasTimer;
        this.timerParams = timerParams;
        this.moderatorName = moderatorName;
        this.hasDedicatedModerator = hasDedicatedModerator;
        this.isTestGame = isTestGame;
        this.settings = settings;
    }

    static validate = (gameParams) => {
        const expectedKeys = ['deck', 'hasTimer', 'timerParams', 'moderatorName', 'hasDedicatedModerator', 'isTestGame'];
        if (gameParams === null
            || typeof gameParams !== 'object'
            || expectedKeys.some((key) => !Object.keys(gameParams).includes(key))
            || !valid(gameParams)
        ) {
            return Promise.reject(ERROR_MESSAGES.BAD_CREATE_REQUEST);
        } else {
            return Promise.resolve();
        }
    };

    static deckIsValid = (deck) => {
        if (Array.isArray(deck)) {
            for (const entry of deck) {
                if (entry !== null
                    && typeof entry === 'object'
                    && typeof entry.role === 'string'
                    && entry.role.length > 0
                    && entry.role.length <= PRIMITIVES.MAX_CUSTOM_ROLE_NAME_LENGTH
                    && typeof entry.team === 'string'
                    && (entry.team === ALIGNMENT.GOOD || entry.team === ALIGNMENT.EVIL || entry.team === ALIGNMENT.INDEPENDENT)
                    && (!Object.keys(entry).includes('revealedAlignment')
                        || entry.revealedAlignment === ALIGNMENT.GOOD
                        || entry.revealedAlignment === ALIGNMENT.EVIL
                        || entry.revealedAlignment === ALIGNMENT.INDEPENDENT)
                    && typeof entry.description === 'string'
                    && entry.description.length > 0
                    && entry.description.length <= PRIMITIVES.MAX_CUSTOM_ROLE_DESCRIPTION_LENGTH
                    && (!entry.custom || typeof entry.custom === 'boolean')
                    && (!Object.keys(entry).includes('evilChatAccess') || typeof entry.evilChatAccess === 'boolean')
                    && typeof entry.quantity === 'number'
                    && entry.quantity >= 0
                    && entry.quantity <= 50
                ) {
                    continue;
                }
                return false;
            }
            return true;
        }
        return false;
    }

    static timerParamsAreValid = (hasTimer, timerParams) => {
        if (hasTimer === false) {
            return timerParams === null;
        } else {
            if (timerParams === null || typeof timerParams !== 'object') {
                return false;
            }

            return (timerParams.hours === null && timerParams.minutes > 0 && timerParams.minutes < 60)
                || (timerParams.minutes === null && timerParams.hours > 0 && timerParams.hours < 6)
                || (timerParams.hours === 0 && timerParams.minutes > 0 && timerParams.minutes < 60)
                || (timerParams.minutes === 0 && timerParams.hours > 0 && timerParams.hours < 6)
                || (timerParams.hours > 0 && timerParams.hours < 6 && timerParams.minutes >= 0 && timerParams.minutes < 60);
        }
    };

    static settingsAreValid = (settings) => {
        if (settings === null || settings === undefined) {
            return true;
        }

        return typeof settings === 'object'
            && typeof settings.enforcementEnabled === 'boolean'
            && typeof settings.allowFirstDayVillageVote === 'boolean'
            && typeof settings.allowNightKillVote === 'boolean'
            && (
                settings.evilVoteHistoryLimit === null
                || (Number.isInteger(settings.evilVoteHistoryLimit) && settings.evilVoteHistoryLimit >= 1 && settings.evilVoteHistoryLimit <= 100)
            )
            && (
                settings.maxAlignmentCountReveals === null
                || (Number.isInteger(settings.maxAlignmentCountReveals) && settings.maxAlignmentCountReveals >= 0 && settings.maxAlignmentCountReveals <= 100)
            );
    };
}

function valid (gameParams) {
    return typeof gameParams.hasTimer === 'boolean'
        && typeof gameParams.isTestGame === 'boolean'
        && typeof gameParams.hasDedicatedModerator === 'boolean'
        && typeof gameParams.moderatorName === 'string'
        && gameParams.moderatorName.length > 0
        && gameParams.moderatorName.length <= 30
        && GameCreationRequest.timerParamsAreValid(gameParams.hasTimer, gameParams.timerParams)
        && GameCreationRequest.deckIsValid(gameParams.deck)
        && GameCreationRequest.settingsAreValid(gameParams.settings);
}

module.exports = GameCreationRequest;
