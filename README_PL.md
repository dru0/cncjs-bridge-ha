# CNCjs + Home Assistant + 3 × WS2812 na GPIO10 (SPI)

## Ważne ograniczenia
To rozwiązanie jest **wersją do przetestowania** z CNCjs (Socket.IO 2.x). Zdarzenia i pola `sender:status` mogą się różnić między wersjami CNCjs. Nie używaj automatyki jako jedynego zabezpieczenia przeciwpożarowego. **Czujnik finished oznacza zakończenie raportowane przez CNCjs, a nie niezależne potwierdzenie fizycznego wyłączenia lasera.** Zatrzymanie ręczne może wymagać dodatkowego dopasowania po analizie logów. Zdarzenia utraty USB i błędów są rozróżniane. Mostek nie wysyła G-code do lasera.

## Instalacja na Raspberry Pi OS Trixie (64-bit)

1. Skopiuj cały folder do `/home/pi/cncjs-ha-ws2812`.
2. Aktywuj SPI: `sudo raspi-config` → Interface Options → SPI → Enable, a następnie `sudo reboot`.
3. Sprawdź `ls /dev/spidev0.0`.
4. Zainstaluj `sudo apt update && sudo apt install -y python3-spidev`.
5. Nadaj dostęp do SPI: `sudo usermod -aG spi pi` (jeśli grupa `spi` istnieje; sprawdź `getent group spi`). Wyloguj i zaloguj się ponownie. Jeśli brak grupy, dodaj regułę udev albo skonfiguruj odpowiednie uprawnienia; nie uruchamiaj całego mostka jako root bez potrzeby.
6. Test LED: `python3 /home/pi/cncjs-ha-ws2812/led_spi.py running`, a następnie `python3 /home/pi/cncjs-ha-ws2812/led_spi.py off`.
7. W folderze mostka wykonaj `npm install --omit=dev`.
8. Skopiuj `bridge.env.example` do `bridge.env`. Ustaw `HA_URL`, `HA_TOKEN` (długoterminowy token z profilu HA) i opcjonalnie `CNC_TOKEN` (token CNCjs, jeżeli włączone uwierzytelnianie). Zabezpiecz `chmod 600 bridge.env`.
9. Test ręczny: `set -a; . ./bridge.env; set +a; node bridge.js`. W CNCjs rozpocznij krótki test **bez włączonego lasera**, sprawdź komunikaty i `sensor.cncjs_status` w HA.
10. Skopiuj usługę: `sudo cp cncjs-ha-bridge.service /etc/systemd/system/`, `sudo systemctl daemon-reload`, `sudo systemctl enable --now cncjs-ha-bridge`.
11. Logi: `journalctl -u cncjs-ha-bridge -f`.
12. W Home Assistant wklej `home_assistant.yaml` jako **nową automatyzację**, a poprzednią automatyzację OctoPrint wyłącz, aby nie dublować sterowania.

## LED
GPIO10 = fizyczny pin 19 (SPI MOSI). Zasilaj WS2812 stabilnym 5 V, połącz masy, najlepiej użyj konwertera poziomów 3,3 V → 5 V. Nie zasilaj trzech diod bezpośrednio z GPIO10. Żadne inne urządzenie nie powinno korzystać z SPI0 podczas sterowania LED. Biblioteka `spidev` generuje 800 kHz przez SPI 2,4 MHz (3 bity SPI na 1 bit WS2812).

Kolory: idle biały, running zielony, paused żółty, finished niebieski, error czerwony. Po zakończeniu zadania LED gasną po 10 minutach; przy błędzie świecą czerwono. Jeżeli mostek lub RPi utraci zasilanie, LED i czujnik nie są niezależnym zabezpieczeniem.

## Diagnostyka
Jeśli HA nie aktualizuje stanu, sprawdź `HA_URL`, `HA_TOKEN`, log `journalctl -u cncjs-ha-bridge -f` i ewentualny `CNC_TOKEN`. Jeśli `running` jest widoczne, a `finished` nie, prześlij logi `workflow` i informacje o wersji CNCjs; należy dopasować warunek zakończenia do Twojej wersji. Nie uruchamiaj OctoPrint i CNCjs jednocześnie na tym samym porcie USB.
