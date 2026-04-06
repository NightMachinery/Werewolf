const GameStateCurator = require('./GameStateCurator');
const GameCreationRequest = require('../model/GameCreationRequest');
const {
    EVENT_IDS,
    STATUS,
    USER_TYPES,
    GAME_PROCESS_COMMANDS,
    REDIS_CHANNELS,
    PRIMITIVES,
    ALIGNMENT
} = require('../config/globals');
const {
    ACTION_TYPES,
    PHASES,
    VOTE_TYPES,
    addEvilChatEntry,
    addEvilHistoryEntry,
    addPrivateNotice,
    addPublicHistoryEntry,
    canUseEvilChat,
    canVoteAtNight,
    clearNightActions,
    deadNightVoters,
    eliminatePlayer,
    getLivingAlignmentCounts,
    getLivingParticipants,
    getLivingPlayers,
    getOpenVote,
    livingNightVoters,
    livingVillageVoters,
    maybeAutoEndGame,
    maybeWakeSleepingEvil,
    normalizeDeckEntry,
    shouldAllowFirstDayVote,
    shouldAllowNightKillVote,
    submitVote,
    tallyVote,
    resolveHunterPromptIfNeeded,
    revivePersonState,
    roleIsSeerFamily,
    createEnforcementState
} = require('./Enforcement');

async function handleTimerCommand (timerEventSubtype, game, socketId, vars) {
    switch (timerEventSubtype) {
        case GAME_PROCESS_COMMANDS.PAUSE_TIMER:
            const pauseTimeRemaining = await vars.gameManager.pauseTimer(game);
            if (pauseTimeRemaining !== null) {
                await vars.eventManager.handleEventById(
                    EVENT_IDS.PAUSE_TIMER,
                    null,
                    game,
                    null,
                    game.accessCode,
                    { timeRemaining: pauseTimeRemaining },
                    null,
                    false
                );
                await vars.gameManager.refreshGame(game);
                await vars.eventManager.publisher.publish(
                    REDIS_CHANNELS.ACTIVE_GAME_STREAM,
                    vars.eventManager.createMessageToPublish(
                        game.accessCode,
                        EVENT_IDS.PAUSE_TIMER,
                        vars.instanceId,
                        JSON.stringify({ timeRemaining: pauseTimeRemaining })
                    )
                );
            }
            break;
        case GAME_PROCESS_COMMANDS.RESUME_TIMER:
            const resumeTimeRemaining = await vars.gameManager.resumeTimer(game);
            if (resumeTimeRemaining !== null) {
                await vars.eventManager.handleEventById(
                    EVENT_IDS.RESUME_TIMER,
                    null,
                    game,
                    null,
                    game.accessCode,
                    { timeRemaining: resumeTimeRemaining },
                    null,
                    false
                );
                await vars.gameManager.refreshGame(game);
                await vars.eventManager.publisher.publish(
                    REDIS_CHANNELS.ACTIVE_GAME_STREAM,
                    vars.eventManager.createMessageToPublish(
                        game.accessCode,
                        EVENT_IDS.RESUME_TIMER,
                        vars.instanceId,
                        JSON.stringify({ timeRemaining: resumeTimeRemaining })
                    )
                );
            }
            break;
        case GAME_PROCESS_COMMANDS.RESET_TIMER:
            const resetTimeRemaining = await vars.gameManager.resetTimer(game);
            if (resetTimeRemaining !== null) {
                await vars.eventManager.handleEventById(
                    EVENT_IDS.RESET_TIMER,
                    null,
                    game,
                    null,
                    game.accessCode,
                    { timeRemaining: resetTimeRemaining },
                    null,
                    false
                );
                await vars.gameManager.refreshGame(game);
                await vars.eventManager.publisher.publish(
                    REDIS_CHANNELS.ACTIVE_GAME_STREAM,
                    vars.eventManager.createMessageToPublish(
                        game.accessCode,
                        EVENT_IDS.RESET_TIMER,
                        vars.instanceId,
                        JSON.stringify({ timeRemaining: resetTimeRemaining })
                    )
                );
            }
            break;
        case GAME_PROCESS_COMMANDS.GET_TIME_REMAINING:
            if (game.timerParams && game.timerParams.ended) {
                const socket = vars.gameManager.namespace.sockets.get(socketId);
                if (socket) {
                    vars.gameManager.namespace.to(socket.id).emit(
                        GAME_PROCESS_COMMANDS.GET_TIME_REMAINING,
                        0,
                        false
                    );
                }
            } else {
                const timer = vars.gameManager.timers[game.accessCode];
                if (timer) {
                    const socket = vars.gameManager.namespace.sockets.get(socketId);
                    if (socket) {
                        vars.gameManager.namespace.to(socket.id).emit(
                            GAME_PROCESS_COMMANDS.GET_TIME_REMAINING,
                            timer.currentTimeInMillis,
                            game.timerParams ? game.timerParams.paused : false
                        );
                    }
                } else {
                    await vars.eventManager.publisher?.publish(
                        REDIS_CHANNELS.ACTIVE_GAME_STREAM,
                        vars.eventManager.createMessageToPublish(
                            game.accessCode,
                            EVENT_IDS.SOURCE_TIMER_EVENT,
                            vars.instanceId,
                            JSON.stringify({ socketId: socketId, timerEventSubtype: timerEventSubtype })
                        )
                    );
                }
            }
            break;
    }
}

function getRequestingPerson (game, vars) {
    if (!vars.requestingSocketId) {
        return null;
    }

    return game.people.find(person => person.socketId === vars.requestingSocketId) || null;
}

function isCurrentModerator (game, person) {
    return Boolean(
        person
        && person.id === game.currentModeratorId
        && (person.userType === USER_TYPES.MODERATOR || person.userType === USER_TYPES.TEMPORARY_MODERATOR)
    );
}

function isDedicatedModerator (game, person) {
    return Boolean(
        person
        && person.id === game.currentModeratorId
        && person.userType === USER_TYPES.MODERATOR
    );
}

function isOriginalModerator (game, person) {
    return Boolean(person && person.id === game.originalModeratorId);
}

function blockIfUnauthorized (vars) {
    vars.authorizationFailed = true;
    return false;
}

function requireActiveModerator (game, vars) {
    if (!vars.requestingSocketId) {
        return vars.gameManager.findPersonByField(game, 'id', game.currentModeratorId);
    }
    const requester = getRequestingPerson(game, vars);
    return isCurrentModerator(game, requester) ? requester : blockIfUnauthorized(vars);
}

function requireDedicatedModerator (game, vars) {
    if (!vars.requestingSocketId) {
        return vars.gameManager.findPersonByField(game, 'id', game.currentModeratorId);
    }
    const requester = getRequestingPerson(game, vars);
    return isDedicatedModerator(game, requester) ? requester : blockIfUnauthorized(vars);
}

function requireOriginalModerator (game, vars) {
    if (!vars.requestingSocketId) {
        return vars.gameManager.findPersonByField(game, 'id', game.originalModeratorId);
    }
    const requester = getRequestingPerson(game, vars);
    return isOriginalModerator(game, requester) ? requester : blockIfUnauthorized(vars);
}

function restoreModeratorToPriorRole (person) {
    if (!person) {
        return;
    }

    if (!person.gameRole) {
        if (!person.out) {
            person.userType = USER_TYPES.PLAYER;
            person.out = false;
            person.killed = false;
            return;
        }
        person.userType = USER_TYPES.SPECTATOR;
        person.out = true;
        person.killed = false;
        return;
    }

    if (person.out || person.killed) {
        person.userType = USER_TYPES.KILLED_PLAYER;
        person.out = true;
        person.killed = true;
        return;
    }

    person.userType = USER_TYPES.PLAYER;
    person.out = false;
    person.killed = false;
}

function assignModeratorRole (game, nextModerator) {
    game.previousModeratorId = game.currentModeratorId;
    game.currentModeratorId = nextModerator.id;
}

function syncRoomState (game, vars) {
    vars.gameManager.namespace.to(game.accessCode).emit(EVENT_IDS.SYNC_GAME_STATE);
}

function getPersonOrNull (game, personId) {
    return game.people.find((person) => person.id === personId) || null;
}

function getVoteCandidateNameMap (game, candidateIds) {
    return candidateIds.reduce((accumulator, candidateId) => {
        const person = getPersonOrNull(game, candidateId);
        accumulator[candidateId] = person?.name || candidateId;
        return accumulator;
    }, {});
}

function buildVoteHistoryEntry (game, vote, resolution) {
    const candidateNames = getVoteCandidateNameMap(game, vote.candidateIds);
    const ballots = Object.entries(vote.ballots).map(([voterId, ballot]) => ({
        voterId,
        voterName: getPersonOrNull(game, voterId)?.name || voterId,
        passed: Boolean(ballot.passed),
        selections: ballot.selections,
        selectionNames: ballot.selections.map((selectionId) => candidateNames[selectionId] || selectionId)
    }));
    const totals = Object.entries(resolution.totals).map(([candidateId, count]) => ({
        candidateId,
        candidateName: candidateNames[candidateId] || candidateId,
        count
    }));

    return {
        type: vote.type + '-vote',
        round: vote.round,
        text: vote.type === VOTE_TYPES.DAY
            ? 'Day vote round ' + vote.round + ' closed.'
            : 'Night vote round ' + vote.round + ' closed.',
        candidateNames,
        ballots,
        totals,
        leaders: resolution.leaders,
        winnerId: resolution.winnerId,
        winnerName: candidateNames[resolution.winnerId] || null,
        tieBrokenBy: resolution.tieBrokenBy,
        topScore: resolution.topScore,
        minimumVotesToEliminate: resolution.minimumVotesToEliminate,
        meetsEliminationThreshold: resolution.meetsEliminationThreshold
    };
}

function maybeCloseNightVote (game) {
    const vote = getOpenVote(game, VOTE_TYPES.NIGHT);
    if (!vote || vote.status !== 'open') {
        return { closed: false };
    }

    const livingVoters = livingNightVoters(game).map((person) => person.id);
    if (livingVoters.some((voterId) => !vote.ballots[voterId])) {
        return { closed: false };
    }

    const deadVoters = deadNightVoters(game).map((person) => person.id);
    if (deadVoters.length > 0 && !vote.deadVoteWindowEndsAt) {
        vote.deadVoteWindowStartedAt = new Date().toJSON();
        vote.deadVoteWindowEndsAt = new Date(Date.now() + 30000).toJSON();
        return { closed: false, startedDeadWindow: true };
    }

    if (
        deadVoters.length > 0
        && new Date(vote.deadVoteWindowEndsAt).getTime() > Date.now()
        && deadVoters.some((voterId) => !vote.ballots[voterId])
    ) {
        return { closed: false };
    }

    vote.status = 'closed';
    const resolution = tallyVote(game, vote);
    const allPassed = Object.values(vote.ballots).every((ballot) => ballot.passed);
    vote.resolution = resolution;
    game.enforcement.pendingNightActions.resolvedNightVote = resolution;
    game.enforcement.pendingNightActions.pendingKillTargetId = resolution.winnerId;
    const historyEntry = buildVoteHistoryEntry(game, vote, resolution);
    historyEntry.allPassed = allPassed;
    addEvilHistoryEntry(game, historyEntry);
    addEvilHistoryEntry(game, {
        type: 'evil-shared',
        text: allPassed && resolution.winnerId
            ? 'All evil players passed, so a random non-evil target was chosen: ' + (historyEntry.winnerName || 'unknown') + '.'
            : resolution.winnerId
            ? 'Night target chosen: ' + (historyEntry.winnerName || 'unknown') +
                (resolution.tieBrokenBy ? ' (tie broken by ' + resolution.tieBrokenBy + ')' : '')
            : 'Night vote ended in a tie without a single winner.',
        winnerId: resolution.winnerId,
        winnerName: historyEntry.winnerName,
        tieBrokenBy: resolution.tieBrokenBy,
        allPassed,
        shareWithBlindMinion: true
    });
    return { closed: true, resolution };
}

function resolveNightActions (game) {
    const pending = game.enforcement.pendingNightActions;
    const protectedIds = new Set(Object.values(pending.protect));
    const witchHealTargetId = Object.values(pending.witch).find((entry) => entry.type === ACTION_TYPES.HEAL)?.targetId || null;
    const witchPoisonEntry = Object.values(pending.witch).find((entry) => entry.type === ACTION_TYPES.POISON) || null;

    if (pending.pendingKillTargetId) {
        const target = getPersonOrNull(game, pending.pendingKillTargetId);
        const saved = protectedIds.has(target?.id) || witchHealTargetId === target?.id;
        if (target && !saved) {
            const result = eliminatePlayer(game, target, 'night kill');
            if (result.eliminated) {
                resolveHunterPromptIfNeeded(game, target);
            }
        } else if (target && saved) {
            addPublicHistoryEntry(game, { type: 'saved', text: target.name + ' survived the night.' });
        }
    }

    if (witchPoisonEntry) {
        const target = getPersonOrNull(game, witchPoisonEntry.targetId);
        const result = eliminatePlayer(game, target, 'witch poison');
        if (result.eliminated) {
            resolveHunterPromptIfNeeded(game, target);
        }
    }

    for (const [seerId, targetId] of Object.entries(pending.inspect)) {
        const seer = getPersonOrNull(game, seerId);
        const target = getPersonOrNull(game, targetId);
        if (!seer || !target) {
            continue;
        }
        const priorInspections = seer.roleState.inspectedTargets.filter((entry) => entry === target.id).length;
        seer.roleState.inspectedTargets.push(target.id);
        const seenAlignment = seer.gameRole === 'Super Seer' && priorInspections >= 1
            ? target.alignment
            : (target.revealedAlignment || target.alignment);
        addPrivateNotice(game, seer.id, target.name + ' appears to be ' + seenAlignment + '.');
    }

    for (const [actorId, targetId] of Object.entries(pending.senseSeer)) {
        const actor = getPersonOrNull(game, actorId);
        const target = getPersonOrNull(game, targetId);
        if (!actor || !target) {
            continue;
        }
        addPrivateNotice(
            game,
            actor.id,
            target.name + (roleIsSeerFamily(target.gameRole) ? ' is part of the seer family.' : ' is not part of the seer family.')
        );
    }

    maybeWakeSleepingEvil(game);
    maybeAutoEndGame(game);
}

function ensureNightVoteResolvedBeforeDay (game) {
    const vote = getOpenVote(game, VOTE_TYPES.NIGHT);
    if (!vote) {
        return true;
    }

    const closeResult = maybeCloseNightVote(game);
    return Boolean(closeResult.closed);
}

const Events = [
    {
        id: EVENT_IDS.PLAYER_JOINED,
        stateChange: async (game, socketArgs, vars) => {
            game.people.push(socketArgs);
            game.isStartable = vars.gameManager.isGameStartable(game);
        },
        communicate: async (game, socketArgs, vars) => {
            vars.gameManager.namespace.in(game.accessCode).emit(
                EVENT_IDS.PLAYER_JOINED,
                GameStateCurator.mapPerson(socketArgs),
                game.isStartable
            );
        }
    },
    {
        id: EVENT_IDS.KICK_PERSON,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            const toBeClearedIndex = game.people.findIndex(
                (person) => person.id === socketArgs.personId && person.assigned === true
            );
            if (toBeClearedIndex >= 0) {
                game.people.splice(toBeClearedIndex, 1);
                game.isStartable = vars.gameManager.isGameStartable(game);
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            vars.gameManager.namespace.in(game.accessCode).emit(
                EVENT_IDS.KICK_PERSON,
                socketArgs.personId,
                game.isStartable
            );
        }
    },
    {
        id: EVENT_IDS.LEAVE_ROOM,
        stateChange: async (game, socketArgs, vars) => {
            const toBeClearedIndex = game.people.findIndex(
                (person) => person.id === socketArgs.personId && person.assigned === true
            );
            if (toBeClearedIndex >= 0) {
                game.people.splice(toBeClearedIndex, 1);
                game.isStartable = vars.gameManager.isGameStartable(game);
            }
        },
        communicate: async (game, socketArgs, vars) => {
            vars.gameManager.namespace.in(game.accessCode).emit(
                EVENT_IDS.LEAVE_ROOM,
                socketArgs.personId,
                game.isStartable
            );
        }
    },
    {
        id: EVENT_IDS.CHANGE_NAME,
        stateChange: async (game, socketArgs, vars) => {
            const toChangeIndex = game.people.findIndex(
                (person) => person.id === socketArgs.personId
            );
            if (toChangeIndex >= 0) {
                if (vars.gameManager.isNameTaken(game, socketArgs.newName)) {
                    vars.hasNameChanged = false;
                    if (game.people[toChangeIndex].name.toLowerCase().trim() === socketArgs.newName.toLowerCase().trim()) {
                        return;
                    }
                    vars.ackFn({ errorFlag: 1, message: 'This name is taken.' });
                } else if (socketArgs.newName.length > PRIMITIVES.MAX_PERSON_NAME_LENGTH) {
                    vars.ackFn({ errorFlag: 1, message: 'Your new name is too long - the max is ' + PRIMITIVES.MAX_PERSON_NAME_LENGTH + ' characters.' });
                    vars.hasNameChanged = false;
                } else if (socketArgs.newName.length === 0) {
                    vars.ackFn({ errorFlag: 1, message: 'Your new name cannot be empty.' });
                    vars.hasNameChanged = false;
                } else {
                    game.people[toChangeIndex].name = socketArgs.newName;
                    vars.ackFn({ errorFlag: 0, message: 'Name updated!' });
                    vars.hasNameChanged = true;
                }
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.hasNameChanged) {
                vars.gameManager.namespace.in(game.accessCode).emit(
                    EVENT_IDS.CHANGE_NAME,
                    socketArgs.personId,
                    socketArgs.newName
                );
            }
        }
    },
    {
        id: EVENT_IDS.UPDATE_GAME_ROLES,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            if (GameCreationRequest.deckIsValid(socketArgs.deck)) {
                game.deck = socketArgs.deck.map(normalizeDeckEntry);
                game.gameSize = socketArgs.deck.reduce(
                    (accumulator, currentValue) => accumulator + currentValue.quantity,
                    0
                );
                game.isStartable = vars.gameManager.isGameStartable(game);
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            if (vars.ackFn) {
                vars.ackFn();
            }
            vars.gameManager.namespace.in(game.accessCode).emit(
                EVENT_IDS.UPDATE_GAME_ROLES,
                game.deck,
                game.gameSize,
                game.isStartable
            );
        }
    },
    {
        id: EVENT_IDS.ADD_SPECTATOR,
        stateChange: async (game, socketArgs, vars) => {
            game.people.push(socketArgs);
        },
        communicate: async (game, socketArgs, vars) => {
            vars.gameManager.namespace.in(game.accessCode).emit(
                EVENT_IDS.ADD_SPECTATOR,
                GameStateCurator.mapPerson(socketArgs)
            );
        }
    },
    {
        id: EVENT_IDS.FETCH_GAME_STATE,
        stateChange: async (game, socketArgs, vars) => {
            const matchingPerson = vars.gameManager.findPersonByField(game, 'cookie', socketArgs.personId);
            if (matchingPerson && matchingPerson.socketId !== vars.requestingSocketId) {
                matchingPerson.socketId = vars.requestingSocketId;
                vars.gameManager.namespace.sockets.get(vars.requestingSocketId)?.join(game.accessCode);
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (!vars.ackFn) return;
            const matchingPerson = vars.gameManager.findPersonByField(game, 'cookie', socketArgs.personId);
            if (matchingPerson && vars.gameManager.namespace.sockets.get(matchingPerson.socketId)) {
                vars.ackFn(GameStateCurator.getGameStateFromPerspectiveOfPerson(game, matchingPerson));
            } else {
                vars.ackFn(null);
            }
        }
    },
    {
        id: EVENT_IDS.SYNC_GAME_STATE,
        stateChange: async (game, socketArgs, vars) => {},
        communicate: async (game, socketArgs, vars) => {
            const matchingPerson = vars.gameManager.findPersonByField(game, 'id', socketArgs.personId);
            if (matchingPerson && vars.gameManager.namespace.sockets.get(matchingPerson.socketId)) {
                vars.gameManager.namespace.to(matchingPerson.socketId).emit(EVENT_IDS.SYNC_GAME_STATE);
            }
        }
    },
    {
        id: EVENT_IDS.START_GAME,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            if (game.isStartable) {
                game.status = STATUS.IN_PROGRESS;
                vars.gameManager.deal(game);
                game.enforcement = createEnforcementState(game);
                if (game.enforcement?.enabled) {
                    addPublicHistoryEntry(game, { type: 'phase', text: 'Enforcement mode is active. Day 1 has begun.' });
                    clearNightActions(game);
                }
                if (game.hasTimer) {
                    game.timerParams.paused = true;
                    await vars.gameManager.runTimer(game);
                }
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            if (vars.ackFn) {
                vars.ackFn();
            }
            vars.gameManager.namespace.in(game.accessCode).emit(EVENT_IDS.START_GAME);
        }
    },
    {
        id: EVENT_IDS.KILL_PLAYER,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            const person = game.people.find((person) => person.id === socketArgs.personId);
            if (person && !person.out) {
                const result = game.enforcement?.enabled
                    ? eliminatePlayer(game, person, 'moderator override kill')
                    : null;
                if (!game.enforcement?.enabled) {
                    person.userType = person.userType === USER_TYPES.BOT
                        ? USER_TYPES.KILLED_BOT
                        : USER_TYPES.KILLED_PLAYER;
                    person.out = true;
                    person.killed = true;
                } else if (result.eliminated) {
                    resolveHunterPromptIfNeeded(game, person);
                    maybeAutoEndGame(game);
                }
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            if (game.enforcement?.enabled) {
                syncRoomState(game, vars);
                return;
            }
            const person = game.people.find((person) => person.id === socketArgs.personId);
            if (person) {
                vars.gameManager.namespace.in(game.accessCode).emit(EVENT_IDS.KILL_PLAYER, person);
            }
        }
    },
    {
        id: EVENT_IDS.REVEAL_PLAYER,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            const person = game.people.find((person) => person.id === socketArgs.personId);
            if (person && !person.revealed) {
                person.revealed = true;
                if (game.enforcement?.enabled) {
                    addPublicHistoryEntry(game, {
                        type: 'reveal',
                        text: person.name + ' was revealed as ' + person.gameRole + '.'
                    });
                }
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            if (game.enforcement?.enabled) {
                syncRoomState(game, vars);
                return;
            }
            const person = game.people.find((person) => person.id === socketArgs.personId);
            if (person) {
                vars.gameManager.namespace.in(game.accessCode).emit(
                    EVENT_IDS.REVEAL_PLAYER,
                    {
                        id: person.id,
                        gameRole: person.gameRole,
                        alignment: person.revealedAlignment || person.alignment
                    }
                );
            }
        }
    },
    {
        id: EVENT_IDS.REVIVE_PLAYER,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            const person = game.people.find((entry) => entry.id === socketArgs.personId);
            if (!person || !person.out) {
                return;
            }
            revivePersonState(person);
            addPublicHistoryEntry(game, { type: 'revive', text: person.name + ' was revived by the moderator.' });
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.END_GAME,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            game.status = STATUS.ENDED;
            if (game.hasTimer && vars.gameManager.timers[game.accessCode]) {
                vars.logger.trace('STOPPING TIMER FOR ENDED GAME ' + game.accessCode);
                vars.gameManager.timers[game.accessCode].stopTimer();
                delete vars.gameManager.timers[game.accessCode];
            }
            for (const person of game.people) {
                person.revealed = true;
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            vars.gameManager.namespace.in(game.accessCode)
                .emit(EVENT_IDS.END_GAME, GameStateCurator.mapPeopleForModerator(game.people));
            if (vars.ackFn) {
                vars.ackFn();
            }
        }
    },
    {
        id: EVENT_IDS.TRANSFER_MODERATOR,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireDedicatedModerator(game, vars)) {
                return;
            }
            const currentModerator = vars.gameManager.findPersonByField(game, 'id', game.currentModeratorId);
            const toTransferTo = vars.gameManager.findPersonByField(game, 'id', socketArgs.personId);
            if (
                currentModerator
                && toTransferTo
                && (toTransferTo.userType === USER_TYPES.KILLED_PLAYER || toTransferTo.userType === USER_TYPES.SPECTATOR)
            ) {
                restoreModeratorToPriorRole(currentModerator);
                assignModeratorRole(game, toTransferTo);
                toTransferTo.userType = USER_TYPES.MODERATOR;
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            if (vars.ackFn) {
                vars.ackFn();
            }
            vars.gameManager.namespace.to(game.accessCode).emit(EVENT_IDS.SYNC_GAME_STATE);
        }
    },
    {
        id: EVENT_IDS.ASSIGN_DEDICATED_MOD,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            const currentModerator = vars.gameManager.findPersonByField(game, 'id', game.currentModeratorId);
            const toTransferTo = vars.gameManager.findPersonByField(game, 'id', socketArgs.personId);
            if (currentModerator && toTransferTo && !toTransferTo.out && toTransferTo.userType !== USER_TYPES.BOT) {
                if (currentModerator.id !== toTransferTo.id) {
                    restoreModeratorToPriorRole(currentModerator);
                }

                assignModeratorRole(game, toTransferTo);
                toTransferTo.userType = USER_TYPES.MODERATOR;
                toTransferTo.out = true;
                toTransferTo.killed = true;
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            const moderator = vars.gameManager.findPersonByField(game, 'id', game.currentModeratorId);
            const moderatorSocket = vars.gameManager.namespace.sockets.get(moderator?.socketId);
            if (moderator && moderatorSocket) {
                vars.gameManager.namespace.to(moderator.socketId).emit(EVENT_IDS.SYNC_GAME_STATE);
                moderatorSocket.to(game.accessCode).emit(EVENT_IDS.KILL_PLAYER, moderator);
            } else {
                vars.gameManager.namespace.in(game.accessCode).emit(EVENT_IDS.KILL_PLAYER, moderator);
            }
            const previousModerator = vars.gameManager.findPersonByField(game, 'id', game.previousModeratorId);
            if (previousModerator && previousModerator.id !== moderator.id && vars.gameManager.namespace.sockets.get(previousModerator.socketId)) {
                vars.gameManager.namespace.to(previousModerator.socketId).emit(EVENT_IDS.SYNC_GAME_STATE);
            }
        }
    },
    {
        id: EVENT_IDS.SET_MODERATOR_STATUS,
        stateChange: async (game, socketArgs, vars) => {
            const creator = requireOriginalModerator(game, vars);
            if (!creator) {
                return;
            }

            const currentModerator = vars.gameManager.findPersonByField(game, 'id', game.currentModeratorId);
            const target = vars.gameManager.findPersonByField(game, 'id', socketArgs.personId);

            if (!currentModerator || !target) {
                return;
            }

            switch (socketArgs.mode) {
                case 'temp':
                    if (target.out || target.userType === USER_TYPES.BOT || target.userType === USER_TYPES.KILLED_BOT) {
                        return;
                    }
                    restoreModeratorToPriorRole(currentModerator);
                    assignModeratorRole(game, target);
                    target.userType = USER_TYPES.TEMPORARY_MODERATOR;
                    target.out = false;
                    target.killed = false;
                    break;
                case 'dedicated':
                    if (
                        target.userType !== USER_TYPES.KILLED_PLAYER
                        && target.userType !== USER_TYPES.SPECTATOR
                    ) {
                        return;
                    }
                    restoreModeratorToPriorRole(currentModerator);
                    assignModeratorRole(game, target);
                    target.userType = USER_TYPES.MODERATOR;
                    target.out = true;
                    break;
                case 'demote':
                    if (target.id !== game.currentModeratorId || target.id === creator.id) {
                        return;
                    }
                    restoreModeratorToPriorRole(target);
                    assignModeratorRole(game, creator);
                    creator.userType = creator.out || creator.killed
                        ? USER_TYPES.MODERATOR
                        : USER_TYPES.TEMPORARY_MODERATOR;
                    if (creator.userType === USER_TYPES.MODERATOR) {
                        creator.out = true;
                    } else {
                        creator.out = false;
                        creator.killed = false;
                    }
                    break;
                default:
                    break;
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            vars.gameManager.namespace.to(game.accessCode).emit(EVENT_IDS.SYNC_GAME_STATE);
        }
    },
    {
        id: EVENT_IDS.ADVANCE_PHASE,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars) || !game.enforcement?.enabled) {
                return;
            }
            if (game.enforcement.activeHunterPrompt) {
                return;
            }

            if (game.enforcement.phase === PHASES.DAY) {
                if (game.enforcement.openVote) {
                    return;
                }
                game.enforcement.phase = PHASES.NIGHT;
                game.enforcement.nightNumber += 1;
                game.enforcement.openVote = null;
                clearNightActions(game);
                if (shouldAllowNightKillVote(game)) {
                    game.enforcement.nightVoteRound = (game.enforcement.nightVoteRound || 0) + 1;
                    game.enforcement.openVote = {
                        type: VOTE_TYPES.NIGHT,
                        round: game.enforcement.nightVoteRound,
                        status: 'open',
                        candidateIds: getLivingParticipants(game)
                            .filter((person) => person.alignment !== ALIGNMENT.EVIL)
                            .map((person) => person.id),
                        ballots: {},
                        openedAt: new Date().toJSON(),
                        deadVoteWindowStartedAt: null,
                        deadVoteWindowEndsAt: null
                    };
                }
                addPublicHistoryEntry(game, {
                    type: 'phase',
                    text: 'Night ' + game.enforcement.nightNumber + ' has begun.'
                });
                return;
            }

            if (!ensureNightVoteResolvedBeforeDay(game)) {
                return;
            }

            resolveNightActions(game);
            game.enforcement.phase = PHASES.DAY;
            game.enforcement.dayNumber += 1;
            game.enforcement.openVote = null;
            addPublicHistoryEntry(game, {
                type: 'phase',
                text: 'Day ' + game.enforcement.dayNumber + ' has begun.'
            });
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.START_DAY_VOTE,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars) || !game.enforcement?.enabled || game.enforcement.phase !== PHASES.DAY) {
                return;
            }
            if (!shouldAllowFirstDayVote(game) || game.enforcement.openVote) {
                return;
            }
            const candidateIds = (socketArgs?.candidateIds || getLivingParticipants(game).map((person) => person.id))
                .filter((candidateId, index, array) => array.indexOf(candidateId) === index)
                .filter((candidateId) => {
                    const person = getPersonOrNull(game, candidateId);
                    return person && !person.out;
                });
            if (candidateIds.length === 0) {
                return;
            }
            game.enforcement.dayVoteRound = (game.enforcement.dayVoteRound || 0) + 1;
            game.enforcement.openVote = {
                type: VOTE_TYPES.DAY,
                round: game.enforcement.dayVoteRound,
                status: 'open',
                candidateIds,
                ballots: {},
                openedAt: new Date().toJSON()
            };
            addPublicHistoryEntry(game, {
                type: 'vote-open',
                text: 'Day vote round ' + game.enforcement.dayVoteRound + ' has started.'
            });
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.SUBMIT_VOTE,
        stateChange: async (game, socketArgs, vars) => {
            const requester = getRequestingPerson(game, vars);
            const vote = game.enforcement?.openVote;
            if (!requester || !vote || vote.status !== 'open') {
                return;
            }

            const selections = Array.isArray(socketArgs?.selections)
                ? socketArgs.selections.filter((selection, index, array) => array.indexOf(selection) === index)
                : [];
            const passed = Boolean(socketArgs?.passed);
            if (selections.some((selectionId) => !vote.candidateIds.includes(selectionId))) {
                return;
            }

            if (vote.type === VOTE_TYPES.DAY) {
                const eligible = livingVillageVoters(game).map((person) => person.id);
                if (!eligible.includes(requester.id)) {
                    return;
                }
                submitVote(vote, requester.id, selections, passed);
                return;
            }

            if (!canVoteAtNight(requester)) {
                return;
            }

            const deadWindowStarted = Boolean(vote.deadVoteWindowEndsAt);
            if (requester.out && (!deadWindowStarted || new Date(vote.deadVoteWindowEndsAt).getTime() < Date.now())) {
                return;
            }
            if (requester.out && !deadNightVoters(game).find((person) => person.id === requester.id)) {
                return;
            }
            submitVote(vote, requester.id, selections, passed);
            maybeCloseNightVote(game);
        },
        communicate: async (game, socketArgs, vars) => {
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.CLOSE_DAY_VOTE,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars) || !game.enforcement?.enabled) {
                return;
            }
            const vote = getOpenVote(game, VOTE_TYPES.DAY);
            if (!vote || vote.status !== 'open') {
                return;
            }
            vote.status = 'closed';
            vote.resolution = tallyVote(game, vote);
            addPublicHistoryEntry(game, buildVoteHistoryEntry(game, vote, vote.resolution));
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.RESOLVE_DAY_VOTE,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars) || !game.enforcement?.enabled) {
                return;
            }
            const vote = getOpenVote(game, VOTE_TYPES.DAY);
            if (!vote || vote.status !== 'closed' || !vote.resolution) {
                return;
            }

            const { leaders, meetsEliminationThreshold } = vote.resolution;
            let targetId = null;
            if (socketArgs?.mode === 'kill' && leaders.length === 1 && meetsEliminationThreshold) {
                targetId = leaders[0];
            } else if (socketArgs?.mode === 'killOverride' && leaders.length === 1 && !meetsEliminationThreshold) {
                targetId = leaders[0];
            } else if (socketArgs?.mode === 'randomTied' && leaders.length > 1 && meetsEliminationThreshold) {
                targetId = leaders[Math.floor(Math.random() * leaders.length)] || null;
            } else if (socketArgs?.mode === 'pass') {
                addPublicHistoryEntry(game, { type: 'vote-pass', text: 'The moderator passed on the current day vote result.' });
                game.enforcement.openVote = null;
                return;
            } else {
                return;
            }

            const target = getPersonOrNull(game, targetId);
            const result = eliminatePlayer(game, target, 'day vote');
            if (result.eliminated) {
                resolveHunterPromptIfNeeded(game, target);
            }
            addPublicHistoryEntry(game, {
                type: 'vote-resolution',
                text: target
                    ? target.name + (meetsEliminationThreshold
                        ? ' was eliminated by the day vote.'
                        : ' was eliminated by moderator choice after falling short of the day-vote threshold.')
                    : 'The day vote resolved.'
            });
            game.enforcement.openVote = null;
            maybeAutoEndGame(game);
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.SUBMIT_NIGHT_ACTION,
        stateChange: async (game, socketArgs, vars) => {
            const requester = getRequestingPerson(game, vars);
            if (!requester || !game.enforcement?.enabled || game.enforcement.phase !== PHASES.NIGHT) {
                return;
            }
            const target = socketArgs?.targetId ? getPersonOrNull(game, socketArgs.targetId) : null;
            const pending = game.enforcement.pendingNightActions;

            switch (socketArgs?.actionType) {
                case ACTION_TYPES.INSPECT:
                    if ((requester.gameRole === 'Seer' || requester.gameRole === 'Super Seer') && target && !target.out) {
                        pending.inspect[requester.id] = target.id;
                    }
                    break;
                case ACTION_TYPES.SENSE_SEER:
                    if (requester.gameRole === 'Sorceress' && target && !target.out) {
                        pending.senseSeer[requester.id] = target.id;
                    }
                    break;
                case ACTION_TYPES.PROTECT:
                    if (requester.gameRole === 'Doctor' && target && !target.out) {
                        pending.protect[requester.id] = target.id;
                    }
                    break;
                case ACTION_TYPES.HEAL:
                    if (requester.gameRole === 'Witch' && !requester.roleState.witchHealUsed && target && !target.out) {
                        const existingAction = pending.witch[requester.id];
                        if (!existingAction || existingAction.type !== ACTION_TYPES.POISON) {
                            pending.witch[requester.id] = { type: ACTION_TYPES.HEAL, targetId: target.id };
                            requester.roleState.witchHealUsed = true;
                        }
                    }
                    break;
                case ACTION_TYPES.POISON:
                    if (requester.gameRole === 'Witch' && !requester.roleState.witchPoisonUsed && target && !target.out) {
                        const existingAction = pending.witch[requester.id];
                        if (!existingAction || existingAction.type !== ACTION_TYPES.HEAL) {
                            pending.witch[requester.id] = { type: ACTION_TYPES.POISON, targetId: target.id };
                            requester.roleState.witchPoisonUsed = true;
                        }
                    }
                    break;
                case ACTION_TYPES.BRUTAL_TARGET:
                    if (
                        game.enforcement.activeHunterPrompt
                        && (
                            game.enforcement.activeHunterPrompt.hunterId === requester.id
                            || isCurrentModerator(game, requester)
                        )
                    ) {
                        const hunter = getPersonOrNull(game, game.enforcement.activeHunterPrompt.hunterId);
                        if (hunter) {
                            hunter.roleState.brutalPending = false;
                        }
                        game.enforcement.activeHunterPrompt = null;
                        if (socketArgs?.passed) {
                            addPublicHistoryEntry(game, {
                                type: 'brutal-pass',
                                text: (hunter?.name || 'The Brutal Hunter') + ' did not take a revenge kill.'
                            });
                            maybeAutoEndGame(game);
                            break;
                        }
                        if (target && !target.out) {
                            const result = eliminatePlayer(game, target, 'brutal hunter retaliation', true);
                            if (result.eliminated) {
                                resolveHunterPromptIfNeeded(game, target);
                            }
                            maybeAutoEndGame(game);
                        }
                    }
                    break;
                default:
                    break;
            }
        },
        communicate: async (game, socketArgs, vars) => {
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.SEND_EVIL_CHAT,
        stateChange: async (game, socketArgs, vars) => {
            const requester = getRequestingPerson(game, vars);
            if (
                !requester
                || !game.enforcement?.enabled
                || game.enforcement.phase !== PHASES.NIGHT
                || !canUseEvilChat(requester)
                || typeof socketArgs?.message !== 'string'
                || socketArgs.message.trim().length === 0
            ) {
                return;
            }
            addEvilChatEntry(game, requester, socketArgs.message.trim().slice(0, 300));
        },
        communicate: async (game, socketArgs, vars) => {
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.REVEAL_ALIGNMENT_COUNTS,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars) || !game.enforcement?.enabled) {
                return;
            }
            const maxUses = game.settings?.maxAlignmentCountReveals;
            if (maxUses !== null && game.enforcement.countRevealUses >= maxUses) {
                return;
            }
            game.enforcement.countRevealUses += 1;
            const counts = getLivingAlignmentCounts(game);
            addPublicHistoryEntry(game, {
                type: 'alignment-counts',
                text: 'Alignment counts were revealed.',
                counts,
                uses: game.enforcement.countRevealUses,
                maxUses
            });
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            syncRoomState(game, vars);
        }
    },
    {
        id: EVENT_IDS.RESTART_GAME,
        stateChange: async (game, socketArgs, vars) => {
            if (vars.instanceId !== vars.senderInstanceId
                && vars.gameManager.timers[game.accessCode]
            ) {
                vars.gameManager.timers[game.accessCode].stopTimer();
                delete vars.gameManager.timers[game.accessCode];
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.ackFn) {
                vars.ackFn();
            }
            vars.gameManager.namespace.in(game.accessCode).emit(EVENT_IDS.RESTART_GAME);
        }
    },
    {
        id: EVENT_IDS.TIMER_EVENT,
        stateChange: async (game, socketArgs, vars) => {},
        communicate: async (game, socketArgs, vars) => {
            if (vars.timerEventSubtype !== GAME_PROCESS_COMMANDS.GET_TIME_REMAINING
                && !requireActiveModerator(game, vars)
            ) {
                return;
            }
            await handleTimerCommand(vars.timerEventSubtype, game, vars.requestingSocketId, vars);
        }
    },
    {
        id: EVENT_IDS.SOURCE_TIMER_EVENT,
        stateChange: async (game, socketArgs, vars) => {},
        communicate: async (game, socketArgs, vars) => {
            if (socketArgs.timerEventSubtype === GAME_PROCESS_COMMANDS.GET_TIME_REMAINING) {
                const timer = vars.gameManager.timers[game.accessCode];
                if (timer) {
                    await vars.eventManager.publisher.publish(
                        REDIS_CHANNELS.ACTIVE_GAME_STREAM,
                        vars.eventManager.createMessageToPublish(
                            game.accessCode,
                            GAME_PROCESS_COMMANDS.GET_TIME_REMAINING,
                            vars.instanceId,
                            JSON.stringify({
                                socketId: socketArgs.socketId,
                                timeRemaining: timer.currentTimeInMillis,
                                paused: game.timerParams ? game.timerParams.paused : false
                            })
                        )
                    );
                }
            } else {
                const timer = vars.gameManager.timers[game.accessCode];
                if (timer) {
                    await handleTimerCommand(socketArgs.timerEventSubtype, game, socketArgs.socketId, vars);
                }
            }
        }
    },
    {
        id: EVENT_IDS.UPDATE_GAME_TIMER,
        stateChange: async (game, socketArgs, vars) => {
            if (!requireActiveModerator(game, vars)) {
                return;
            }
            if (GameCreationRequest.timerParamsAreValid(socketArgs.hasTimer, socketArgs.timerParams)) {
                game.hasTimer = socketArgs.hasTimer;
                game.timerParams = socketArgs.timerParams;
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            if (vars.ackFn) {
                vars.ackFn();
            }
            vars.gameManager.namespace.in(game.accessCode).emit(
                EVENT_IDS.UPDATE_GAME_TIMER,
                game.hasTimer,
                game.timerParams
            );
        }
    },
    {
        id: EVENT_IDS.END_TIMER,
        stateChange: async (game, socketArgs, vars) => {
            game.timerParams.paused = false;
            game.timerParams.timeRemaining = 0;
            game.timerParams.ended = true;
        },
        communicate: async (game, socketArgs, vars) => {
            vars.gameManager.namespace.in(game.accessCode).emit(GAME_PROCESS_COMMANDS.END_TIMER);
        }
    },
    {
        id: EVENT_IDS.PAUSE_TIMER,
        stateChange: async (game, socketArgs, vars) => {
            game.timerParams.paused = true;
            game.timerParams.timeRemaining = socketArgs.timeRemaining;
        },
        communicate: async (game, socketArgs, vars) => {
            vars.gameManager.namespace.in(game.accessCode).emit(GAME_PROCESS_COMMANDS.PAUSE_TIMER, socketArgs.timeRemaining);
        }
    },
    {
        id: EVENT_IDS.RESUME_TIMER,
        stateChange: async (game, socketArgs, vars) => {
            game.timerParams.paused = false;
            game.timerParams.timeRemaining = socketArgs.timeRemaining;
        },
        communicate: async (game, socketArgs, vars) => {
            vars.gameManager.namespace.in(game.accessCode).emit(GAME_PROCESS_COMMANDS.RESUME_TIMER, socketArgs.timeRemaining);
        }
    },
    {
        id: EVENT_IDS.RESET_TIMER,
        stateChange: async (game, socketArgs, vars) => {
            game.timerParams.paused = false;
            game.timerParams.ended = false;
            game.timerParams.timeRemaining = socketArgs.timeRemaining;
        },
        communicate: async (game, socketArgs, vars) => {
            vars.gameManager.namespace.in(game.accessCode).emit(GAME_PROCESS_COMMANDS.RESET_TIMER, socketArgs.timeRemaining);
        }
    },
    {
        id: EVENT_IDS.GET_TIME_REMAINING,
        stateChange: async (game, socketArgs, vars) => {},
        communicate: async (game, socketArgs, vars) => {
            const socket = vars.gameManager.namespace.sockets.get(socketArgs.socketId);
            if (socket) {
                vars.gameManager.namespace.to(socket.id).emit(GAME_PROCESS_COMMANDS.GET_TIME_REMAINING, socketArgs.timeRemaining, game.timerParams.paused);
            }
        }
    }
];

module.exports = Events;
