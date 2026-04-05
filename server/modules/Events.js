const GameStateCurator = require('./GameStateCurator');
const GameCreationRequest = require('../model/GameCreationRequest');
const { EVENT_IDS, STATUS, USER_TYPES, GAME_PROCESS_COMMANDS, REDIS_CHANNELS, PRIMITIVES } = require('../config/globals');

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
                game.deck = socketArgs.deck;
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
                person.userType = person.userType === USER_TYPES.BOT
                    ? USER_TYPES.KILLED_BOT
                    : USER_TYPES.KILLED_PLAYER;
                person.out = true;
                person.killed = true;
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
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
            }
        },
        communicate: async (game, socketArgs, vars) => {
            if (vars.authorizationFailed) {
                return;
            }
            const person = game.people.find((person) => person.id === socketArgs.personId);
            if (person) {
                vars.gameManager.namespace.in(game.accessCode).emit(
                    EVENT_IDS.REVEAL_PLAYER,
                    {
                        id: person.id,
                        gameRole: person.gameRole,
                        alignment: person.alignment
                    }
                );
            }
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
