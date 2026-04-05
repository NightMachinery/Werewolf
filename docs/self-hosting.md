# Self-hosting

This repo now ships with a tmux-based self-host flow. It does **not** use Docker.

The entrypoint is:

```zsh
./self_host.zsh [setup|redeploy|start|stop] [public_url]
```

Default public URL:

```text
http://mafia.pinky.lilf.ir
```

## What it manages

- installs npm dependencies with `npm ci` when needed
- builds the client bundle with `npm run bundle`
- runs the Node app in a tmux session named `werewolf-app`
- adds/updates a bounded `werewolf self-host` block in `~/Caddyfile`
- reloads Caddy after validating the generated config
- reuses the machine's existing Redis server

## Requirements

- `tmux`
- `caddy`
- `redis-server` already running and reachable
- `redis-cli`
- `python3`
- `sha256sum`
- `ss`
- `nvm-load` available in a login zsh shell
- Node 24 available via `nvm`

This script uses zsh login shells for Node commands, specifically:

```zsh
nvm-load
nvm use 24
```

If you need npm to use a proxy, export the proxy environment variables **before** running the script. The script does not hardcode proxy settings, but npm commands inherit your current shell environment.

## Redis setup

This self-host flow assumes a shared local Redis is already running. By default it uses:

```text
redis://127.0.0.1:6379/14
```

That keeps this deployment out of Redis DB 0.

The deployment also uses a host-specific pub/sub channel derived from the configured URL, so multiple Redis-backed apps are less likely to interfere with each other.

## Commands

### `setup`

One-time or idempotent setup:

```zsh
./self_host.zsh setup
./self_host.zsh setup http://mafia.pinky.lilf.ir
./self_host.zsh setup https://example.com
```

What it does:

1. validates prerequisites
2. normalizes and persists the public URL in `.self_host/config.env`
3. generates and persists an `ADMIN_KEY` if one does not already exist
4. checks Redis connectivity
5. runs `npm ci` if `node_modules` is missing or `package-lock.json` changed
6. builds the production bundle
7. inserts or updates the repo block in `~/Caddyfile`
8. validates and reloads Caddy
9. starts the app in tmux

### `redeploy`

Redeploys the **current local working tree**:

```zsh
./self_host.zsh redeploy
```

This does **not** pull from git. It rebuilds and restarts whatever is currently in your local checkout.

### `start`

Starts or restarts the tmux-managed app using the persisted config:

```zsh
./self_host.zsh start
```

### `stop`

Stops the tmux-managed app:

```zsh
./self_host.zsh stop
```

## Persisted local config

Local self-host state is stored under:

```text
.self_host/
```

That directory is ignored by git.

The main config file is:

```text
.self_host/config.env
```

It stores:

- `PUBLIC_BASE_URL`
- `APP_PORT` (`3080` by default)
- `NODE_VERSION` (`24`)
- `REDIS_URL`
- `REDIS_CHANNEL_ACTIVE_GAME_STREAM`
- `ADMIN_KEY`

## Port and Caddy behavior

- internal app port: `3080`
- public URL: whatever you passed to `setup`, defaulting to `http://mafia.pinky.lilf.ir`
- Caddy block location: `~/Caddyfile`

The script updates only the block between:

```text
# BEGIN werewolf self-host
# END werewolf self-host
```

## Logs and debugging

App logs are appended to:

```text
.self_host/logs/app.log
```

Useful commands:

```zsh
tmux ls
tmux attach -t werewolf-app
tail -f .self_host/logs/app.log
```

## Admin API

In production mode, `/api/admin` requires `ADMIN_KEY`.

The key is stored in `.self_host/config.env`. The server checks the base64-decoded authorization token against that value.

Example pattern:

```text
Authorization: Bearer <base64(admin_key)>
```

## Migrating from old Docker-based local usage

This repo still contains old Docker-era files for historical development workflows, but the supported self-host flow here is tmux + Caddy + Redis.

If you previously used this repo with Docker, stop that old stack manually before switching over. For example:

```zsh
docker compose down
```

Then use:

```zsh
./self_host.zsh setup
```
