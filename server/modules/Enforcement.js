const { ALIGNMENT, USER_TYPES, STATUS } = require('../config/globals');

const PHASES = {
    DAY: 'day',
    NIGHT: 'night'
};

const VOTE_TYPES = {
    DAY: 'day',
    NIGHT: 'night'
};

const ACTION_TYPES = {
    INSPECT: 'inspect',
    SENSE_SEER: 'senseSeer',
    PROTECT: 'protect',
    HEAL: 'heal',
    POISON: 'poison',
    BRUTAL_TARGET: 'brutalTarget'
};

const DEFAULT_SETTINGS = {
    enforcementEnabled: false,
    allowFirstDayVillageVote: false,
    allowNightKillVote: true,
    evilVoteHistoryLimit: null,
    maxAlignmentCountReveals: null
};

const BUILT_IN_ROLE_METADATA = {
    Villager: { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: false },
    Werewolf: { revealedAlignment: ALIGNMENT.EVIL, evilChatAccess: true },
    'Dream Wolf': { revealedAlignment: ALIGNMENT.EVIL, evilChatAccess: true },
    Changeling: { revealedAlignment: ALIGNMENT.EVIL, evilChatAccess: true },
    Sorceress: { revealedAlignment: ALIGNMENT.EVIL, evilChatAccess: true },
    Godfather: { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: true },
    'Blind Minion': { revealedAlignment: ALIGNMENT.EVIL, evilChatAccess: false },
    Seer: { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: false },
    'Super Seer': { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: false },
    Doctor: { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: false },
    Witch: { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: false },
    Ironman: { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: false },
    'Parity Hunter': { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: false },
    'Brutal Hunter': { revealedAlignment: ALIGNMENT.GOOD, evilChatAccess: false }
};

function normalizeSettings (settings = null) {
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function normalizeDeckEntry (entry) {
    const metadata = BUILT_IN_ROLE_METADATA[entry.role] || {};
    return {
        ...entry,
        revealedAlignment: entry.revealedAlignment || metadata.revealedAlignment || entry.team,
        evilChatAccess: typeof entry.evilChatAccess === 'boolean'
            ? entry.evilChatAccess
            : Boolean(metadata.evilChatAccess)
    };
}

function createEnforcementState (game) {
    if (!game.settings?.enforcementEnabled) {
        return null;
    }

    return {
        enabled: true,
        phase: PHASES.DAY,
        dayNumber: 1,
        nightNumber: 0,
        publicHistory: [],
        evilHistory: [],
        evilChat: [],
        openVote: null,
        pendingNightActions: {
            inspect: {},
            senseSeer: {},
            protect: {},
            witch: {},
            pendingKillTargetId: null,
            resolvedNightVote: null
        },
        privateNotices: {},
        countRevealUses: 0,
        activeHunterPrompt: null,
        winner: null
    };
}

function initializePersonRoleState (person) {
    person.revealedAlignment = person.revealedAlignment || person.alignment;
    person.roleState = {
        ironmanUsed: false,
        witchHealUsed: false,
        witchPoisonUsed: false,
        inspectedTargets: [],
        asleep: person.gameRole === 'Dream Wolf' || person.gameRole === 'Changeling',
        transformed: false,
        initialRole: person.gameRole,
        brutalPending: false
    };
}

function isParticipant (person) {
    return person.userType === USER_TYPES.PLAYER
        || person.userType === USER_TYPES.TEMPORARY_MODERATOR
        || person.userType === USER_TYPES.BOT
        || person.userType === USER_TYPES.KILLED_PLAYER
        || person.userType === USER_TYPES.KILLED_BOT;
}

function isAliveParticipant (person) {
    return isParticipant(person) && !person.out;
}

function canUseEvilChat (person) {
    return Boolean(person && person.evilChatAccess && !person.roleState?.asleep);
}

function canVoteAtNight (person) {
    return Boolean(
        person
        && person.alignment === ALIGNMENT.EVIL
        && isParticipant(person)
        && !person.roleState?.asleep
    );
}

function canAccessBlindMinionEvilInfo (person) {
    return Boolean(person && person.gameRole === 'Blind Minion');
}

function getLivingPlayers (game) {
    return game.people.filter((person) => isAliveParticipant(person) && person.userType !== USER_TYPES.BOT);
}

function getLivingParticipants (game) {
    return game.people.filter((person) => isAliveParticipant(person));
}

function addPublicHistoryEntry (game, entry) {
    if (!game.enforcement) return;
    game.enforcement.publicHistory.push({
        id: createEntryId(),
        timestamp: new Date().toJSON(),
        ...entry
    });
}

function addEvilHistoryEntry (game, entry) {
    if (!game.enforcement) return;
    game.enforcement.evilHistory.push({
        id: createEntryId(),
        timestamp: new Date().toJSON(),
        ...entry
    });
}

function addEvilChatEntry (game, sender, message) {
    if (!game.enforcement) return;
    game.enforcement.evilChat.push({
        id: createEntryId(),
        timestamp: new Date().toJSON(),
        senderId: sender.id,
        senderName: sender.name,
        message
    });
}

function addPrivateNotice (game, personId, message) {
    if (!game.enforcement) return;
    if (!game.enforcement.privateNotices[personId]) {
        game.enforcement.privateNotices[personId] = [];
    }
    game.enforcement.privateNotices[personId].push({
        id: createEntryId(),
        timestamp: new Date().toJSON(),
        message
    });
}

function clearNightActions (game) {
    if (!game.enforcement) return;
    game.enforcement.pendingNightActions = {
        inspect: {},
        senseSeer: {},
        protect: {},
        witch: {},
        pendingKillTargetId: null,
        resolvedNightVote: null
    };
    game.enforcement.activeHunterPrompt = null;
}

function getOpenVote (game, expectedType = null) {
    const openVote = game.enforcement?.openVote;
    if (!openVote) return null;
    if (expectedType && openVote.type !== expectedType) return null;
    return openVote;
}

function livingVillageVoters (game) {
    return game.people.filter((person) => isAliveParticipant(person));
}

function livingNightVoters (game) {
    return game.people.filter((person) => canVoteAtNight(person) && !person.out);
}

function deadNightVoters (game) {
    return game.people.filter((person) => canVoteAtNight(person) && person.out && person.killed);
}

function getVoteSelections (vote, voterId) {
    return vote.ballots[voterId]?.selections || [];
}

function submitVote (vote, voterId, selections, passed) {
    vote.ballots[voterId] = {
        selections: passed ? [] : selections,
        passed: Boolean(passed),
        submittedAt: new Date().toJSON()
    };
}

function tallyVote (game, vote) {
    const totals = {};
    for (const candidateId of vote.candidateIds) {
        totals[candidateId] = 0;
    }

    for (const ballot of Object.values(vote.ballots)) {
        if (ballot.passed) {
            continue;
        }
        for (const selection of ballot.selections) {
            if (Object.prototype.hasOwnProperty.call(totals, selection)) {
                totals[selection] += 1;
            }
        }
    }

    let topScore = -1;
    let leaders = [];
    for (const [candidateId, score] of Object.entries(totals)) {
        if (score > topScore) {
            topScore = score;
            leaders = [candidateId];
        } else if (score === topScore) {
            leaders.push(candidateId);
        }
    }

    if (vote.type === VOTE_TYPES.NIGHT && leaders.length > 1) {
        const godfather = game.people.find((person) => person.gameRole === 'Godfather');
        if (godfather) {
            const godfatherBallot = vote.ballots[godfather.id];
            const godfatherLeaders = leaders.filter((leaderId) => godfatherBallot?.selections?.includes(leaderId));
            if (godfatherLeaders.length === 1) {
                return { totals, leaders, winnerId: godfatherLeaders[0], tieBrokenBy: 'godfather' };
            }
        }
        return {
            totals,
            leaders,
            winnerId: leaders[Math.floor(Math.random() * leaders.length)] || null,
            tieBrokenBy: 'random'
        };
    }

    return {
        totals,
        leaders,
        winnerId: leaders.length === 1 ? leaders[0] : null,
        tieBrokenBy: null
    };
}

function shouldAllowFirstDayVote (game) {
    return game.settings?.allowFirstDayVillageVote || game.enforcement?.dayNumber > 1;
}

function shouldAllowNightKillVote (game) {
    return game.settings?.allowNightKillVote !== false;
}

function roleIsSeerFamily (roleName) {
    return roleName === 'Seer' || roleName === 'Super Seer';
}

function isCustomRoleInGame (game) {
    return game.people.some((person) => person.customRole === true);
}

function hasLivingIndependent (game) {
    return game.people.some((person) => isAliveParticipant(person) && person.alignment === ALIGNMENT.INDEPENDENT);
}

function getLivingAlignmentCounts (game) {
    return {
        [ALIGNMENT.GOOD]: game.people.filter((person) => isAliveParticipant(person) && person.alignment === ALIGNMENT.GOOD).length,
        [ALIGNMENT.EVIL]: game.people.filter((person) => isAliveParticipant(person) && person.alignment === ALIGNMENT.EVIL).length,
        [ALIGNMENT.INDEPENDENT]: game.people.filter((person) => isAliveParticipant(person) && person.alignment === ALIGNMENT.INDEPENDENT).length
    };
}

function isWerewolfRole (person) {
    return Boolean(person && (person.gameRole === 'Werewolf' || (person.gameRole === 'Dream Wolf' && !person.roleState?.asleep)));
}

function maybeWakeSleepingEvil (game) {
    const aWerewolfDied = game.people.some((person) => person.killed && (person.roleState?.initialRole === 'Werewolf' || person.gameRole === 'Werewolf'));
    if (!aWerewolfDied) {
        return;
    }

    const werewolfCard = game.deck.find((card) => card.role === 'Werewolf');
    for (const person of game.people) {
        if (person.gameRole === 'Dream Wolf' && person.roleState?.asleep) {
            person.roleState.asleep = false;
            addPrivateNotice(game, person.id, 'A Werewolf has died. You now wake with the evil team at night.');
            addEvilHistoryEntry(game, { type: 'evil-event', text: person.name + ' has woken up as a Dream Wolf.' });
        }
        if (person.gameRole === 'Changeling' && person.roleState?.asleep) {
            person.roleState.asleep = false;
            person.roleState.transformed = true;
            person.gameRole = 'Werewolf';
            person.gameRoleDescription = werewolfCard?.description || 'During the night, choose a player to eliminate.';
            person.revealedAlignment = werewolfCard?.revealedAlignment || ALIGNMENT.EVIL;
            person.evilChatAccess = true;
            addPrivateNotice(game, person.id, 'A Werewolf has died. You have transformed into a Werewolf.');
            addEvilHistoryEntry(game, { type: 'evil-event', text: person.name + ' has awakened as a Werewolf.' });
        }
    }
}

function spendIronmanShieldIfNeeded (game, person, causeText) {
    if (!person || person.roleState?.ironmanUsed || person.gameRole !== 'Ironman') {
        return false;
    }

    person.roleState.ironmanUsed = true;
    addPublicHistoryEntry(game, {
        type: 'ironman-save',
        text: person.name + ' survived a killing attempt.',
        cause: causeText
    });
    return true;
}

function setPersonKilledState (person) {
    person.userType = person.userType === USER_TYPES.BOT
        ? USER_TYPES.KILLED_BOT
        : USER_TYPES.KILLED_PLAYER;
    person.out = true;
    person.killed = true;
}

function revivePersonState (person) {
    person.userType = person.userType === USER_TYPES.KILLED_BOT
        ? USER_TYPES.BOT
        : (person.userType === USER_TYPES.MODERATOR ? USER_TYPES.MODERATOR : USER_TYPES.PLAYER);
    person.out = person.userType === USER_TYPES.MODERATOR;
    person.killed = false;
}

function eliminatePlayer (game, person, cause, bypassShield = false) {
    if (!person || person.out) {
        return { eliminated: false, prevented: false };
    }

    if (!bypassShield && spendIronmanShieldIfNeeded(game, person, cause)) {
        return { eliminated: false, prevented: true };
    }

    setPersonKilledState(person);
    addPublicHistoryEntry(game, { type: 'death', text: person.name + ' died.', cause });
    maybeWakeSleepingEvil(game);
    return { eliminated: true, prevented: false };
}

function resolveHunterPromptIfNeeded (game, person) {
    if (!person || person.gameRole !== 'Brutal Hunter') {
        return;
    }

    game.enforcement.activeHunterPrompt = {
        hunterId: person.id,
        createdAt: new Date().toJSON(),
        eligibleTargetIds: getLivingParticipants(game).filter((candidate) => candidate.id !== person.id).map((candidate) => candidate.id)
    };
    person.roleState.brutalPending = true;
    addPrivateNotice(game, person.id, 'You are Brutal Hunter. Choose one living player to die with you.');
}

function maybeAutoEndGame (game) {
    if (!game.enforcement?.enabled || isCustomRoleInGame(game) || hasLivingIndependent(game) || game.status !== STATUS.IN_PROGRESS) {
        return null;
    }

    const living = getLivingParticipants(game);
    const livingGood = living.filter((person) => person.alignment === ALIGNMENT.GOOD);
    const livingEvil = living.filter((person) => person.alignment === ALIGNMENT.EVIL);

    if (livingEvil.length === 0) {
        game.enforcement.winner = ALIGNMENT.GOOD;
        game.status = STATUS.ENDED;
        for (const person of game.people) {
            person.revealed = true;
        }
        addPublicHistoryEntry(game, { type: 'win', text: 'Good wins.' });
        return ALIGNMENT.GOOD;
    }

    if (living.length === 2
        && living.some((person) => person.gameRole === 'Parity Hunter')
        && living.some((person) => isWerewolfRole(person) || person.gameRole === 'Werewolf')) {
        game.enforcement.winner = ALIGNMENT.GOOD;
        game.status = STATUS.ENDED;
        for (const person of game.people) {
            person.revealed = true;
        }
        addPublicHistoryEntry(game, { type: 'win', text: 'Good wins by Parity Hunter.' });
        return ALIGNMENT.GOOD;
    }

    if ((livingGood.length === 0 && livingEvil.length > 0) || (livingEvil.length >= livingGood.length && livingGood.length > 0)) {
        game.enforcement.winner = ALIGNMENT.EVIL;
        game.status = STATUS.ENDED;
        for (const person of game.people) {
            person.revealed = true;
        }
        addPublicHistoryEntry(game, { type: 'win', text: 'Evil wins.' });
        return ALIGNMENT.EVIL;
    }

    return null;
}

function createEntryId () {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

module.exports = {
    ACTION_TYPES,
    BUILT_IN_ROLE_METADATA,
    DEFAULT_SETTINGS,
    PHASES,
    VOTE_TYPES,
    addEvilChatEntry,
    addEvilHistoryEntry,
    addPrivateNotice,
    addPublicHistoryEntry,
    canAccessBlindMinionEvilInfo,
    canUseEvilChat,
    canVoteAtNight,
    clearNightActions,
    createEnforcementState,
    eliminatePlayer,
    getLivingAlignmentCounts,
    getLivingParticipants,
    getLivingPlayers,
    getOpenVote,
    getVoteSelections,
    initializePersonRoleState,
    isAliveParticipant,
    livingNightVoters,
    livingVillageVoters,
    deadNightVoters,
    maybeAutoEndGame,
    maybeWakeSleepingEvil,
    normalizeDeckEntry,
    normalizeSettings,
    resolveHunterPromptIfNeeded,
    revivePersonState,
    roleIsSeerFamily,
    shouldAllowFirstDayVote,
    shouldAllowNightKillVote,
    submitVote,
    tallyVote
};
