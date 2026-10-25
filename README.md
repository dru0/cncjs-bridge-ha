# CNCjs → Home Assistant + WS2812 bridge

This repository contains the **bridge process only**, not the separate Home Assistant custom integration or the CNCjs server. It reports CNCjs/GRBL workflow status to HA and drives 3 WS2812 LEDs through SPI0 (Raspberry Pi GPIO10).

## Installation (Debian / Raspberry Pi)

```bash
git clone https://github.com/dru0/cncjs-bridge-ha.git ~/cncjs-bridge-ha
cd ~/cncjs-bridge-ha
sudo bash install.sh
```

The installer deploys to `/opt/cncjs-bridge-ha`, creates an unprivileged `cncjsbridge` system account, grants `spi` and `dialout` group membership, migrates a legacy `bridge.env` if found, installs only bridge dependencies and updates only `cncjs-ha-bridge.service`. Configuration remains at `/opt/cncjs-bridge-ha/bridge.env`, owned by `root:cncjsbridge` and mode `0640`.

**Bridge-only update:**

```bash
sudo bash /opt/cncjs-bridge-ha/update.sh
```

An update uses fast-forward Git changes in `/opt/cncjs-bridge-ha` and restarts only the bridge. Run it only while the laser is idle. The installer leaves any previous installation under `/home/pi` in place for manual rollback. If `HA_URL` or `HA_TOKEN` is not configured, it does not activate a service.

Read [README_PL.md](README_PL.md) for the Polish migration, status checks, SPI setup, and safety notes.

**Safety:** HA status is not independent verification that laser emission has stopped; this monitoring bridge does not replace supervision, extraction or an emergency-stop.
