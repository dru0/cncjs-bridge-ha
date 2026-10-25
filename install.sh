#!/usr/bin/env bash
# Instaluje/migruje tylko CNCjs HA WS2812 bridge. Nie modyfikuje CNCjs ani HA.
set -Eeuo pipefail

REPO_URL='https://github.com/dru0/cncjs-bridge-ha.git'
APP_DIR='/opt/cncjs-bridge-ha'
SERVICE='cncjs-ha-bridge.service'
SERVICE_FILE="/etc/systemd/system/$SERVICE"
SERVICE_USER='cncjsbridge'
ENV_FILE="$APP_DIR/bridge.env"
MODE="${1:---install}"

say() { printf '[bridge] %s\n' "$*"; }
fail() { printf '[bridge] BŁĄD: %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || fail 'Uruchom przez: sudo bash install.sh'
[[ "$MODE" == '--install' || "$MODE" == '--update' ]] || fail 'Użycie: install.sh [--install|--update]'
command -v systemctl >/dev/null || fail 'Wymagany jest systemd.'

# Instaluj tylko brakujące zależności. Nie wymieniaj działającego Node.js.
packages=()
command -v git >/dev/null || packages+=(git)
[[ -x /usr/bin/node ]] || packages+=(nodejs)
command -v npm >/dev/null || packages+=(npm)
command -v python3 >/dev/null || packages+=(python3)
python3 -c 'import spidev' >/dev/null 2>&1 || packages+=(python3-spidev)
if (( ${#packages[@]} > 0 )); then
  say "Instalowanie brakujących pakietów: ${packages[*]}"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  [[ ! -e "$APP_DIR" ]] || fail "$APP_DIR istnieje, ale nie jest repozytorium Git. Zrób kopię i rozwiąż konflikt ręcznie."
  say "Pobieranie kodu do $APP_DIR"
  git clone --depth=1 "$REPO_URL" "$APP_DIR"
elif [[ "$MODE" == '--update' ]]; then
  [[ -z "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]] || fail 'W /opt są lokalne zmiany śledzonych plików. Nie nadpisuję ich.'
  say 'Pobieranie aktualizacji WYŁĄCZNIE repozytorium bridge...'
  git -C "$APP_DIR" fetch --quiet origin main
  git -C "$APP_DIR" merge --ff-only origin/main
fi

# Własne konto bez logowania; połączenie z CNCjs odbywa się przez Socket.IO.
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  say "Utworzono użytkownika systemowego $SERVICE_USER"
fi
for group in spi dialout; do
  getent group "$group" >/dev/null || groupadd --system "$group"
  usermod -aG "$group" "$SERVICE_USER"
done

# Zachowaj dotychczasową konfigurację; priorytet ma już istniejąca w /opt.
if [[ ! -f "$ENV_FILE" ]]; then
  legacy_env="$(systemctl cat "$SERVICE" 2>/dev/null | sed -nE 's/^[[:space:]]*EnvironmentFile=-?([^[:space:]]+).*/\1/p' | tail -n1 || true)"
  source_env=''
  for candidate in "$legacy_env" /home/pi/cncjs-ha-ws2812/bridge.env /home/pi/cncjs-bridge-ha/bridge.env; do
    if [[ -n "$candidate" && -f "$candidate" && "$candidate" != "$ENV_FILE" ]]; then
      source_env="$candidate"
      break
    fi
  done
  if [[ -n "$source_env" ]]; then
    install -o root -g "$SERVICE_USER" -m 0640 "$source_env" "$ENV_FILE"
    say "Przeniesiono kopię konfiguracji z $source_env (oryginał pozostawiony)."
  else
    install -o root -g "$SERVICE_USER" -m 0640 "$APP_DIR/bridge.env.example" "$ENV_FILE"
    say "Utworzono $ENV_FILE. Ustaw HA_URL i HA_TOKEN, następnie uruchom instalator ponownie."
  fi
fi
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"
chmod 0755 "$APP_DIR"

# Nie uruchamiaj nowej usługi bez prawidłowego tokenu HA.
if ! grep -Eq '^HA_URL=.+$' "$ENV_FILE" || ! grep -Eq '^HA_TOKEN=.+$' "$ENV_FILE" || grep -q 'PUT_YOUR_LONG_LIVED_ACCESS_TOKEN_HERE' "$ENV_FILE"; then
  say "Usługa pozostaje bez zmian. Najpierw uzupełnij: sudo nano $ENV_FILE"
  exit 0
fi

if [[ ! -e /dev/spidev0.0 ]]; then
  say 'UWAGA: brak /dev/spidev0.0. Włącz SPI w raspi-config i uruchom ponownie Raspberry Pi, aby działały WS2812.'
fi
if [[ ! -e /dev/ttyUSB0 ]]; then
  say 'UWAGA: brak /dev/ttyUSB0. Sprawdź port USB albo ustaw CNC_PORT w bridge.env.'
fi

# Nie restartuj mostka automatycznie podczas pracy lasera.
if systemctl is-active --quiet "$SERVICE" && [[ "${BRIDGE_ASSUME_IDLE:-0}" != '1' ]]; then
  if [[ ! -t 0 ]]; then
    fail 'Usługa jest aktywna. Uruchom interaktywnie, kiedy laser nie pracuje.'
  fi
  read -r -p 'Potwierdź, że laser NIE pracuje i można zrestartować tylko bridge [tak/N]: ' answer
  [[ "$answer" == 'tak' ]] || fail 'Anulowano bez restartowania usługi.'
fi

say 'Instalacja zależności JS (tylko bridge)...'
npm --prefix "$APP_DIR" ci --omit=dev --ignore-scripts

# Oprogramowanie w /opt jest tylko do odczytu dla usługi.
chown root:root "$APP_DIR" "$APP_DIR/bridge.js" "$APP_DIR/led_spi.py" "$APP_DIR/package.json" "$APP_DIR/package-lock.json"
chmod 0644 "$APP_DIR/bridge.js" "$APP_DIR/led_spi.py"
if [[ -f "$SERVICE_FILE" ]] && ! cmp -s "$APP_DIR/$SERVICE" "$SERVICE_FILE"; then
  cp -p "$SERVICE_FILE" "$SERVICE_FILE.backup-$(date +%Y%m%d-%H%M%S)"
  say 'Zachowano kopię starej jednostki systemd.'
fi
install -o root -g root -m 0644 "$APP_DIR/$SERVICE" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
if systemctl is-active --quiet "$SERVICE"; then
  say 'Gotowe: aktywna usługa cncjs-ha-bridge.'
  say "Pliki: $APP_DIR | użytkownik: $SERVICE_USER | grupy: spi,dialout"
  say "Status: systemctl status $SERVICE --no-pager"
else
  journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
  fail 'Mostek nie uruchomił się prawidłowo. CNCjs i integracja HA nie zostały zmienione.'
fi
