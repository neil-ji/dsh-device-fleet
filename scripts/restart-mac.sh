#!/bin/bash
# Relaunch the DSH desktop app so a plugin *shell* change (lib/server.js,
# lib/tools.js, index.js) takes effect. Logic-only changes never need this —
# lib/worker-impl.js and lib/controller-impl.js hot-swap on the next request.
#
# The relaunch is handed to launchd so it survives this process tree being
# torn down by the app quitting; a plain `nohup ... &` child is reaped with
# its parent and the app never comes back.
set -euo pipefail
APP_NAME="DeepSeek Harness"
LABEL="local.dsh.relaunch.$$"
launchctl submit -l "$LABEL" -- /bin/bash -c "sleep 3; open -a '$APP_NAME'"
osascript -e "quit app \"$APP_NAME\""
