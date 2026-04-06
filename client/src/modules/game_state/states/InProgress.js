import { toast } from '../../front_end_components/Toast.js';
import {
    STATUS,
    EVENT_IDS,
    SOCKET_EVENTS,
    USER_TYPE_ICONS,
    USER_TYPES,
    ALIGNMENT
} from '../../../config/globals.js';
import { HTMLFragments } from '../../front_end_components/HTMLFragments.js';
import { Confirmation } from '../../front_end_components/Confirmation.js';
import { ModalManager } from '../../front_end_components/ModalManager.js';
import { GameTimerManager } from '../../timer/GameTimerManager.js';
import { SharedStateUtil } from './shared/SharedStateUtil.js';

export class InProgress {
    constructor (containerId, stateBucket, socket) {
        this.stateBucket = stateBucket;
        this.socket = socket;
        this.container = document.getElementById(containerId);
        this.killPlayerHandlers = {};
        this.revealRoleHandlers = {};
        this.transferModHandlers = {};
        this.reviveHandlers = {};
    }

    setUserView (userType) {
        switch (userType) {
            case USER_TYPES.PLAYER:
                this.container.innerHTML = HTMLFragments.PLAYER_GAME_VIEW;
                this.renderPlayerView();
                break;
            case USER_TYPES.KILLED_PLAYER:
                this.container.innerHTML = HTMLFragments.PLAYER_GAME_VIEW;
                this.renderPlayerView(true);
                break;
            case USER_TYPES.MODERATOR:
                document.getElementById('transfer-mod-prompt').innerHTML = HTMLFragments.TRANSFER_MOD_MODAL;
                document.getElementById('player-options-prompt').innerHTML = HTMLFragments.PLAYER_OPTIONS_MODAL;
                this.container.innerHTML = HTMLFragments.MODERATOR_GAME_VIEW;
                this.renderModeratorView();
                break;
            case USER_TYPES.TEMPORARY_MODERATOR:
                document.getElementById('transfer-mod-prompt').innerHTML = HTMLFragments.TRANSFER_MOD_MODAL;
                document.getElementById('player-options-prompt').innerHTML = HTMLFragments.PLAYER_OPTIONS_MODAL;
                this.container.innerHTML = HTMLFragments.TEMP_MOD_GAME_VIEW;
                this.renderTempModView();
                break;
            case USER_TYPES.SPECTATOR:
                this.container.innerHTML = HTMLFragments.SPECTATOR_GAME_VIEW;
                this.renderSpectatorView();
                break;
            default:
                break;
        }

        if (this.stateBucket.currentGameState.timerParams) {
            this.socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.GET_TIME_REMAINING,
                this.stateBucket.currentGameState.accessCode
            );
            setTimeout(() => {
                if (this.socket.hasListeners(EVENT_IDS.GET_TIME_REMAINING) && document.getElementById('game-timer') !== null) {
                    document.getElementById('game-timer').innerText = 'Timer not found.';
                    document.getElementById('game-timer').classList.add('timer-error');
                }
            }, 15000);
        } else {
            document.querySelector('#game-timer')?.remove();
            document.querySelector('#timer-container-moderator')?.remove();
            document.querySelector('label[for="game-timer"]')?.remove();
        }

        const spectatorCount = this.container.querySelector('#spectator-count');
        const spectatorHandler = (e) => {
            if (e.type === 'click' || e.code === 'Enter') {
                Confirmation(
                    SharedStateUtil.buildSpectatorList(
                        this.stateBucket.currentGameState.people
                            .filter(p => p.userType === USER_TYPES.SPECTATOR),
                        this.stateBucket.currentGameState.client,
                        this.socket,
                        this.stateBucket.currentGameState),
                    null,
                    true
                );
            }
        };

        if (spectatorCount) {
            SharedStateUtil.setNumberOfSpectators(
                this.stateBucket.currentGameState.people.filter(p => p.userType === USER_TYPES.SPECTATOR).length,
                spectatorCount
            );
            spectatorCount?.addEventListener('click', spectatorHandler);
            spectatorCount?.addEventListener('keyup', spectatorHandler);
        }

        this.renderEnforcementPanels();
    }

    renderPlayerView (isKilled = false) {
        insertModeratorControlButton(this.stateBucket.currentGameState, this.socket);
        if (isKilled) {
            const clientUserType = document.getElementById('client-user-type');
            if (clientUserType) {
                clientUserType.innerText = USER_TYPES.KILLED_PLAYER + ' \uD83D\uDC80';
            }
        }
        renderPlayerRole(this.stateBucket.currentGameState);
        SharedStateUtil.displayCurrentModerator(this.stateBucket.currentGameState.people
            .find((person) => person.userType === USER_TYPES.MODERATOR
                || person.userType === USER_TYPES.TEMPORARY_MODERATOR));
        this.renderPlayersWithNoRoleInformationUnlessRevealed(false);
    }

    renderPlayersWithNoRoleInformationUnlessRevealed (tempMod = false) {
        if (tempMod) {
            this.removePlayerListEventListeners();
        }
        document.querySelectorAll('.game-player').forEach((el) => el.remove());
        /* TODO: UX issue - it's easier to parse visually when players are sorted this way,
          but shifting players around when they are killed or revealed is bad UX for the moderator. */
        // sortPeopleByStatus(this.stateBucket.currentGameState.people);
        const modType = tempMod
            ? this.stateBucket.currentGameState.people.find(person =>
                person.id === this.stateBucket.currentGameState.currentModeratorId).userType
            : null;
        this.renderGroupOfPlayers(
            this.stateBucket.currentGameState.people.filter(
                p => (p.userType !== USER_TYPES.MODERATOR && p.userType !== USER_TYPES.SPECTATOR)
                || p.killed
            ),
            this.killPlayerHandlers,
            this.revealRoleHandlers,
            this.stateBucket.currentGameState.accessCode,
            null,
            modType,
            this.socket
        );
        document.getElementById('players-alive-label').innerText =
            'Players: ' + this.stateBucket.currentGameState.people.filter((person) => !person.out).length + ' / ' +
            this.stateBucket.currentGameState.gameSize + ' Alive';
    }

    removePlayerListEventListeners (removeEl = true) {
        document.querySelectorAll('.game-player').forEach((el) => {
            const pointer = el.dataset.pointer;
            if (pointer && this.killPlayerHandlers[pointer]) {
                el.removeEventListener('click', this.killPlayerHandlers[pointer]);
                delete this.killPlayerHandlers[pointer];
            }
            if (pointer && this.revealRoleHandlers[pointer]) {
                el.removeEventListener('click', this.revealRoleHandlers[pointer]);
                delete this.revealRoleHandlers[pointer];
            }
            if (pointer && this.reviveHandlers[pointer]) {
                el.removeEventListener('click', this.reviveHandlers[pointer]);
                delete this.reviveHandlers[pointer];
            }
            if (removeEl) {
                el.remove();
            }
        });
    }

    renderModeratorView () {
        createEndGamePromptComponent(this.socket, this.stateBucket);
        insertResetTimerButton(this.stateBucket.currentGameState, this.socket);
        insertModeratorControlButton(this.stateBucket.currentGameState, this.socket);

        const modTransferButton = document.getElementById('mod-transfer-button');
        if (modTransferButton && !SharedStateUtil.clientIsOriginalModerator(this.stateBucket.currentGameState)) {
            modTransferButton.addEventListener(
                'click', () => {
                    this.displayAvailableModerators();
                    ModalManager.displayModal(
                        'transfer-mod-modal',
                        'transfer-mod-modal-background',
                        'close-mod-transfer-modal-button'
                    );
                }
            );
        }
        this.renderPlayersWithRoleAndAlignmentInfo();
    }

    renderTempModView () {
        createEndGamePromptComponent(this.socket, this.stateBucket);
        insertResetTimerButton(this.stateBucket.currentGameState, this.socket);
        insertModeratorControlButton(this.stateBucket.currentGameState, this.socket);

        renderPlayerRole(this.stateBucket.currentGameState);
        this.renderPlayersWithNoRoleInformationUnlessRevealed(true);
    }

    renderSpectatorView () {
        insertModeratorControlButton(this.stateBucket.currentGameState, this.socket);
        SharedStateUtil.displayCurrentModerator(this.stateBucket.currentGameState.people
            .find((person) => person.userType === USER_TYPES.MODERATOR
                || person.userType === USER_TYPES.TEMPORARY_MODERATOR));
        this.renderPlayersWithNoRoleInformationUnlessRevealed();
    }

    setSocketHandlers () {
        this.socket.on(EVENT_IDS.KILL_PLAYER, (killedPlayer) => {
            this.stateBucket.currentGameState.people = this.stateBucket.currentGameState.people
                .map(person => person.id === killedPlayer.id ? killedPlayer : person);
            if (this.stateBucket.currentGameState.client.userType === USER_TYPES.MODERATOR) {
                toast(killedPlayer.name + ' killed.', 'success', true, true, 'medium');
                this.renderPlayersWithRoleAndAlignmentInfo(this.stateBucket.currentGameState.status === STATUS.ENDED);
            } else {
                if (killedPlayer.id === this.stateBucket.currentGameState.client.id) {
                    const clientUserType = document.getElementById('client-user-type');
                    if (clientUserType) {
                        clientUserType.innerText = USER_TYPES.KILLED_PLAYER + ' \uD83D\uDC80';
                    }
                    this.updatePlayerCardToKilledState();
                    toast('You have been killed!', 'warning', true, true, 'medium');
                } else {
                    toast(killedPlayer.name + ' was killed!', 'warning', true, true, 'medium');
                    if (killedPlayer.userType === USER_TYPES.MODERATOR
                        && this.stateBucket.currentGameState.client.userType !== USER_TYPES.TEMPORARY_MODERATOR) {
                        SharedStateUtil.displayCurrentModerator(killedPlayer);
                    }
                }
                if (this.stateBucket.currentGameState.client.userType === USER_TYPES.TEMPORARY_MODERATOR) {
                    this.removePlayerListEventListeners(false);
                } else {
                    this.renderPlayersWithNoRoleInformationUnlessRevealed(false);
                }
            }
        });

        this.socket.on(EVENT_IDS.REVEAL_PLAYER, (revealData) => {
            const revealedPerson = this.stateBucket.currentGameState.people.find((person) => person.id === revealData.id);
            if (revealedPerson) {
                revealedPerson.revealed = true;
                revealedPerson.gameRole = revealData.gameRole;
                revealedPerson.alignment = revealData.alignment;
                if (this.stateBucket.currentGameState.client.userType === USER_TYPES.MODERATOR) {
                    if (revealedPerson.id === this.stateBucket.currentGameState.client.id) {
                        toast('You revealed your role.', 'success', true, true, 'medium');
                    } else {
                        toast(revealedPerson.name + ' revealed.', 'success', true, true, 'medium');
                    }

                    this.renderPlayersWithRoleAndAlignmentInfo(this.stateBucket.currentGameState.status === STATUS.ENDED);
                } else {
                    if (revealedPerson.id === this.stateBucket.currentGameState.client.id) {
                        toast('Your role has been revealed!', 'warning', true, true, 'medium');
                    } else {
                        toast(revealedPerson.name + ' was revealed as a ' + revealedPerson.gameRole + '!', 'warning', true, true, 'medium');
                    }
                    if (this.stateBucket.currentGameState.client.userType === USER_TYPES.TEMPORARY_MODERATOR) {
                        this.renderPlayersWithNoRoleInformationUnlessRevealed(true);
                    } else {
                        this.renderPlayersWithNoRoleInformationUnlessRevealed(false);
                    }
                }
            }
        });

        this.socket.on(EVENT_IDS.ADD_SPECTATOR, (spectator) => {
            this.stateBucket.currentGameState.people.push(spectator);
            SharedStateUtil.setNumberOfSpectators(
                this.stateBucket.currentGameState.people.filter(p => p.userType === USER_TYPES.SPECTATOR).length,
                document.getElementById('spectator-count')
            );
            if (this.stateBucket.currentGameState.client.userType === USER_TYPES.MODERATOR
                || this.stateBucket.currentGameState.client.userType === USER_TYPES.TEMPORARY_MODERATOR) {
                this.displayAvailableModerators();
            }
        });

        this.socket.on(EVENT_IDS.KICK_PERSON, (kickedId, gameIsStartable) => {
            if (kickedId === this.stateBucket.currentGameState.client.id) {
                window.location = '/?message=' + encodeURIComponent('You were kicked by the moderator.');
            } else {
                this.handleSpectatorExiting(kickedId);
            }
        });

        if (this.stateBucket.currentGameState.timerParams) {
            if (this.stateBucket.timerWorker) {
                this.stateBucket.timerWorker.terminate();
                this.stateBucket.timerWorker = null;
            }

            this.stateBucket.timerWorker = new Worker(new URL('../../timer/Timer.js', import.meta.url));

            const gameTimerManager = new GameTimerManager(this.stateBucket, this.socket);
            gameTimerManager.attachTimerSocketListeners(this.socket, this.stateBucket.timerWorker);
        }
    }

    renderPlayersWithRoleAndAlignmentInfo () {
        removeExistingPlayerElements(this.killPlayerHandlers, this.revealRoleHandlers);
        this.stateBucket.currentGameState.people.sort((a, b) => {
            return a.name >= b.name ? 1 : -1;
        });
        const teamGood = this.stateBucket.currentGameState.people.filter(
            (p) => p.alignment === ALIGNMENT.GOOD
                && ((p.userType !== USER_TYPES.MODERATOR && p.userType !== USER_TYPES.SPECTATOR)
                    || p.killed)

        );
        const teamEvil = this.stateBucket.currentGameState.people.filter((p) => p.alignment === ALIGNMENT.EVIL
            && ((p.userType !== USER_TYPES.MODERATOR && p.userType !== USER_TYPES.SPECTATOR)
                || p.killed)
        );
        const teamIndependent = this.stateBucket.currentGameState.people.filter((p) => p.alignment === ALIGNMENT.INDEPENDENT
            && ((p.userType !== USER_TYPES.MODERATOR && p.userType !== USER_TYPES.SPECTATOR)
                || p.killed)
        );
        if (teamEvil.length > 0) {
            document.getElementById(`${ALIGNMENT.EVIL}-players`).classList.remove('hidden');
            this.renderGroupOfPlayers(
                teamEvil,
                this.killPlayerHandlers,
                this.revealRoleHandlers,
                this.stateBucket.currentGameState.accessCode,
                ALIGNMENT.EVIL,
                this.stateBucket.currentGameState.people.find(person =>
                    person.id === this.stateBucket.currentGameState.currentModeratorId).userType,
                this.socket
            );
        }
        if (teamGood.length > 0) {
            document.getElementById(`${ALIGNMENT.GOOD}-players`).classList.remove('hidden');
            this.renderGroupOfPlayers(
                teamGood,
                this.killPlayerHandlers,
                this.revealRoleHandlers,
                this.stateBucket.currentGameState.accessCode,
                ALIGNMENT.GOOD,
                this.stateBucket.currentGameState.people.find(person =>
                    person.id === this.stateBucket.currentGameState.currentModeratorId).userType,
                this.socket
            );
        }
        if (teamIndependent.length > 0) {
            document.getElementById(`${ALIGNMENT.INDEPENDENT}-players`).classList.remove('hidden');
            this.renderGroupOfPlayers(
                teamIndependent,
                this.killPlayerHandlers,
                this.revealRoleHandlers,
                this.stateBucket.currentGameState.accessCode,
                ALIGNMENT.INDEPENDENT,
                this.stateBucket.currentGameState.people.find(person =>
                    person.id === this.stateBucket.currentGameState.currentModeratorId).userType,
                this.socket
            );
        }
        document.getElementById('players-alive-label').innerText =
            'Players: ' + this.stateBucket.currentGameState.people.filter((person) => !person.out).length + ' / ' +
            this.stateBucket.currentGameState.gameSize + ' Alive';
    }

    renderGroupOfPlayers (
        people,
        killPlayerHandlers,
        revealRoleHandlers,
        accessCode = null,
        alignment = null,
        moderatorType,
        socket = null
    ) {
        for (const player of people) {
            const playerEl = document.createElement('div');
            playerEl.classList.add('game-player');
            playerEl.dataset.pointer = player.id;

            // add a reference to the player's id for each corresponding element in the list
            if (moderatorType) {
                playerEl.dataset.pointer = player.id;
                playerEl.innerHTML = HTMLFragments.MODERATOR_PLAYER;
            } else {
                playerEl.innerHTML = HTMLFragments.GAME_PLAYER;
            }

            playerEl.querySelector('.game-player-name').innerText = player.name;
            const roleElement = playerEl.querySelector('.game-player-role');

            // Add role/alignment indicators if necessary
            if (moderatorType === USER_TYPES.MODERATOR || player.revealed) {
                if (alignment === null) {
                    roleElement.classList.add(player.alignment);
                } else {
                    roleElement.classList.add(alignment);
                }
                roleElement.innerText = player.gameRole;
            } else {
                roleElement.innerText = 'Role Unknown';
            }

            // Change element based on player's in/out status
            if (player.out) {
                playerEl.classList.add('killed');
                if (moderatorType) {
                    playerEl.querySelector('.kill-player-button')?.remove();
                    if (this.stateBucket.currentGameState.enforcement?.enabled) {
                        const reviveButton = document.createElement('button');
                        reviveButton.classList.add('moderator-player-button', 'app-button');
                        reviveButton.innerText = 'Revive';
                        this.reviveHandlers[player.id] = () => {
                            Confirmation('Revive \'' + player.name + '\'?', () => {
                                socket.emit(SOCKET_EVENTS.IN_GAME_MESSAGE, EVENT_IDS.REVIVE_PLAYER, accessCode, { personId: player.id });
                            });
                        };
                        reviveButton.addEventListener('click', this.reviveHandlers[player.id]);
                        playerEl.querySelector('.player-action-buttons').prepend(reviveButton);
                    } else {
                        insertPlaceholderButton(playerEl, false, 'killed');
                    }
                }
            } else if (!player.out && moderatorType) {
                killPlayerHandlers[player.id] = () => {
                    if (this.stateBucket.currentGameState.client.userType === USER_TYPES.TEMPORARY_MODERATOR) {
                        displayTempModeratorKillChoice(player, accessCode, socket, this.stateBucket.currentGameState);
                    } else {
                        Confirmation('Kill \'' + player.name + '\'?', () => {
                            socket.emit(SOCKET_EVENTS.IN_GAME_MESSAGE, EVENT_IDS.KILL_PLAYER, accessCode, { personId: player.id });
                        });
                    }
                };
                playerEl.querySelector('.kill-player-button').addEventListener('click', killPlayerHandlers[player.id]);
            }

            // change element based on player's revealed/unrevealed status
            if (player.revealed) {
                if (moderatorType) {
                    playerEl.querySelector('.reveal-role-button')?.remove();
                    insertPlaceholderButton(playerEl, true, 'revealed');
                }
            } else if (!player.revealed && moderatorType) {
                revealRoleHandlers[player.id] = () => {
                    Confirmation('Reveal  \'' + player.name + '\'?', () => {
                        socket.emit(SOCKET_EVENTS.IN_GAME_MESSAGE, EVENT_IDS.REVEAL_PLAYER, accessCode, { personId: player.id });
                    });
                };
                playerEl.querySelector('.reveal-role-button').addEventListener('click', revealRoleHandlers[player.id]);
            }

            const playerListContainerId = moderatorType === USER_TYPES.MODERATOR
                ? 'player-list-moderator-team-' + alignment
                : 'game-player-list';

            document.getElementById(playerListContainerId).appendChild(playerEl);
        }
    }

    handleSpectatorExiting (id) {
        const index = this.stateBucket.currentGameState.people.findIndex(person => person.id === id);
        if (index >= 0) {
            this.stateBucket.currentGameState.people
                .splice(index, 1);
        }
        SharedStateUtil.setNumberOfSpectators(
            this.stateBucket.currentGameState.people.filter(p => p.userType === USER_TYPES.SPECTATOR).length,
            document.getElementById('spectator-count')
        );
        if (this.stateBucket.currentGameState.client.userType === USER_TYPES.MODERATOR
            || this.stateBucket.currentGameState.client.userType === USER_TYPES.TEMPORARY_MODERATOR) {
            toast(
                'Spectator kicked.',
                'success',
                true,
                true,
                'short'
            );
        }
    }

    displayAvailableModerators () {
        document.getElementById('transfer-mod-modal-content').innerText = '';
        document.querySelectorAll('.potential-moderator').forEach((el) => {
            const pointer = el.dataset.pointer;
            if (pointer && this.transferModHandlers[pointer]) {
                el.removeEventListener('click', this.transferModHandlers[pointer]);
                delete this.transferModHandlers[pointer];
            }
            el.remove();
        });
        renderPotentialMods(
            this.stateBucket.currentGameState,
            this.stateBucket.currentGameState.people,
            this.transferModHandlers,
            this.socket
        );

        if (document.querySelectorAll('.potential-moderator').length === 0) {
            document.getElementById('transfer-mod-modal-content').innerText =
                'There is nobody available to transfer to. Only spectators or killed players (who are not bots) can be mods.';
        }
    }

    updatePlayerCardToKilledState () {
        document.querySelector('#role-image').classList.add('killed-card');
        document.getElementById('role-image').setAttribute(
            'src',
            '../images/tombstone.png'
        );
    }

    renderEnforcementPanels () {
        document.getElementById('enforcement-root')?.remove();
        if (!this.stateBucket.currentGameState.enforcement?.enabled) {
            return;
        }

        const container = document.createElement('div');
        container.id = 'enforcement-root';
        container.classList.add('enforcement-root');
        container.appendChild(buildEnforcementSummary(this.stateBucket.currentGameState));
        container.appendChild(buildHistoryPanel(this.stateBucket.currentGameState));

        const votePanel = buildVotePanel(this.stateBucket.currentGameState, this.socket);
        if (votePanel) {
            container.appendChild(votePanel);
        }

        const actionPanel = buildNightActionPanel(this.stateBucket.currentGameState, this.socket);
        if (actionPanel) {
            container.appendChild(actionPanel);
        }

        const evilPanel = buildEvilPanel(this.stateBucket.currentGameState, this.socket);
        if (evilPanel) {
            container.appendChild(evilPanel);
        }

        const moderatorPanel = buildModeratorEnforcementPanel(this.stateBucket.currentGameState, this.socket);
        if (moderatorPanel) {
            container.appendChild(moderatorPanel);
        }

        this.container.appendChild(container);
    }
}

function renderPlayerRole (gameState) {
    const name = document.querySelector('#role-name');
    name.innerText = gameState.client.gameRole;
    if (gameState.client.alignment === ALIGNMENT.GOOD) {
        document.getElementById('game-role').classList.add('game-role-good');
        name.classList.add('good');
    } else if (gameState.client.alignment === ALIGNMENT.EVIL) {
        document.getElementById('game-role').classList.add('game-role-evil');
        name.classList.add('evil');
    } else if (gameState.client.alignment === ALIGNMENT.INDEPENDENT) {
        document.getElementById('game-role').classList.add('game-role-independent');
        name.classList.add('independent');
    }
    name.setAttribute('title', gameState.client.gameRole);
    if (gameState.client.out) {
        document.querySelector('#role-image').classList.add('killed-card');
        document.getElementById('role-image').setAttribute(
            'src',
            '../images/tombstone.png'
        );
    } else {
        if (gameState.client.gameRole.toLowerCase() === 'villager') {
            document.getElementById('role-image').setAttribute(
                'src',
                '../images/roles/Villager' + Math.ceil(Math.random() * 2) + '.png'
            );
        } else {
            if (gameState.client.customRole) {
                document.getElementById('role-image').setAttribute(
                    'src',
                    '../images/roles/custom-role.svg'
                );
            } else {
                document.getElementById('role-image').setAttribute(
                    'src',
                    '../images/roles/' + gameState.client.gameRole.replaceAll(' ', '') + '.png'
                );
            }
        }
        document.getElementById('role-image').onerror = () => {
            document.getElementById('role-image').setAttribute(
                'src',
                '../images/roles/custom-role.svg'
            );
        };
    }

    document.querySelector('#role-description').innerText = gameState.client.gameRoleDescription;

    const roleBackHandler = (e) => {
        if (e.type === 'dblclick' || e.code === 'Enter') {
            document.getElementById('game-role').style.display = 'flex';
            document.getElementById('game-role-back').style.display = 'none';
        }
    };

    const roleFrontHandler = (e) => {
        if (e.type === 'dblclick' || e.code === 'Enter') {
            document.getElementById('game-role-back').style.display = 'flex';
            document.getElementById('game-role').style.display = 'none';
        }
    };

    document.getElementById('game-role-back').addEventListener('dblclick', roleBackHandler);
    document.getElementById('game-role-back').addEventListener('keyup', roleBackHandler);

    document.getElementById('game-role').addEventListener('dblclick', roleFrontHandler);
    document.getElementById('game-role').addEventListener('keyup', roleFrontHandler);
}

function removeExistingPlayerElements (killPlayerHandlers, revealRoleHandlers) {
    document.querySelectorAll('.game-player').forEach((el) => {
        const pointer = el.dataset.pointer;
        if (pointer && killPlayerHandlers[pointer]) {
            el.removeEventListener('click', killPlayerHandlers[pointer]);
            delete killPlayerHandlers[pointer];
        }
        if (pointer && revealRoleHandlers[pointer]) {
            el.removeEventListener('click', revealRoleHandlers[pointer]);
            delete revealRoleHandlers[pointer];
        }
        el.remove();
    });
}

function createEndGamePromptComponent (socket, stateBucket) {
    if (document.querySelector('#game-control-prompt') === null) {
        const div = document.createElement('div');
        div.id = 'game-control-prompt';
        div.innerHTML = HTMLFragments.END_GAME_BUTTON;
        div.querySelector('#end-game-button').addEventListener('click', (e) => {
            e.preventDefault();
            Confirmation('End the game?', () => {
                toast('Ending...', 'neutral', true, false);
                socket.emit(
                    SOCKET_EVENTS.IN_GAME_MESSAGE,
                    EVENT_IDS.END_GAME,
                    stateBucket.currentGameState.accessCode,
                    null,
                    () => {
                        toast('Game ended.', 'success', true);
                    }
                );
            });
        });
        div.prepend(SharedStateUtil.createReturnToLobbyButton(stateBucket));
        document.getElementById('game-content').appendChild(div);
    }
}

function insertResetTimerButton (gameState, socket) {
    if (!gameState.timerParams || document.getElementById('reset-timer-button')) {
        return;
    }

    const timerContainer = document.getElementById('timer-container-moderator');
    if (!timerContainer) {
        return;
    }

    const resetTimerButton = document.createElement('button');
    resetTimerButton.id = 'reset-timer-button';
    resetTimerButton.classList.add('app-button');
    resetTimerButton.innerText = 'Reset Timer';
    resetTimerButton.addEventListener('click', () => {
        Confirmation('Reset the timer to the full duration and start it?', () => {
            toast('Resetting timer...', 'neutral', true, false);
            socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.RESET_TIMER,
                gameState.accessCode
            );
        });
    });
    timerContainer.appendChild(resetTimerButton);
}

function insertModeratorControlButton (gameState, socket) {
    const moderatorControlPrompt = document.getElementById('moderator-control-prompt');
    if (!SharedStateUtil.clientIsOriginalModerator(gameState)) {
        document.getElementById('moderator-control-button')?.remove();
        if (moderatorControlPrompt) {
            moderatorControlPrompt.innerHTML = '';
        }
        return;
    }

    SharedStateUtil.ensureModeratorControlModal();
    const existingTransferButton = document.getElementById('mod-transfer-button');
    existingTransferButton?.remove();

    if (document.getElementById('moderator-control-button')) {
        return;
    }

    const gameHeader = document.getElementById('game-header');
    if (!gameHeader) {
        return;
    }

    const moderatorControlButton = document.createElement('button');
    moderatorControlButton.id = 'moderator-control-button';
    moderatorControlButton.classList.add('app-button');
    moderatorControlButton.innerText = 'Moderator Controls';
    moderatorControlButton.addEventListener('click', () => {
        SharedStateUtil.openModeratorControlModal(gameState, socket);
    });

    const roleInfoContainer = gameHeader.querySelector('div:last-child');
    if (roleInfoContainer) {
        gameHeader.insertBefore(moderatorControlButton, roleInfoContainer);
    } else {
        gameHeader.appendChild(moderatorControlButton);
    }
}

function displayTempModeratorKillChoice (player, accessCode, socket, gameState) {
    document.querySelector('#player-options-modal-title').innerText = `Kill ${player.name}`;
    const modalContent = document.getElementById('player-options-modal-content');
    modalContent.innerHTML = '';

    const justKillOption = document.createElement('button');
    justKillOption.setAttribute('class', 'player-option');
    justKillOption.innerText = 'Just Kill';
    justKillOption.addEventListener('click', () => {
        ModalManager.dispelModal('player-options-modal', 'player-options-modal-background');
        socket.emit(
            SOCKET_EVENTS.IN_GAME_MESSAGE,
            EVENT_IDS.KILL_PLAYER,
            accessCode,
            { personId: player.id }
        );
    });

    modalContent.appendChild(justKillOption);
    if (!gameState.enforcement?.enabled) {
        const dedicatedModOption = document.createElement('button');
        dedicatedModOption.setAttribute('class', 'player-option');
        dedicatedModOption.innerText = 'Kill + Make Dedicated Mod';
        dedicatedModOption.addEventListener('click', () => {
            ModalManager.dispelModal('player-options-modal', 'player-options-modal-background');
            socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.ASSIGN_DEDICATED_MOD,
                accessCode,
                { personId: player.id }
            );
        });
        modalContent.appendChild(dedicatedModOption);
    }
    ModalManager.displayModal(
        'player-options-modal',
        'player-options-modal-background',
        'close-player-options-modal-button'
    );
}

function insertPlaceholderButton (container, append, type) {
    const button = document.createElement('div');
    button.classList.add('placeholder-button');
    if (type === 'killed') {
        button.innerText = 'Killed';
    } else {
        button.innerText = 'Revealed';
    }
    if (append) {
        container.querySelector('.player-action-buttons').appendChild(button);
    } else {
        container.querySelector('.player-action-buttons').prepend(button);
    }
}

function renderPotentialMods (gameState, group, transferModHandlers, socket) {
    const modalContent = document.getElementById('transfer-mod-modal-content');
    for (const member of group) {
        if ((member.userType === USER_TYPES.KILLED_PLAYER || member.userType === USER_TYPES.SPECTATOR) && !(member.id === gameState.client.id)) {
            const container = document.createElement('div');
            container.classList.add('potential-moderator');
            container.setAttribute('tabindex', '0');
            container.dataset.pointer = member.id;
            container.innerHTML =
                '<div class=\'potential-mod-name\'></div>' +
                '<div>' + member.userType + ' ' + USER_TYPE_ICONS[member.userType] + ' </div>';
            container.querySelector('.potential-mod-name').innerText = member.name;
            transferModHandlers[member.id] = (e) => {
                if (e.type === 'click' || e.code === 'Enter') {
                    ModalManager.dispelModal('transfer-mod-modal', 'transfer-mod-modal-background');
                    Confirmation('Transfer moderator powers to \'' + member.name + '\'?', () => {
                        toast('Transferring...', 'neutral', true, false);
                        const transferPrompt = document.getElementById('transfer-mod-prompt');
                        if (transferPrompt !== null) {
                            transferPrompt.innerHTML = '';
                        }
                        socket.timeout(5000).emit(
                            SOCKET_EVENTS.IN_GAME_MESSAGE,
                            EVENT_IDS.TRANSFER_MODERATOR,
                            gameState.accessCode,
                            { personId: member.id },
                            () => {
                                toast('Transferred!', 'success', true, true);
                            }
                        );
                    });
                }
            };

            container.addEventListener('click', transferModHandlers[member.id]);
            container.addEventListener('keyup', transferModHandlers[member.id]);
            modalContent.appendChild(container);
        }
    }
}

function buildEnforcementSummary (gameState) {
    const enforcement = gameState.enforcement;
    const container = document.createElement('section');
    container.classList.add('enforcement-panel');
    const deadVoteTimer = enforcement.openVote?.deadVoteWindowEndsAt
        ? ' | dead-voter timer: ' + formatCountdown(enforcement.openVote.deadVoteWindowEndsAt)
        : '';
    container.innerHTML =
        `<h3>Enforced Game Logic</h3>
        <div>Phase: ${enforcement.phase} | Day ${enforcement.dayNumber} | Night ${enforcement.nightNumber}${deadVoteTimer}</div>
        <div>Count reveals used: ${enforcement.countRevealUses}${gameState.settings?.maxAlignmentCountReveals !== null ? '/' + gameState.settings.maxAlignmentCountReveals : ''}</div>`;

    if (enforcement.privateNotices?.length > 0) {
        const noticeList = document.createElement('div');
        noticeList.classList.add('enforcement-subpanel');
        noticeList.innerHTML = '<h4>Private notices</h4>';
        for (const notice of enforcement.privateNotices.slice().reverse()) {
            const item = document.createElement('div');
            item.classList.add('history-entry');
            item.innerText = notice.message;
            noticeList.appendChild(item);
        }
        container.appendChild(noticeList);
    }

    return container;
}

function buildHistoryPanel (gameState) {
    const panel = document.createElement('section');
    panel.classList.add('enforcement-panel');
    panel.innerHTML = '<h3>History</h3>';

    if (!gameState.enforcement.publicHistory.length) {
        const empty = document.createElement('div');
        empty.innerText = 'No public history yet.';
        panel.appendChild(empty);
        return panel;
    }

    const list = document.createElement('div');
    list.classList.add('history-list');
    for (const entry of gameState.enforcement.publicHistory.slice().reverse()) {
        list.appendChild(renderHistoryEntry(entry, gameState));
    }
    panel.appendChild(list);
    return panel;
}

function buildVotePanel (gameState, socket) {
    const vote = gameState.enforcement.openVote;
    if (!vote) {
        return null;
    }

    const panel = document.createElement('section');
    panel.classList.add('enforcement-panel');
    panel.innerHTML = `<h3>${vote.type === 'day' ? 'Day vote' : 'Night vote'}</h3>`;

    if (vote.status === 'open' && clientCanVote(gameState, vote)) {
        const form = document.createElement('div');
        form.classList.add('vote-form');
        const currentSelections = new Set(vote.yourBallot?.selections || []);
        for (const candidateId of vote.candidateIds) {
            const candidate = getPersonById(gameState, candidateId);
            const label = document.createElement('label');
            label.classList.add('checkbox-label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = candidateId;
            checkbox.checked = currentSelections.has(candidateId);
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(candidate?.name || candidateId));
            form.appendChild(label);
        }
        const submitButton = document.createElement('button');
        submitButton.classList.add('app-button');
        submitButton.innerText = 'Submit Vote';
        submitButton.addEventListener('click', () => {
            const selections = Array.from(form.querySelectorAll('input[type="checkbox"]:checked')).map((el) => el.value);
            socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.SUBMIT_VOTE,
                gameState.accessCode,
                { selections, passed: false }
            );
        });
        const passButton = document.createElement('button');
        passButton.classList.add('app-button', 'cancel');
        passButton.innerText = 'Pass';
        passButton.addEventListener('click', () => {
            socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.SUBMIT_VOTE,
                gameState.accessCode,
                { selections: [], passed: true }
            );
        });
        panel.appendChild(form);
        panel.appendChild(submitButton);
        panel.appendChild(passButton);
    } else {
        const info = document.createElement('div');
        info.innerText = vote.status === 'open'
            ? 'Voting is open.'
            : 'Voting is closed.';
        panel.appendChild(info);
    }

    if (vote.resolution) {
        panel.appendChild(renderVoteResolution(vote.resolution, gameState));
    }

    return panel;
}

function buildNightActionPanel (gameState, socket) {
    const enforcement = gameState.enforcement;
    if (enforcement.phase !== 'night') {
        return null;
    }

    const panel = document.createElement('section');
    panel.classList.add('enforcement-panel');
    panel.innerHTML = '<h3>Night Actions</h3>';
    const client = gameState.client;
    const livingTargets = gameState.people.filter((person) => !person.out && person.id !== client.id);
    let hasContent = false;

    const appendTargetButtons = (title, actionType, includeSelf = false) => {
        const section = document.createElement('div');
        section.classList.add('enforcement-subpanel');
        section.innerHTML = `<h4>${title}</h4>`;
        const targets = includeSelf ? gameState.people.filter((person) => !person.out) : livingTargets;
        for (const target of targets) {
            const button = document.createElement('button');
            button.classList.add('app-button');
            button.innerText = target.name;
            button.addEventListener('click', () => {
                socket.emit(
                    SOCKET_EVENTS.IN_GAME_MESSAGE,
                    EVENT_IDS.SUBMIT_NIGHT_ACTION,
                    gameState.accessCode,
                    { actionType, targetId: target.id }
                );
            });
            section.appendChild(button);
        }
        panel.appendChild(section);
        hasContent = true;
    };

    if (!client.out) {
        if (client.gameRole === 'Seer' || client.gameRole === 'Super Seer') {
            appendTargetButtons('Inspect a player', 'inspect');
        }
        if (client.gameRole === 'Sorceress') {
            appendTargetButtons('Sense the seer family', 'senseSeer');
        }
        if (client.gameRole === 'Doctor') {
            appendTargetButtons('Protect a player', 'protect', true);
        }
        if (client.gameRole === 'Witch') {
            if (!client.roleState?.witchHealUsed) {
                appendTargetButtons('Use heal potion', 'heal', true);
            }
            if (!client.roleState?.witchPoisonUsed) {
                appendTargetButtons('Use poison potion', 'poison');
            }
        }
    }

    if (enforcement.activeHunterPrompt && (enforcement.activeHunterPrompt.hunterId === client.id || isModeratorClient(gameState))) {
        appendHunterPrompt(panel, enforcement.activeHunterPrompt, gameState, socket);
        hasContent = true;
    }

    return hasContent ? panel : null;
}

function buildEvilPanel (gameState, socket) {
    const enforcement = gameState.enforcement;
    if (
        (!enforcement.evilHistory || enforcement.evilHistory.length === 0)
        && (!enforcement.evilChat || enforcement.evilChat.length === 0)
        && (!enforcement.evilRoster || enforcement.evilRoster.length === 0)
    ) {
        return null;
    }

    const panel = document.createElement('section');
    panel.classList.add('enforcement-panel');
    panel.innerHTML = '<h3>Evil Team</h3>';

    if (enforcement.evilRoster?.length > 0) {
        const roster = document.createElement('div');
        roster.classList.add('enforcement-subpanel');
        roster.innerHTML = '<h4>Roster</h4>';
        enforcement.evilRoster.forEach((member) => {
            const el = document.createElement('div');
            el.innerText = member.name + (member.out ? ' ☠' : '');
            roster.appendChild(el);
        });
        panel.appendChild(roster);
    }

    if (enforcement.evilHistory?.length > 0) {
        const history = document.createElement('div');
        history.classList.add('enforcement-subpanel');
        history.innerHTML = '<h4>Private evil history</h4>';
        enforcement.evilHistory.slice().reverse().forEach((entry) => {
            history.appendChild(renderHistoryEntry(entry, gameState));
        });
        panel.appendChild(history);
    }

    if (enforcement.phase === 'night' && enforcement.evilChat) {
        const chat = document.createElement('div');
        chat.classList.add('enforcement-subpanel');
        chat.innerHTML = '<h4>Evil chat</h4>';
        const messages = document.createElement('div');
        enforcement.evilChat.slice().reverse().forEach((entry) => {
            const line = document.createElement('div');
            line.classList.add('history-entry');
            line.innerText = entry.senderName + ': ' + entry.message;
            messages.appendChild(line);
        });
        chat.appendChild(messages);
        if (gameState.client.evilChatAccess) {
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Send a message...';
            const sendButton = document.createElement('button');
            sendButton.classList.add('app-button');
            sendButton.innerText = 'Send';
            sendButton.addEventListener('click', () => {
                socket.emit(
                    SOCKET_EVENTS.IN_GAME_MESSAGE,
                    EVENT_IDS.SEND_EVIL_CHAT,
                    gameState.accessCode,
                    { message: input.value }
                );
                input.value = '';
            });
            chat.appendChild(input);
            chat.appendChild(sendButton);
        }
        panel.appendChild(chat);
    }

    return panel;
}

function buildModeratorEnforcementPanel (gameState, socket) {
    if (!isModeratorClient(gameState) || !gameState.enforcement?.enabled) {
        return null;
    }

    const panel = document.createElement('section');
    panel.classList.add('enforcement-panel');
    panel.innerHTML = '<h3>Moderator Logic Controls</h3>';

    const advanceButton = document.createElement('button');
    advanceButton.classList.add('app-button');
    advanceButton.innerText = gameState.enforcement.phase === 'day' ? 'Begin Night' : 'Begin Day';
    advanceButton.addEventListener('click', () => {
        socket.emit(SOCKET_EVENTS.IN_GAME_MESSAGE, EVENT_IDS.ADVANCE_PHASE, gameState.accessCode);
    });
    panel.appendChild(advanceButton);

    if (gameState.enforcement.phase === 'day' && !gameState.enforcement.openVote && (gameState.settings?.allowFirstDayVillageVote || gameState.enforcement.dayNumber > 1)) {
        const picker = document.createElement('div');
        picker.classList.add('enforcement-subpanel');
        picker.innerHTML = '<h4>Start day vote</h4>';
        for (const person of gameState.people.filter((entry) => !entry.out)) {
            const label = document.createElement('label');
            label.classList.add('checkbox-label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = person.id;
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(person.name));
            picker.appendChild(label);
        }
        const startVoteButton = document.createElement('button');
        startVoteButton.classList.add('app-button');
        startVoteButton.innerText = 'Start Day Vote';
        startVoteButton.addEventListener('click', () => {
            const candidateIds = Array.from(picker.querySelectorAll('input[type="checkbox"]:checked')).map((el) => el.value);
            socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.START_DAY_VOTE,
                gameState.accessCode,
                { candidateIds }
            );
        });
        picker.appendChild(startVoteButton);
        panel.appendChild(picker);
    }

    if (gameState.enforcement.openVote?.type === 'day' && gameState.enforcement.openVote.status === 'open') {
        const closeVoteButton = document.createElement('button');
        closeVoteButton.classList.add('app-button');
        closeVoteButton.innerText = 'Close Day Vote';
        closeVoteButton.addEventListener('click', () => {
            socket.emit(SOCKET_EVENTS.IN_GAME_MESSAGE, EVENT_IDS.CLOSE_DAY_VOTE, gameState.accessCode);
        });
        panel.appendChild(closeVoteButton);
    }

    if (gameState.enforcement.openVote?.type === 'day' && gameState.enforcement.openVote.status === 'closed') {
        const resolveSection = document.createElement('div');
        resolveSection.classList.add('enforcement-subpanel');
        resolveSection.innerHTML = '<h4>Resolve closed day vote</h4>';
        const resolution = gameState.enforcement.openVote.resolution || {};
        const leaders = resolution.leaders || [];
        const thresholdNotice = document.createElement('div');
        thresholdNotice.classList.add('history-entry-details');
        if (typeof resolution.minimumVotesToEliminate === 'number') {
            thresholdNotice.innerText = `A player needs at least ${resolution.minimumVotesToEliminate} vote${resolution.minimumVotesToEliminate === 1 ? '' : 's'} to be killed by the day vote.`;
        } else {
            thresholdNotice.innerText = 'A moderator may kill or pass on the current day vote result.';
        }
        resolveSection.appendChild(thresholdNotice);
        if (leaders.length === 1) {
            const killButton = document.createElement('button');
            killButton.classList.add('app-button');
            killButton.innerText = (resolution.meetsEliminationThreshold ? 'Kill ' : 'Kill anyway: ') + (getPersonById(gameState, leaders[0])?.name || 'leader');
            killButton.addEventListener('click', () => {
                socket.emit(
                    SOCKET_EVENTS.IN_GAME_MESSAGE,
                    EVENT_IDS.RESOLVE_DAY_VOTE,
                    gameState.accessCode,
                    { mode: resolution.meetsEliminationThreshold ? 'kill' : 'killOverride' }
                );
            });
            resolveSection.appendChild(killButton);
        }
        if (leaders.length > 1 && resolution.meetsEliminationThreshold) {
            const randomButton = document.createElement('button');
            randomButton.classList.add('app-button');
            randomButton.innerText = 'Randomly kill a tied leader';
            randomButton.addEventListener('click', () => {
                socket.emit(
                    SOCKET_EVENTS.IN_GAME_MESSAGE,
                    EVENT_IDS.RESOLVE_DAY_VOTE,
                    gameState.accessCode,
                    { mode: 'randomTied' }
                );
            });
            resolveSection.appendChild(randomButton);
        }
        if (leaders.length > 1 && !resolution.meetsEliminationThreshold) {
            const tieNotice = document.createElement('div');
            tieNotice.classList.add('history-entry-details');
            tieNotice.innerText = 'No tied leader reached the vote threshold. Pass here, or use the regular moderator kill controls if you want to override the vote.';
            resolveSection.appendChild(tieNotice);
        }
        const passButton = document.createElement('button');
        passButton.classList.add('app-button', 'cancel');
        passButton.innerText = 'Pass / clear current vote';
        passButton.addEventListener('click', () => {
            socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.RESOLVE_DAY_VOTE,
                gameState.accessCode,
                { mode: 'pass' }
            );
        });
        resolveSection.appendChild(passButton);
        panel.appendChild(resolveSection);
    }

    const revealCountsButton = document.createElement('button');
    revealCountsButton.classList.add('app-button');
    revealCountsButton.innerText = 'Reveal Alignment Counts';
    revealCountsButton.addEventListener('click', () => {
        const uses = gameState.enforcement.countRevealUses;
        const maxText = gameState.settings?.maxAlignmentCountReveals === null ? '' : '/' + gameState.settings.maxAlignmentCountReveals;
        Confirmation(
            `Reveal the current alignment counts? This has been used ${uses}${maxText} times so far.`,
            () => {
                socket.emit(
                    SOCKET_EVENTS.IN_GAME_MESSAGE,
                    EVENT_IDS.REVEAL_ALIGNMENT_COUNTS,
                    gameState.accessCode
                );
            }
        );
    });
    panel.appendChild(revealCountsButton);

    return panel;
}

function appendHunterPrompt (panel, hunterPrompt, gameState, socket) {
    const section = document.createElement('div');
    section.classList.add('enforcement-subpanel');
    section.innerHTML = '<h4>Brutal Hunter retaliation</h4>';
    for (const targetId of hunterPrompt.eligibleTargetIds) {
        const target = getPersonById(gameState, targetId);
        if (!target || target.out) {
            continue;
        }
        const button = document.createElement('button');
        button.classList.add('app-button');
        button.innerText = target.name;
        button.addEventListener('click', () => {
            socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.SUBMIT_NIGHT_ACTION,
                gameState.accessCode,
                { actionType: 'brutalTarget', targetId: target.id }
            );
        });
        section.appendChild(button);
    }
    if (isModeratorClient(gameState) || hunterPrompt.hunterId === gameState.client.id) {
        const passButton = document.createElement('button');
        passButton.classList.add('app-button', 'cancel');
        passButton.innerText = 'Pass';
        passButton.addEventListener('click', () => {
            socket.emit(
                SOCKET_EVENTS.IN_GAME_MESSAGE,
                EVENT_IDS.SUBMIT_NIGHT_ACTION,
                gameState.accessCode,
                { actionType: 'brutalTarget', passed: true }
            );
        });
        section.appendChild(passButton);
    }
    panel.appendChild(section);
}

function renderHistoryEntry (entry, gameState) {
    const container = document.createElement('div');
    container.classList.add('history-entry');
    const text = document.createElement('div');
    text.innerText = entry.text || entry.message || entry.type;
    container.appendChild(text);

    if (entry.ballots) {
        const ballots = document.createElement('div');
        ballots.classList.add('history-entry-details');
        entry.ballots.forEach((ballot) => {
            const line = document.createElement('div');
            line.innerText = ballot.voterName + ': ' + (ballot.passed ? 'pass' : ballot.selectionNames.join(', '));
            ballots.appendChild(line);
        });
        container.appendChild(ballots);
    }

    if (entry.totals) {
        const totals = document.createElement('div');
        totals.classList.add('history-entry-details');
        entry.totals.forEach((total) => {
            const line = document.createElement('div');
            line.innerText = `${total.candidateName}: ${total.count}`;
            totals.appendChild(line);
        });
        if (typeof entry.minimumVotesToEliminate === 'number') {
            const thresholdLine = document.createElement('div');
            thresholdLine.innerText = `Threshold to kill by day vote: ${entry.minimumVotesToEliminate}`;
            totals.appendChild(thresholdLine);
        }
        container.appendChild(totals);
    }

    if (entry.counts) {
        const counts = document.createElement('div');
        counts.classList.add('history-entry-details');
        counts.innerText = `good: ${entry.counts.good}, evil: ${entry.counts.evil}, independent: ${entry.counts.independent}`;
        container.appendChild(counts);
    }

    return container;
}

function renderVoteResolution (resolution, gameState) {
    const container = document.createElement('div');
    container.classList.add('history-entry');
    const thresholdText = typeof resolution.minimumVotesToEliminate === 'number'
        ? ` Need ${resolution.minimumVotesToEliminate}.`
        : '';
    if (resolution.winnerId) {
        container.innerText = 'Current winner: ' + (getPersonById(gameState, resolution.winnerId)?.name || resolution.winnerId) +
            (typeof resolution.topScore === 'number' ? ` with ${resolution.topScore} vote${resolution.topScore === 1 ? '' : 's'}.` : '.') +
            (resolution.tieBrokenBy ? ' (tie broken by ' + resolution.tieBrokenBy + ')' : '') +
            thresholdText;
    } else if (resolution.leaders?.length) {
        container.innerText = 'Current leaders are tied with ' +
            (typeof resolution.topScore === 'number' ? resolution.topScore : 0) +
            ' votes.' + thresholdText;
    } else {
        container.innerText = 'No single winner yet.' + thresholdText;
    }
    return container;
}

function clientCanVote (gameState, vote) {
    const client = gameState.client;
    if (vote.type === 'day') {
        return !client.out && client.userType !== USER_TYPES.SPECTATOR && client.userType !== USER_TYPES.MODERATOR;
    }
    if (client.alignment !== ALIGNMENT.EVIL || client.roleState?.asleep) {
        return false;
    }
    if (!client.out) {
        return true;
    }
    return Boolean(vote.deadVoteWindowEndsAt && new Date(vote.deadVoteWindowEndsAt).getTime() > Date.now());
}

function getPersonById (gameState, personId) {
    if (gameState.client.id === personId) {
        return gameState.client;
    }
    return gameState.people.find((person) => person.id === personId) || null;
}

function isModeratorClient (gameState) {
    return gameState.client.userType === USER_TYPES.MODERATOR || gameState.client.userType === USER_TYPES.TEMPORARY_MODERATOR;
}

function formatCountdown (endsAt) {
    const millis = new Date(endsAt).getTime() - Date.now();
    if (millis <= 0) {
        return '00:00';
    }
    const totalSeconds = Math.ceil(millis / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}
