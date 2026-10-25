#!/usr/bin/env bash
# Aktualizuje wyłącznie bridge z GitHuba; pozostawia konfigurację i CNCjs.
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Uruchom: sudo bash /opt/cncjs-bridge-ha/update.sh' >&2; exit 1; }
[[ -d /opt/cncjs-bridge-ha/.git ]] || { echo 'Najpierw zainstaluj bridge przez install.sh.' >&2; exit 1; }
exec bash /opt/cncjs-bridge-ha/install.sh --update
