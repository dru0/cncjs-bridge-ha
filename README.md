
** this is only bridge connector with status in HA **
no HA app integration **

Integration of the Longer Ray5 laser engraver with Home Assistant through CNCjs running on a Raspberry Pi.
This project provides real-time laser status monitoring, Home Assistant integration and visual machine-state indication using addressable WS2812 LEDs.
Key features
CNCjs workflow and GRBL controller status monitoring.
Detection of idle, running, paused, stopped, finished and error states.
Home Assistant status updates through the REST API.
Color-coded machine status using WS2812 LEDs.
Automatic CNCjs authentication token retrieval.
Reconnection handling after communication interruptions.
Support for Home Assistant automations, such as laser workspace ventilation control.

LED status indicators
🟢 Green – job running.
🟡 Yellow – job paused.
⚪ White – job stopped or finished.
🔴 Red – error or alarm.

Technologies
Node.js · CNCjs · GRBL · Raspberry Pi · Python · SPI · WS2812 · Home Assistant

Safety: This project is intended for monitoring and does not replace fire protection, laser supervision or hardware emergency-stop systems. Software status is not independent proof that laser emission has stopped.
----------------

(Polski)

Longer Ray5 – CNCjs + Home Assistant + WS2812

Integracja plotera laserowego Longer Ray5 z systemem Home Assistant za pośrednictwem CNCjs, uruchomionego na Raspberry Pi.
Projekt umożliwia monitorowanie stanu lasera w czasie rzeczywistym, wyświetlanie statusu w Home Assistant oraz sygnalizowanie pracy urządzenia za pomocą adresowalnych diod LED WS2812.
Najważniejsze funkcje
Monitorowanie pracy CNCjs i stanu kontrolera GRBL.
Rozpoznawanie statusów: gotowość, praca, pauza, zatrzymanie, zakończenie i błąd.
Przekazywanie statusu do Home Assistant przez REST API.
Kolorowa sygnalizacja stanu urządzenia za pomocą diod WS2812.
Automatyczne pobieranie tokenu uwierzytelniającego CNCjs.
Obsługa ponownego połączenia po utracie komunikacji.
Możliwość wykorzystania statusów w automatyzacjach Home Assistant, np. do sterowania wentylacją stanowiska laserowego.

Sygnalizacja LED

🟢 Zielony – laser wykonuje zadanie.
🟡 Żółty – zadanie wstrzymane.
⚪ Biały – zadanie zatrzymane lub zakończone.
🔴 Czerwony – błąd lub alarm.

Wykorzystywane technologie

Node.js · CNCjs · GRBL · Raspberry Pi · Python · SPI · WS2812 · Home Assistant

Bezpieczeństwo: Projekt ma charakter informacyjny i nie zastępuje zabezpieczeń przeciwpożarowych, nadzoru nad laserem ani sprzętowego wyłącznika awaryjnego. Stan aplikacji nie jest niezależnym potwierdzeniem wyłączenia emisji lasera.
