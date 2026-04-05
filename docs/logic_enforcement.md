# Logic enforcement

This document describes what the code currently automates or enforces, and what is still left to the moderator.

## Automated / enforced by code

### Room creation and persistence

- New games get a random **4-character** access code.
- The code generator retries to avoid collisions.
- Active games are stored in Redis.
- Games expire after **86400 seconds** of inactivity.
- If a timer still exists locally after the Redis game disappears, the timer is stopped and discarded.

### Create-game validation

The server validates game creation requests before creating a room.

It enforces:

- required request shape
- `moderatorName` must be present and at most **30** characters
- role names must be non-empty and at most **50** characters
- role descriptions must be non-empty and at most **1000** characters
- alignment must be `good`, `evil`, or `independent`
- role quantity must be between **0** and **50**
- timer values must be between **1 minute** and **5 hours**

### Joining and lobby state

- duplicate names are rejected
- the moderator slot is assigned first if the current moderator has not joined yet
- once a game is already full/startable, additional joins become spectators automatically
- joins during an in-progress game also become spectators
- spectators are capped at **100**
- the lobby tracks `isStartable`, meaning player count must match deck size before the game can start

### Start-game behavior

When the moderator starts a startable game:

- the game status changes to `in progress`
- the deck is expanded by quantity and shuffled
- roles are dealt randomly to players, bots, and temporary moderators
- player role, alignment, description, and custom-role metadata are assigned
- if a timer exists, it is initialized immediately and starts in a **paused** state

### Information hiding / role visibility

The server curates game state by user type.

- In the lobby, people do **not** receive their role yet.
- Dedicated moderators receive full player-role information.
- Players, temporary moderators, killed players, and spectators only receive hidden-role views unless a role has been revealed.
- `endGame` reveals everybody to everyone.

### Name changes

- duplicate names are rejected
- empty names are rejected
- names longer than **40** characters are rejected

### Kill and reveal are separate actions

- `killPlayer` marks the target out of the game and sets `killed = true`
- `revealPlayer` only marks the target revealed
- revealing does **not** automatically kill a player
- killing does **not** automatically reveal a role

### Moderator automation

There are two moderator flows:

- **Dedicated moderator**: not dealt into the game, can manually transfer moderator powers to a killed player or spectator.
- **Temporary moderator**: dealt into the game and does **not** see hidden role info.

Temporary moderator automation:

- when a temporary moderator uses the kill action, the client offers:
  - **Just Kill**
  - **Kill + Make Dedicated Mod**
  - **Cancel**
- choosing **Just Kill** kills the target and keeps the temp moderator in place
- choosing **Kill + Make Dedicated Mod** runs `assignDedicatedMod`
- the selected target becomes the new dedicated moderator
- that new moderator is marked `out = true` and `killed = true`
- if the temporary moderator picked someone else, the former temp moderator becomes a normal player again
- if the temporary moderator picked themself, they become the killed dedicated moderator themself

Manual dedicated moderator transfer:

- can transfer only to a **killed player** or **spectator**
- cannot transfer to an active living player
- the previous moderator becomes a spectator if they had no role, or a killed player if they did
- the original room creator can always override moderator assignment:
  - living non-bot participants can be made **temporary moderators**
  - killed players and spectators can be made **dedicated moderators**
  - the current moderator can be demoted, which returns moderator status to the creator

### Timer automation

If a game has a timer:

- the server owns the authoritative timer state
- play/pause updates are synced through Redis
- current moderators can reset the timer back to full duration, and reset immediately starts it running again
- late-joining/reconnecting clients can ask for current remaining time
- if the instance that receives the request does not own the timer thread, it asks the owning instance to source the timer data
- when the timer expires, the server emits `endTimer`, sets remaining time to `0`, and marks the timer as ended

### End game / reset to lobby

`endGame`:

- sets game status to `ended`
- stops any running timer
- reveals all players

`restartGame` / reset to lobby:

- stops any running timer
- clears revealed/killed flags
- clears dealt role/alignment/custom-role data
- restores killed players to player state
- restores killed bots to bot state
- if the current moderator had an in-game role, they become a temporary moderator again for the next round
- sets game status back to `lobby`

### Multi-instance synchronization

The app is built to run across multiple Node instances sharing Redis.

The code currently syncs these actions through Redis pub/sub:

- start game
- kill / reveal
- transfer moderator
- end / restart game
- join / spectator events
- timer pause / resume / end
- role and timer edits
- leave / kick events
- state refresh requests

## Left to the moderator / not enforced

The app intentionally does **not** run the full social game for you.

It does **not** currently enforce:

- day/night progression
- turn order
- win conditions
- faction victory checks
- role abilities
- night action resolution
- voting rules
- elimination rules beyond the moderator pressing kill/reveal
- auto-ending the game when the timer expires
- role-balance validation beyond basic schema/value checks

## Practical summary

The code is strongest at:

- room lifecycle
- validation
- dealing cards
- hiding/revealing information correctly
- moderator delegation rules
- timer syncing
- resetting state safely

The code deliberately leaves the actual Werewolf/Mafia moderation decisions to humans.
