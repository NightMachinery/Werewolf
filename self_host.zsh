#!/usr/bin/env zsh
emulate -L zsh -o errexit -o nounset -o pipefail

readonly ROOT_DIR="${0:A:h}"
readonly CONFIG_DIR="$ROOT_DIR/.self_host"
readonly CONFIG_FILE="$CONFIG_DIR/config.env"
readonly RUN_APP_SCRIPT="$CONFIG_DIR/run_app.zsh"
readonly PACKAGE_LOCK_FILE="$ROOT_DIR/package-lock.json"
readonly LOCK_CHECKSUM_FILE="$CONFIG_DIR/package-lock.sha256"
readonly LOG_DIR="$CONFIG_DIR/logs"
readonly APP_LOG="$LOG_DIR/app.log"
readonly DEFAULT_PUBLIC_BASE_URL='http://mafia.pinky.lilf.ir'
readonly DEFAULT_APP_PORT='3080'
readonly DEFAULT_NODE_VERSION='24'
readonly DEFAULT_REDIS_URL='redis://127.0.0.1:6379/14'
readonly APP_SESSION_NAME='werewolf-app'
readonly CADDYFILE="$HOME/Caddyfile"
readonly CADDY_BEGIN='# BEGIN werewolf self-host'
readonly CADDY_END='# END werewolf self-host'

usage() {
    cat <<USAGE
Usage: ./self_host.zsh [setup|redeploy|start|stop] [public_url]

setup     Install deps if needed, build, update ~/Caddyfile, reload Caddy, and start the app.
redeploy  Rebuild and restart the app using the latest local working tree changes.
start     Start or restart the tmux-managed app using persisted config.
stop      Stop the tmux-managed app.

public_url must be a full origin such as http://mafia.pinky.lilf.ir or https://example.com.
Default public_url: $DEFAULT_PUBLIC_BASE_URL
USAGE
}

die() {
    print -u2 -- "Error: $*"
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

tmuxnew () {
	tmux kill-session -t "$1" &> /dev/null || true
	tmux new -d -s "$@"
}

normalize_public_base_url() {
    local input_url="$1"
    python3 - "$input_url" <<'PY'
import sys
from urllib.parse import urlparse

raw = sys.argv[1].strip()
parsed = urlparse(raw)
if parsed.scheme not in {'http', 'https'}:
    raise SystemExit('public_url must begin with http:// or https://')
if not parsed.netloc:
    raise SystemExit('public_url must include a hostname')
if parsed.path not in ('', '/'):
    raise SystemExit('public_url must not include a path')
if parsed.params or parsed.query or parsed.fragment:
    raise SystemExit('public_url must not include params, query, or fragment')
print(f'{parsed.scheme}://{parsed.netloc}')
PY
}

derive_host_slug() {
    local input_url="$1"
    python3 - "$input_url" <<'PY'
import re
import sys
from urllib.parse import urlparse

host = urlparse(sys.argv[1]).netloc.lower()
print(re.sub(r'[^a-z0-9]+', '-', host).strip('-'))
PY
}

generate_admin_key() {
    python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
}

ensure_prerequisites() {
    require_cmd tmux
    require_cmd caddy
    require_cmd redis-cli
    require_cmd python3
    require_cmd sha256sum
    require_cmd ss
    zsh -lc 'type nvm-load >/dev/null 2>&1' || die 'nvm-load is required in zsh login shells'
}

ensure_dirs() {
    mkdir -p "$CONFIG_DIR" "$LOG_DIR"
}

load_config() {
    [[ -f "$CONFIG_FILE" ]] || die "Missing config file: $CONFIG_FILE. Run ./self_host.zsh setup first."
    source "$CONFIG_FILE"
}

write_config() {
    local public_base_url="$1"
    local admin_key="$2"
    local redis_channel="$3"

    cat > "$CONFIG_FILE" <<EOF_CONFIG
PUBLIC_BASE_URL='$public_base_url'
APP_PORT='$DEFAULT_APP_PORT'
NODE_VERSION='$DEFAULT_NODE_VERSION'
REDIS_URL='$DEFAULT_REDIS_URL'
REDIS_CHANNEL_ACTIVE_GAME_STREAM='$redis_channel'
ADMIN_KEY='$admin_key'
EOF_CONFIG
}

write_run_app_script() {
    cat > "$RUN_APP_SCRIPT" <<EOF_RUN
#!/usr/bin/env zsh
emulate -L zsh -o errexit -o nounset -o pipefail

readonly ROOT_DIR='${ROOT_DIR}'
readonly CONFIG_FILE='${CONFIG_FILE}'
readonly LOG_DIR='${LOG_DIR}'
readonly APP_LOG='${APP_LOG}'

source "\$CONFIG_FILE"
mkdir -p "\$LOG_DIR"
cd "\$ROOT_DIR"

nvm-load >/dev/null 2>&1
nvm use "\$NODE_VERSION" >/dev/null

export NODE_ENV=production
export PORT="\$APP_PORT"
export PUBLIC_BASE_URL="\$PUBLIC_BASE_URL"
export REDIS_URL="\$REDIS_URL"
export REDIS_CHANNEL_ACTIVE_GAME_STREAM="\$REDIS_CHANNEL_ACTIVE_GAME_STREAM"
export ADMIN_KEY="\$ADMIN_KEY"

node index.js -- loglevel=debug 2>&1 | tee -a "\$APP_LOG"
EOF_RUN
    chmod +x "$RUN_APP_SCRIPT"
}

persist_config() {
    local requested_url="$1"
    local normalized_url host_slug redis_channel admin_key

    ensure_dirs

    if [[ -f "$CONFIG_FILE" ]]; then
        source "$CONFIG_FILE"
        admin_key="${ADMIN_KEY:-}"
    else
        admin_key=''
    fi

    normalized_url="$(normalize_public_base_url "$requested_url")" || die 'Invalid public URL'
    host_slug="$(derive_host_slug "$normalized_url")"
    redis_channel="werewolf:${host_slug}:active_game_stream"
    [[ -n "$admin_key" ]] || admin_key="$(generate_admin_key)"

    write_config "$normalized_url" "$admin_key" "$redis_channel"
    write_run_app_script
}

current_lock_checksum() {
    sha256sum "$PACKAGE_LOCK_FILE" | awk '{print $1}'
}

run_in_node_shell() {
    local command_string="$1"
    zsh -lc "cd ${(q)ROOT_DIR} && nvm-load >/dev/null 2>&1 && nvm use ${DEFAULT_NODE_VERSION} >/dev/null && ${command_string}"
}

install_dependencies_if_needed() {
    local new_checksum existing_checksum=''
    new_checksum="$(current_lock_checksum)"
    if [[ -f "$LOCK_CHECKSUM_FILE" ]]; then
        existing_checksum="$(<"$LOCK_CHECKSUM_FILE")"
    fi

    if [[ ! -d "$ROOT_DIR/node_modules" || "$new_checksum" != "$existing_checksum" ]]; then
        print -- 'Installing npm dependencies with npm ci...'
        run_in_node_shell 'npm ci'
        print -- "$new_checksum" > "$LOCK_CHECKSUM_FILE"
    else
        print -- 'Dependencies already match package-lock.json; skipping npm ci.'
    fi
}

build_client() {
    print -- 'Building client bundle...'
    run_in_node_shell 'npm run bundle'
}

ensure_redis_available() {
    load_config
    local ping_response
    ping_response="$(redis-cli -u "$REDIS_URL" ping 2>/dev/null || true)"
    [[ "$ping_response" == 'PONG' ]] || die "Redis is not reachable at $REDIS_URL"
}

ensure_app_port_available() {
    load_config
    if ss -ltn "( sport = :${APP_PORT} )" | tail -n +2 | grep -q LISTEN; then
        die "Port ${APP_PORT} is already in use. Stop the conflicting process or change the script defaults."
    fi
}

render_caddy_block() {
    load_config
    cat <<EOF_BLOCK
$CADDY_BEGIN
$PUBLIC_BASE_URL {
    encode zstd gzip
    reverse_proxy 127.0.0.1:$APP_PORT
}
$CADDY_END
EOF_BLOCK
}

update_caddyfile() {
    [[ -f "$CADDYFILE" ]] || touch "$CADDYFILE"
    local temp_config="$CONFIG_DIR/Caddyfile.candidate"
    local block_contents
    block_contents="$(render_caddy_block)"

    TARGET_CADDYFILE="$CADDYFILE" BLOCK_BEGIN="$CADDY_BEGIN" BLOCK_END="$CADDY_END" BLOCK_CONTENTS="$block_contents" OUTPUT_PATH="$temp_config" python3 - <<'PY'
import os
import pathlib
import re

caddyfile = pathlib.Path(os.environ['TARGET_CADDYFILE'])
text = caddyfile.read_text() if caddyfile.exists() else ''
begin = os.environ['BLOCK_BEGIN']
end = os.environ['BLOCK_END']
block = os.environ['BLOCK_CONTENTS'].rstrip() + '\n'
pattern = re.compile(re.escape(begin) + r'.*?' + re.escape(end) + r'\n?', re.S)
if pattern.search(text):
    updated = pattern.sub(block, text)
else:
    updated = text.rstrip() + ('\n\n' if text.strip() else '') + block
pathlib.Path(os.environ['OUTPUT_PATH']).write_text(updated)
PY

    caddy validate --config "$temp_config" >/dev/null
    cp "$temp_config" "$CADDYFILE"
    caddy reload --config "$CADDYFILE" >/dev/null
}

start_app() {
    ensure_redis_available
    stop_app
    ensure_app_port_available
    load_config
    print -- "Starting tmux session: $APP_SESSION_NAME"
    tmuxnew "$APP_SESSION_NAME" zsh "$RUN_APP_SCRIPT"
}

stop_app() {
    if tmux has-session -t "$APP_SESSION_NAME" 2>/dev/null; then
        tmux kill-session -t "$APP_SESSION_NAME"
        print -- "Stopped tmux session: $APP_SESSION_NAME"
    fi
}

resolve_setup_url() {
    local supplied_url="${1:-}"
    if [[ -n "$supplied_url" ]]; then
        print -- "$supplied_url"
    elif [[ -f "$CONFIG_FILE" ]]; then
        source "$CONFIG_FILE"
        print -- "${PUBLIC_BASE_URL:-$DEFAULT_PUBLIC_BASE_URL}"
    else
        print -- "$DEFAULT_PUBLIC_BASE_URL"
    fi
}

main() {
    local command="${1:-}"
    local supplied_url="${2:-}"

    [[ -n "$command" ]] || { usage; exit 1; }
    case "$command" in
        setup)
            ensure_prerequisites
            persist_config "$(resolve_setup_url "$supplied_url")"
            ensure_redis_available
            install_dependencies_if_needed
            build_client
            update_caddyfile
            start_app
            print -- 'Setup complete.'
            ;;
        redeploy)
            ensure_prerequisites
            load_config
            ensure_redis_available
            install_dependencies_if_needed
            build_client
            update_caddyfile
            start_app
            print -- 'Redeploy complete.'
            ;;
        start)
            ensure_prerequisites
            load_config
            start_app
            print -- 'Start complete.'
            ;;
        stop)
            ensure_prerequisites
            stop_app
            print -- 'Stop complete.'
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
