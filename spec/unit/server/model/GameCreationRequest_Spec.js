const GameCreationRequest = require('../../../../server/model/GameCreationRequest');
const { ALIGNMENT } = require('../../../../server/config/globals');

describe('GameCreationRequest', () => {
    describe('#deckIsValid', () => {
        it('should accept a deck with good, evil, and independent roles', () => {
            const deck = [
                {
                    role: 'Villager',
                    team: ALIGNMENT.GOOD,
                    description: 'A simple villager',
                    custom: false,
                    quantity: 2
                },
                {
                    role: 'Werewolf',
                    team: ALIGNMENT.EVIL,
                    description: 'A werewolf',
                    custom: false,
                    quantity: 1
                },
                {
                    role: 'Tanner',
                    team: ALIGNMENT.INDEPENDENT,
                    description: 'An independent role',
                    custom: true,
                    quantity: 1
                }
            ];

            expect(GameCreationRequest.deckIsValid(deck)).toBe(true);
        });

        it('should accept a deck with only good roles', () => {
            const deck = [
                {
                    role: 'Villager',
                    team: ALIGNMENT.GOOD,
                    description: 'A simple villager',
                    custom: false,
                    quantity: 3
                }
            ];

            expect(GameCreationRequest.deckIsValid(deck)).toBe(true);
        });

        it('should accept a deck with only evil roles', () => {
            const deck = [
                {
                    role: 'Werewolf',
                    team: ALIGNMENT.EVIL,
                    description: 'A werewolf',
                    custom: false,
                    quantity: 2
                }
            ];

            expect(GameCreationRequest.deckIsValid(deck)).toBe(true);
        });

        it('should accept a deck with only independent roles', () => {
            const deck = [
                {
                    role: 'Tanner',
                    team: ALIGNMENT.INDEPENDENT,
                    description: 'An independent role',
                    custom: true,
                    quantity: 1
                }
            ];

            expect(GameCreationRequest.deckIsValid(deck)).toBe(true);
        });

        it('should accept optional revealed alignment and evil chat flags', () => {
            const deck = [
                {
                    role: 'Godfather',
                    team: ALIGNMENT.EVIL,
                    revealedAlignment: ALIGNMENT.GOOD,
                    evilChatAccess: true,
                    description: 'A deceptive evil role',
                    custom: false,
                    quantity: 1
                }
            ];

            expect(GameCreationRequest.deckIsValid(deck)).toBe(true);
        });

        it('should reject a deck with invalid team values', () => {
            const deck = [
                {
                    role: 'InvalidRole',
                    team: 'invalid',
                    description: 'Invalid team',
                    custom: true,
                    quantity: 1
                }
            ];

            expect(GameCreationRequest.deckIsValid(deck)).toBe(false);
        });

        it('should reject a deck with missing required fields', () => {
            const deck = [
                {
                    role: 'Villager',
                    // missing team
                    description: 'A simple villager',
                    custom: false,
                    quantity: 1
                }
            ];

            expect(GameCreationRequest.deckIsValid(deck)).toBe(false);
        });
    });

    describe('#settingsAreValid', () => {
        it('should accept valid enforcement settings', () => {
            expect(GameCreationRequest.settingsAreValid({
                enforcementEnabled: true,
                allowFirstDayVillageVote: true,
                allowNightKillVote: false,
                evilVoteHistoryLimit: 3,
                maxAlignmentCountReveals: 2
            })).toBe(true);
        });

        it('should reject invalid enforcement settings', () => {
            expect(GameCreationRequest.settingsAreValid({
                enforcementEnabled: true,
                allowFirstDayVillageVote: true,
                allowNightKillVote: false,
                evilVoteHistoryLimit: 0,
                maxAlignmentCountReveals: -1
            })).toBe(false);
        });
    });
});
