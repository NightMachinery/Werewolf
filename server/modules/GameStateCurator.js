const { USER_TYPES, STATUS } = require('../config/globals');
const {
    canAccessBlindMinionEvilInfo,
    canUseEvilChat
} = require('./Enforcement');
const {
    CUSTOM_VOTE_RESULT_DETAILS,
    ensureCustomVoteState,
    isCurrentModeratorPerson
} = require('./CustomVotes');

/* The purpose of this component is to only return the game state information that is necessary. For example, we only
    want to return player role information to moderators. This avoids any possibility of a player having access to
    information that they shouldn't.
 */
const GameStateCurator = {
    getGameStateFromPerspectiveOfPerson: (game, person) => {
        return getGameStateBasedOnPermissions(game, person);
    },

    mapPeopleForModerator: (people) => {
        return people
            .filter((person) => {
                return person.assigned === true || (person.userType === USER_TYPES.SPECTATOR || person.userType === USER_TYPES.MODERATOR);
            })
            .map((person) => ({
                name: person.name,
                id: person.id,
                userType: person.userType,
                gameRole: person.gameRole,
                gameRoleDescription: person.gameRoleDescription,
                alignment: person.alignment,
                revealedAlignment: person.revealedAlignment,
                evilChatAccess: person.evilChatAccess,
                out: person.out,
                killed: person.killed,
                revealed: person.revealed,
                roleState: person.roleState
            }));
    },
    mapPerson: (person) => {
        if (person.revealed) {
            return {
                name: person.name,
                id: person.id,
                userType: person.userType,
                out: person.out,
                killed: person.killed,
                revealed: person.revealed,
                gameRole: person.gameRole,
                alignment: person.revealedAlignment || person.alignment
            };
        } else {
            return { name: person.name, id: person.id, userType: person.userType, out: person.out, killed: person.killed, revealed: person.revealed };
        }
    }
};

function getGameStateBasedOnPermissions (game, person) {
    const client = game.status === STATUS.LOBBY // people won't be able to know their role until past the lobby stage.
        ? { name: person.name, hasEnteredName: person.hasEnteredName, id: person.id, cookie: person.cookie, userType: person.userType }
        : {
            name: person.name,
            hasEnteredName: person.hasEnteredName,
            id: person.id,
            cookie: person.cookie,
            userType: person.userType,
            gameRole: person.gameRole,
            gameRoleDescription: person.gameRoleDescription,
            customRole: person.customRole,
            alignment: person.alignment,
            revealedAlignment: person.revealedAlignment,
            evilChatAccess: person.evilChatAccess,
            out: person.out,
            killed: person.killed,
            roleState: person.roleState
        };
    switch (person.userType) {
        case USER_TYPES.MODERATOR:
            return {
                accessCode: game.accessCode,
                status: game.status,
                currentModeratorId: game.currentModeratorId,
                originalModeratorId: game.originalModeratorId,
                client: client,
                deck: game.deck,
                gameSize: game.gameSize,
                people: GameStateCurator.mapPeopleForModerator(game.people, client),
                timerParams: game.timerParams,
                isStartable: game.isStartable,
                settings: game.settings,
                enforcement: curateEnforcementState(game, person, true),
                customVotes: curateCustomVotes(game, person)
            };
        case USER_TYPES.TEMPORARY_MODERATOR:
        case USER_TYPES.SPECTATOR:
        case USER_TYPES.PLAYER:
        case USER_TYPES.KILLED_PLAYER:
            return {
                accessCode: game.accessCode,
                status: game.status,
                currentModeratorId: game.currentModeratorId,
                originalModeratorId: game.originalModeratorId,
                client: client,
                deck: game.deck,
                gameSize: game.gameSize,
                people: game.people
                    .filter((person) => {
                        return person.assigned === true || person.userType === USER_TYPES.SPECTATOR;
                    })
                    .map((filteredPerson) => GameStateCurator.mapPerson(filteredPerson)),
                timerParams: game.timerParams,
                isStartable: game.isStartable,
                settings: game.settings,
                enforcement: curateEnforcementState(game, person, false),
                customVotes: curateCustomVotes(game, person)
            };
        default:
            break;
    }
}

function curateEnforcementState (game, person, moderatorView) {
    if (!game.enforcement?.enabled) {
        return null;
    }

    const openVote = game.enforcement.openVote;
    let curatedVote = null;
    if (openVote) {
        curatedVote = {
            type: openVote.type,
            round: openVote.round,
            status: openVote.status,
            candidateIds: openVote.candidateIds,
            deadVoteWindowStartedAt: openVote.deadVoteWindowStartedAt || null,
            deadVoteWindowEndsAt: openVote.deadVoteWindowEndsAt || null,
            yourBallot: openVote.ballots[person.id] || null
        };

        if (moderatorView || openVote.status === 'closed' || (openVote.type === 'night' && canUseEvilChat(person))) {
            curatedVote.ballots = openVote.ballots;
            curatedVote.resolution = openVote.resolution || null;
        }
    }

    let evilHistory = [];
    let evilChat = [];
    let evilRoster = [];
    if (canUseEvilChat(person) && game.enforcement.phase === 'night') {
        const limit = game.settings?.evilVoteHistoryLimit;
        evilHistory = applyEvilVoteHistoryLimit(game.enforcement.evilHistory, limit);
        evilChat = game.enforcement.evilChat;
        evilRoster = game.people
            .filter((candidate) => canUseEvilChat(candidate))
            .map((candidate) => ({ id: candidate.id, name: candidate.name, out: candidate.out }));
    } else if (canAccessBlindMinionEvilInfo(person)) {
        evilHistory = game.enforcement.evilHistory.filter((entry) => entry.shareWithBlindMinion);
    }

    return {
        enabled: true,
        phase: game.enforcement.phase,
        dayNumber: game.enforcement.dayNumber,
        nightNumber: game.enforcement.nightNumber,
        publicHistory: game.enforcement.publicHistory,
        evilHistory,
        evilChat,
        evilRoster,
        openVote: curatedVote,
        privateNotices: game.enforcement.privateNotices[person.id] || [],
        activeHunterPrompt: game.enforcement.activeHunterPrompt
            && (game.enforcement.activeHunterPrompt.hunterId === person.id || moderatorView)
            ? game.enforcement.activeHunterPrompt
            : null,
        countRevealUses: game.enforcement.countRevealUses,
        winner: game.enforcement.winner
    };
}

function curateCustomVotes (game, person) {
    if (game.status !== STATUS.IN_PROGRESS) {
        return null;
    }

    const customVotes = ensureCustomVoteState(game);
    const moderatorView = isCurrentModeratorPerson(game, person);
    const openVote = customVotes.openVote;
    let curatedOpenVote = null;
    if (openVote && (moderatorView || openVote.viewerIds.includes(person.id))) {
        curatedOpenVote = {
            id: openVote.id,
            question: openVote.question,
            optionSource: openVote.optionSource,
            ballotMode: openVote.ballotMode,
            allowPass: openVote.allowPass,
            audiencePreset: openVote.audiencePreset,
            audienceScope: openVote.audienceScope,
            audienceLabel: openVote.audienceLabel,
            resultDetail: openVote.resultDetail,
            status: openVote.status,
            options: openVote.options,
            yourBallot: openVote.ballots[person.id] || null,
            canVote: openVote.eligibleVoterIds.includes(person.id),
            submittedVoterIds: Object.keys(openVote.ballots),
            eligibleVoterIds: openVote.eligibleVoterIds,
            openedAt: openVote.openedAt
        };

        if (moderatorView) {
            curatedOpenVote.ballots = openVote.ballots;
            curatedOpenVote.resolution = buildCuratedCustomVoteResolution(openVote);
        }
    }

    const history = customVotes.history
        .filter((entry) => moderatorView || entry.viewerIds.includes(person.id))
        .map((entry) => ({
            id: entry.id,
            type: entry.type,
            text: entry.text,
            question: entry.question,
            optionSource: entry.optionSource,
            ballotMode: entry.ballotMode,
            allowPass: entry.allowPass,
            audiencePreset: entry.audiencePreset,
            audienceScope: entry.audienceScope,
            audienceLabel: entry.audienceLabel,
            resultDetail: entry.resultDetail,
            options: entry.options,
            totals: entry.totals,
            ballots: entry.resultDetail === CUSTOM_VOTE_RESULT_DETAILS.BALLOTS ? entry.ballots : null,
            winnerOptionIds: entry.winnerOptionIds,
            topScore: entry.topScore,
            submittedBallotCount: entry.submittedBallotCount,
            passCount: entry.passCount,
            openedAt: entry.openedAt,
            closedAt: entry.closedAt
        }));

    return {
        openVote: curatedOpenVote,
        history
    };
}

function buildCuratedCustomVoteResolution (vote) {
    const totals = vote.options.map((option) => ({
        optionId: option.id,
        candidateId: option.personId || option.id,
        candidateName: option.label,
        count: 0
    }));

    for (const ballot of Object.values(vote.ballots)) {
        if (ballot.passed) {
            continue;
        }
        for (const selectionId of ballot.selections) {
            const total = totals.find((entry) => entry.optionId === selectionId);
            if (total) {
                total.count += 1;
            }
        }
    }

    const topScore = totals.length ? Math.max(...totals.map((total) => total.count)) : 0;
    return {
        totals,
        topScore,
        winnerOptionIds: topScore > 0
            ? totals.filter((total) => total.count === topScore).map((total) => total.optionId)
            : []
    };
}

function applyEvilVoteHistoryLimit (history, limit) {
    if (limit === null) {
        return history;
    }

    const voteEntries = history.filter((entry) => entry.type === 'night-vote');
    const keptVoteIds = voteEntries.slice(-limit).map((entry) => entry.id);
    return history.filter((entry) => entry.type !== 'night-vote' || keptVoteIds.includes(entry.id));
}

module.exports = GameStateCurator;
