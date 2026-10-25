# CNCjs → Home Assistant + WS2812 (Longer Ray5)

Ten projekt uruchamia **tylko mostek** `bridge.js` i 3 diody WS2812 na SPI0 (GPIO10).
Nie instaluje ani nie aktualizuje samego CNCjs i nie modyfikuje osobnej integracji Home Assistant.

> **Bezpieczeństwo:** mostek jest narzędziem monitorującym. Stan w HA nie potwierdza fizycznego wyłączenia lasera i nie zastępuje nadzoru, wentylacji ani wyłącznika awaryjnego. Instalację/aktualizację wykonuj wyłącznie wtedy, gdy laser nie pracuje.

## Instalacja i automatyczna migracja starego bridge

Na Raspberry Pi (Debian 13 / Raspberry Pi OS) z Node.js i systemd:

```bash
cd ~/cncjs-bridge-ha
git pull --ff-only
sudo bash install.sh
```

Jeżeli nie masz jeszcze kopii repozytorium:

```bash
git clone https://github.com/dru0/cncjs-bridge-ha.git ~/cncjs-bridge-ha
cd ~/cncjs-bridge-ha
sudo bash install.sh
```

Instalator:

- pobiera kod do `/opt/cncjs-bridge-ha` (tam jest osobne repozytorium Git);
- tworzy **systemowego** użytkownika `cncjsbridge` bez możliwości logowania, dodaje go do `spi` i `dialout`;
- instaluje brakujące pakiety i zależności npm bridge;
- przy pierwszej instalacji szuka istniejącego `bridge.env` w usłudze systemd oraz w `/home/pi/cncjs-ha-ws2812/` lub `/home/pi/cncjs-bridge-ha/` i kopiuje go bez ujawniania tokenów;
- nadaje `bridge.env` uprawnienia `root:cncjsbridge`, tryb `0640`; kod w `/opt` jest zarządzany przez roota;
- robi kopię starej jednostki systemd, podmienia **tylko** `cncjs-ha-bridge.service`, włącza ją i restartuje;
- **nie usuwa** starego katalogu, nie zmienia `cncjs.service` ani plików/automatyzacji Home Assistant.

Jeżeli nie znaleziono tokenu, instalator zapisze szablon i **nie zrestartuje** działającej usługi. Uzupełnij `sudo nano /opt/cncjs-bridge-ha/bridge.env`, a potem ponownie `sudo bash /opt/cncjs-bridge-ha/install.sh`.

## Aktualizacja wyłącznie bridge

```bash
sudo bash /opt/cncjs-bridge-ha/update.sh
```

Skrypt wykonuje `git fetch` + `git merge --ff-only` **tylko** w `/opt/cncjs-bridge-ha`, sprawdza zależności i restartuje **tylko** `cncjs-ha-bridge.service`. Plik `bridge.env` jest ignorowany przez Git i zachowywany. Jeżeli usługa już działa, skrypt poprosi o potwierdzenie, że laser jest bezczynny. Nie używaj `sudo git pull` w starym katalogu domowym do aktualizowania uruchomionego bridge.

## Sprawdzenie działania

```bash
systemctl status cncjs-ha-bridge.service --no-pager
journalctl -u cncjs-ha-bridge.service -n 60 --no-pager
id cncjsbridge
ls -l /dev/spidev0.0 /dev/ttyUSB0
```

Konfiguracja jest w `/opt/cncjs-bridge-ha/bridge.env`. Używane zmienne: `CNC_URL`, `CNC_PORT`, `HA_URL` i `HA_TOKEN`. Token CNCjs jest pobierany automatycznie przez `bridge.js` z `/api/signin` (w tym wydaniu zmienna `CNC_TOKEN` nie jest odczytywana). Przykładowy port: `/dev/ttyUSB0`; urządzenie może mieć inną nazwę.

Aby uruchomić LED, włącz SPI przez `sudo raspi-config` → Interface Options → SPI. Jeżeli po aktywacji nie ma `/dev/spidev0.0`, uruchom Raspberry Pi ponownie. Test jako użytkownik usługi:

```bash
sudo -u cncjsbridge python3 /opt/cncjs-bridge-ha/led_spi.py running
sudo -u cncjsbridge python3 /opt/cncjs-bridge-ha/led_spi.py off
```

GPIO10 to pin 19 (SPI MOSI). Pasek WS2812 zasilaj z odpowiedniego 5 V, łącz wspólne masy i najlepiej użyj konwertera poziomów 3,3→5 V. GPIO10 nie służy do zasilania diod.

## Przywrócenie poprzedniego uruchomienia

Instalator zostawia poprzednie pliki w katalogu domowym i zapisuje kopię starej jednostki w `/etc/systemd/system/cncjs-ha-bridge.service.backup-...`. W razie problemu można ręcznie przywrócić poprzednią jednostkę, wykonać `sudo systemctl daemon-reload` i `sudo systemctl restart cncjs-ha-bridge.service`. Nie uruchamiaj dwóch mostków naraz. Ustawienia automatyzacji wentylatorów w HA pozostają poza zakresem instalatora.
