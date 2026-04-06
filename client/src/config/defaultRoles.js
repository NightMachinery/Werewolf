export const defaultRoles = [
    {
        role: 'Villager',
        team: 'good',
        revealedAlignment: 'good',
        evilChatAccess: false,
        description: 'During the day, find the Werewolves and kill them.'
    },
    {
        role: 'Werewolf',
        team: 'evil',
        revealedAlignment: 'evil',
        evilChatAccess: true,
        description: 'During the night, choose a player to eliminate.'
    },
    {
        role: 'Dream Wolf',
        team: 'evil',
        revealedAlignment: 'evil',
        evilChatAccess: true,
        description: 'You are a Werewolf, but you don\'t wake up with the other Werewolves until one of them dies.'
    },
    {
        role: 'Changeling',
        team: 'evil',
        revealedAlignment: 'evil',
        evilChatAccess: true,
        description: 'You sleep like a Dream Wolf until a Werewolf dies. When that happens, you become a Werewolf and only then learn your new role.'
    },
    {
        role: 'Sorceress',
        team: 'evil',
        revealedAlignment: 'evil',
        evilChatAccess: true,
        description: 'Each night, learn if a chosen person is the Seer.'
    },
    {
        role: 'Godfather',
        team: 'evil',
        revealedAlignment: 'good',
        evilChatAccess: true,
        description: 'You are an evil Villager, and you know who the other evil players are at night. You win if the evil team wins, and your vote breaks ties in the evil night kill.'
    },
    {
        role: 'Blind Minion',
        team: 'evil',
        revealedAlignment: 'evil',
        evilChatAccess: false,
        description: 'You are an evil villager, but you do NOT know who the Werewolves are. You win if the Werewolves win.'
    },
    {
        role: 'Seer',
        team: 'good',
        revealedAlignment: 'good',
        evilChatAccess: false,
        description: 'Each night, learn a chosen person\'s revealed alignment.'
    },
    {
        role: 'Super Seer',
        team: 'good',
        revealedAlignment: 'good',
        evilChatAccess: false,
        description: 'Each night, learn a chosen person\'s revealed alignment. If you inspect the same person twice, you learn their true alignment instead.'
    },
    {
        role: 'Doctor',
        team: 'good',
        revealedAlignment: 'good',
        evilChatAccess: false,
        description: 'Each night, choose a player to protect from the Werewolves. This can be yourself. If the Werewolves ' +
            'target this person, they still survive to the following day.'
    },
    {
        role: 'Witch',
        team: 'good',
        revealedAlignment: 'good',
        evilChatAccess: false,
        description: 'You have two potions. One saves a player from the Werewolves, and one kills a player. You may use each of them once per game during the night.'
    },
    {
        role: 'Ironman',
        team: 'good',
        revealedAlignment: 'good',
        evilChatAccess: false,
        description: 'The first time you would be killed for any reason, you survive instead.'
    },
    {
        role: 'Parity Hunter',
        team: 'good',
        revealedAlignment: 'good',
        evilChatAccess: false,
        description: 'If you and a Werewolf are the only two players remaining, the Village wins.'
    },
    {
        role: 'Brutal Hunter',
        team: 'good',
        revealedAlignment: 'good',
        evilChatAccess: false,
        description: 'When you are eliminated, choose another player to be eliminated with you.'
    }
];
