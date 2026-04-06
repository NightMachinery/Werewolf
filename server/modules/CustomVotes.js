const { ALIGNMENT, USER_TYPES } = require('../config/globals');
const { canUseEvilChat } = require('./Enforcement');

const CUSTOM_VOTE_OPTION_SOURCES = {
    CUSTOM: 'custom',
    PLAYERS: 'players'
};

const CUSTOM_VOTE_BALLOT_MODES = {
    SINGLE: 'single',
    MULTI: 'multi'
};

const CUSTOM_VOTE_AUDIENCE_PRESETS = {
    ALL: 'all',
    GOOD: 'good',
    EVIL: 'evil',
    INDEPENDENT: 'independent',
    EVIL_KNOWN: 'evilKnown',
    BLIND_MINION: 'blindMinion',
    MODERATOR_ONLY: 'moderatorOnly'
};

const CUSTOM_VOTE_AUDIENCE_SCOPES = {
    LIVING: 'living',
    ALL: 'all'
};

const CUSTOM_VOTE_RESULT_DETAILS = {
    TOTALS: 'totals',
    BALLOTS: 'ballots'
};

function createCustomVoteState () {
    return {
        openVote: null,
        history: []
    };
}

function ensureCustomVoteState (game) {
    if (!game.customVotes) {
        game.customVotes = createCustomVoteState();
    }
    return game.customVotes;
}

function createCustomVoteEntryId () {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function isCurrentModeratorPerson (game, person) {
    return Boolean(
        person
        && person.id === game.currentModeratorId
        && (person.userType === USER_TYPES.MODERATOR || person.userType === USER_TYPES.TEMPORARY_MODERATOR)
    );
}

function isEligibleAudiencePerson (person) {
    return Boolean(
        person
        && person.assigned === true
        && person.userType !== USER_TYPES.SPECTATOR
        && person.userType !== USER_TYPES.MODERATOR
    );
}

function getPlayerOptionPeople (game) {
    return game.people.filter((person) => isEligibleAudiencePerson(person));
}

function getAudienceMembers (game, audiencePreset, audienceScope = CUSTOM_VOTE_AUDIENCE_SCOPES.LIVING) {
    if (audiencePreset === CUSTOM_VOTE_AUDIENCE_PRESETS.MODERATOR_ONLY) {
        const moderator = game.people.find((person) => isCurrentModeratorPerson(game, person));
        return moderator ? [moderator] : [];
    }

    return game.people
        .filter((person) => isEligibleAudiencePerson(person))
        .filter((person) => {
            switch (audiencePreset) {
                case CUSTOM_VOTE_AUDIENCE_PRESETS.ALL:
                    return true;
                case CUSTOM_VOTE_AUDIENCE_PRESETS.GOOD:
                    return person.alignment === ALIGNMENT.GOOD;
                case CUSTOM_VOTE_AUDIENCE_PRESETS.EVIL:
                    return person.alignment === ALIGNMENT.EVIL;
                case CUSTOM_VOTE_AUDIENCE_PRESETS.INDEPENDENT:
                    return person.alignment === ALIGNMENT.INDEPENDENT;
                case CUSTOM_VOTE_AUDIENCE_PRESETS.EVIL_KNOWN:
                    return canUseEvilChat(person);
                case CUSTOM_VOTE_AUDIENCE_PRESETS.BLIND_MINION:
                    return person.gameRole === 'Blind Minion';
                default:
                    return false;
            }
        })
        .filter((person) => audienceScope === CUSTOM_VOTE_AUDIENCE_SCOPES.ALL || !person.out);
}

function normalizeOptionLabels (labels) {
    if (!Array.isArray(labels)) {
        return [];
    }

    const deduped = [];
    for (const label of labels) {
        if (typeof label !== 'string') {
            continue;
        }
        const trimmed = label.trim();
        if (!trimmed || deduped.includes(trimmed)) {
            continue;
        }
        deduped.push(trimmed);
    }
    return deduped;
}

function buildCustomVoteOptionsFromLabels (labels) {
    return normalizeOptionLabels(labels).map((label, index) => ({
        id: 'option-' + index,
        label
    }));
}

function buildCustomVoteOptionsFromPeople (game, personIds) {
    if (!Array.isArray(personIds)) {
        return [];
    }

    const options = [];
    for (const personId of personIds) {
        if (options.find((option) => option.personId === personId)) {
            continue;
        }
        const person = getPlayerOptionPeople(game).find((candidate) => candidate.id === personId);
        if (!person) {
            continue;
        }
        options.push({
            id: 'option-' + options.length,
            label: person.name,
            personId: person.id
        });
    }
    return options;
}

function tallyCustomVote (vote) {
    const totals = vote.options.reduce((accumulator, option) => {
        accumulator[option.id] = 0;
        return accumulator;
    }, {});

    let countedSelections = 0;
    let passCount = 0;
    for (const ballot of Object.values(vote.ballots || {})) {
        if (ballot.passed) {
            passCount += 1;
            continue;
        }

        for (const selection of ballot.selections || []) {
            if (Object.prototype.hasOwnProperty.call(totals, selection)) {
                totals[selection] += 1;
                countedSelections += 1;
            }
        }
    }

    const topScore = countedSelections === 0
        ? 0
        : Math.max(...Object.values(totals));
    const winnerOptionIds = countedSelections === 0
        ? []
        : Object.entries(totals)
            .filter(([, total]) => total === topScore)
            .map(([optionId]) => optionId);

    return {
        totals,
        topScore,
        winnerOptionIds,
        submittedBallotCount: Object.keys(vote.ballots || {}).length,
        passCount
    };
}

module.exports = {
    CUSTOM_VOTE_AUDIENCE_PRESETS,
    CUSTOM_VOTE_AUDIENCE_SCOPES,
    CUSTOM_VOTE_BALLOT_MODES,
    CUSTOM_VOTE_OPTION_SOURCES,
    CUSTOM_VOTE_RESULT_DETAILS,
    buildCustomVoteOptionsFromLabels,
    buildCustomVoteOptionsFromPeople,
    createCustomVoteEntryId,
    createCustomVoteState,
    ensureCustomVoteState,
    getAudienceMembers,
    getPlayerOptionPeople,
    isCurrentModeratorPerson,
    tallyCustomVote
};
