# QMX-REMOTE

Small Wi-Fi box (Raspberry Pi Zero 2 W) for remote control of the QRP Labs **QMX** and **QMX+** in the browser. Built on [YAESU-REMOTE](https://github.com/cgraf63/YAESU-REMOTE) (server, Wi-Fi, OLED, audio, installer); the QMX driver and page come from [SHACK-SERVER](https://github.com/cgraf63/SHACK-SERVER).

The page looks like the radio: the real 2 × 16 LCD (CAT `LC;`, drawn as a dot matrix), tuning knob, S / power / SWR meters, modes, bands, VFO A / B, split, RIT, AF / RF gain, keyer speed, CW text with macros, the QMX's CW decoder, a carrier key for tuning (max. 15 s) and RX audio.

| | QMX | QMX+ | QDX |
|---|---|---|---|
| Bands | 80–20 m, 60–15 m or 20–10 m version | 160–6 m | – |
| Detection | `ID020` + `VN…QMX` / `OMQC` | same, QMX+ from the bands | `ID020` + `VN…QDX` |
| Status | works (driver from SHACK-SERVER) | works | connects, not tested |

## CAT on the QMX

Checked against the QMX CAT manual (firmware 1_04_003): the QMX speaks a subset of the **Kenwood TS-480** commands plus own commands, over a USB virtual COM port (`ttyACM`, the baud rate does not matter). Commands end with `;`, never with CR / LF.

- `ID;` always answers `ID020;` (TS-480) – on the QMX, QMX+ and QDX alike, so it cannot tell them apart. The box asks `VN;` (firmware, e.g. `VN1_04_003QMX;`) and `OM;` (`OMQC;` on the QMX) as well. Without either answer, a QRP Labs name in `/dev/serial/by-id` decides; any other TS-480 style radio is reported as “not a QMX”.
- QMX and QMX+ run the same firmware. Which bands the radio has comes from `BN;` (band number in the radio's band list) together with the current band: “Auto” on the page. Firmware without `BN` (1_02_xxx): choose the version on the page, it is saved in `data/config.json`.
- Output power is **read only** over CAT (`PC;` = measured power in 0.1 W, only while transmitting) – there is no command to set it.
- A carriage return switches the QMX port into terminal mode. That is why the installer masks **ModemManager** (it sends `AT…\r` to every new ttyACM port) and brltty.

## Install on the Raspberry Pi

Raspberry Pi OS Lite (Bookworm or newer, 32 or 64 bit) on a Zero 2 W, 3, 4 or 5. Write the card with the Raspberry Pi Imager (user, SSH and – if you like – Wi-Fi in its settings), then on the Pi:

```sh
sudo apt install -y git
git clone https://github.com/cgraf63/QMX-REMOTE.git
cd QMX-REMOTE
sudo ./scripts/install.sh            # options: --setup-hotspot, --oled-driver sh1106, --no-oled, --port 8080, --dry-run
sudo reboot
```

The script installs Node.js 22, creates the user `qmx`, puts the code as a git checkout into `/opt/qmx-remote` and builds it there, sets the hostname `qmx-remote`, turns on I2C, masks ModemManager / brltty and installs the services (`qmx-remote` on port 80, `qmx-remote-oled`, `qmx-remote-update@`) and the polkit rule. The options of the first run are kept in `/etc/qmx-remote/install.conf`. Later updates: from the browser (below), or `git pull` and the script again.

At every boot `qmx-remote-boot` (`scripts/boot.sh`) checks: USB full speed on a Pi Zero (one reboot after setting it), a 1 GB swap file below 1.5 GB RAM (the update builds on the Pi), the Wi-Fi country, and **service access**: a file `qmx-access.txt` on the boot partition with `user=admin` and `password=…` creates that user with sudo, turns SSH on and is deleted.

The ready-made SD card image is built in the private repository `qmx-remote-image` with `scripts/install.sh --image --setup-hotspot`: the same installation, nothing started in the chroot; on the first visit a short setup assistant (`/setup.html`: callsign, Wi-Fi, ntfy, transceiver found?) leads to the remote.

Radio: USB cable to the Pi's **USB** port (not PWR) – on the Zero 2 W with a micro-USB OTG adapter or cable.

Pi Zero / Zero 2 W: the script adds `dwc_otg.speed=1` to `cmdline.txt` (USB at 12 Mbit/s) – that stopped the USB drop-outs in YAESU-REMOTE. The QMX is a full-speed device anyway (CAT + 48 kHz sound card), nothing is lost. Skip with `--no-usb-fullspeed`.

Audio: the QMX's USB sound card is found automatically (the sound card on the same USB device as the CAT port); set `audio.device` / `AUDIO_DEVICE` to override.

## Run (development)

Node 22. Only runtime dependency: `ws` (audio WebSocket). The serial port is opened directly (`stty` + `/dev/ttyACM…`), no native modules.

```sh
npm install
npm run dev          # http://localhost:8080
npm run build && npm start
```

Configuration is optional – `data/config.json` or environment:

| Setting | Env | Default |
|---|---|---|
| HTTP port | `PORT` | 8080 |
| CAT device | `CAT_DEVICE` | `auto` (QRP Labs device in `/dev/serial/by-id`, first virtual COM port; else `ttyACM*`, `ttyUSB*`) |
| CAT baud rate | `CAT_BAUD` | ttyACM: 115200 (ignored by USB), serial adapters: 38400, 115200, 19200, 9600, 4800 |
| Audio device | `AUDIO_DEVICE` | `auto` (sound card of the QMX) |
| Audio on/off | `AUDIO=off` | on |
| Data directory | `QMX_DATA` | `./data` |
| Band version | `qmx.bands` in config.json, or on the page | `auto` |
| Callsign for `{CALL}` | `callsign` in config.json, or **CALL** on the page | – |

The USB port is reopened 2 s after a drop. The box notices when the radio is swapped (`VN;` reports another product, or no answer for 20 s) and searches again.

## Wi-Fi

The box joins the home router or the phone hotspot. Setup in the browser: **WI-FI** on the remote page (`/wifi.html`).

- **First start:** turn on a phone hotspot `QMX-REMOTE`, password `qmx-remote` (2.4 GHz / iPhone “Maximise Compatibility”). The box joins it; open `http://qmx-remote.local` or the address shown in the phone's hotspot settings.
- **Own setup Wi-Fi** (image, or `install.sh --setup-hotspot`): if the box has no network for 3 minutes (10 when a home network is saved – the router may still start after a power cut), it opens the open Wi-Fi `QMX-REMOTE-Setup`. A phone that joins it gets the Wi-Fi page (captive portal, `http://10.42.0.1`); add the home Wi-Fi with *connect now*. While nobody uses it, the saved networks are tried again every 5 minutes; a cable or a working network ends it. The OLED shows `SETUP QMX-REMOTE-Setup`.
- **Or** put `wifi.txt` on the boot drive of the SD card (see `system/wifi.txt.example`): `ssid=` / `password=` pairs, best first, optional `country=`. Imported at start, passwords are removed from the file afterwards.
- **Saved networks in order** (NetworkManager autoconnect priority 100, 90, …): the box takes the first one in range. The setup network always stays last (priority −100) and cannot be deleted.
- **Switching** warns first (the page loses the connection). If the new network does not come up within 30 s, the box goes back to the previous one.
- **ntfy:** with a topic set, the box sends “QMX-REMOTE online – 192.168.x.x” with a link whenever it gets a new address (Android often cannot open `.local` names).

On the Pi: `system/qmx-remote.service` (systemd, user `qmx`, imports `wifi.txt` as root before the start) and `system/50-qmx-remote.rules` (polkit: user `qmx` may manage NetworkManager, no sudo).

## Software update

The version is shown at the top of the remote page (`v0.2.0`); when a newer one is on GitHub it turns into a yellow **UPDATE 0.2.1** button. The **UPDATE** page (`/update.html`) shows the installed version, the new changes and the log of the last update.

- **Check:** the box asks GitHub (`git fetch`) 3 minutes after the start and then every 12 hours, or with **CHECK NOW**. Only the changes are downloaded.
- **Install:** about a minute – new code (`git reset` to `origin/main`), build, restart. The OLED shows **UPDATE**, then the new version. If the new version does not build, the box goes back to the old one. Not possible while the QMX transmits.
- **How:** the server (user `qmx`) only reads the checkout; fetching and installing run as root in `qmx-remote-update@check` / `@install` (`scripts/update.sh`), which the polkit rule lets it start – nothing else. By hand: `sudo systemctl start qmx-remote-update@install`, log in `/var/lib/qmx-remote/update.log`.
- **Version number:** `version` in `package.json` plus the commits after it – `0.2.0` + 3 commits = `0.2.3`. A new `version` (e.g. `0.3.0`) starts counting again.

The repository must be public: the boxes fetch without credentials.

## OLED status display (optional)

A 0.96" I2C OLED (SSD1306, 128 × 64; 1.3" SH1106 works too) shows the software version for 3 s at the start (and “UPDATED TO …” after an update), then the radio (QMX / QMX+) with frequency and mode (model inverted while transmitting), the Wi-Fi network with signal, the IP address and a turning logo – as long as it turns, the Pi is running. Without Wi-Fi it shows the setup hotspot name.

Wiring: VCC → pin 1 (3.3 V), GND → pin 6, SDA → pin 3, SCL → pin 5. `oled/qmx_oled.py` uses the Python standard library only (I2C directly via `/dev/i2c-1`); service: `system/qmx-remote-oled.service`. Preview without a display: `python3 oled/qmx_oled.py --demo --png preview.png` (`--screen version|updated|updating` for the other screens).

## Test without a radio

`tools/sim/qmx_sim.py` simulates a QMX / QMX+ on a virtual serial port (Python 3, standard library only):

```sh
python3 tools/sim/qmx_sim.py --link /tmp/cat-sim
CAT_DEVICE=/tmp/cat-sim AUDIO=off npm run dev
```

Options: `--bands 80-20|60-15|20-10|plus` (band version), `--old-firmware` (1_02_005: no `BN`, `LC`, `TR`, `RG`, `SA`), `--model qdx|ts480` (detection test), `--rit relative`, `--verbose`. Like the QMX it stops answering after a carriage return (terminal mode).

Wi-Fi page without NetworkManager: `NMCLI=tools/sim/fake_nmcli.py` (state in `/tmp/fake-nmcli.json`: networks in range with their passwords, saved connections). A wrong password makes the switch fail and fall back, like on the Pi.

## API

| | |
|---|---|
| `GET /api/status` | server and detection status |
| `GET /api/radio` | state (409 while no radio is connected) |
| `GET /api/radio/tables` | modes, bands, tune steps, band versions |
| `POST /api/radio/control` | `{ control, value }` – frequency, frequencyB, mode, band, bandUp, bandDown, vfo, split, aEqualsB, swap, rit, ritOffset, ritClear, afGain, rfGain, keyerSpeed, step, cw, cwStop, carrier, clearDecoded, rx |
| `POST /api/radio/bands` | `{ version }` band version, saved |
| `GET/POST /api/settings` | callsign for `{CALL}` |
| `GET /api/wifi`, `…/saved`, `…/scan` | Wi-Fi status, saved networks, networks in range |
| `POST /api/wifi/add`, `…/remove`, `…/order`, `…/connect` | manage networks, switch with fallback |
| `GET/POST /api/wifi/ntfy`, `POST …/ntfy/test` | ntfy message with the address |
| `GET /api/update`, `POST …/check`, `POST …/install` | software version, new commits, install (server restarts) |
| `GET /api/setup`, `POST /api/setup/done` | setup assistant of the image |
| `GET /api/display` | everything the OLED shows (radio, frequency, Wi-Fi, IP, version, update running) |
| `WS /audio`, `WS /audio-tx` | RX / TX audio, 48 kHz, 16 bit, mono |

## Roadmap

1. ~~Server from YAESU-REMOTE, QMX driver and page from SHACK-SERVER, detection with `VN;` / `OM;`~~
2. ~~Software update from the browser, version on page and OLED~~
3. Test on the Zero 2 W with QMX and QMX+ (detection, USB drop, sound card name, update)
4. QDX: test, own band list
5. TX audio from the browser (digital modes: `TX;` + USB audio), HTTPS for the microphone
6. ~~SD card image for the Zero 2 W (qmx-remote-image), setup Wi-Fi, setup assistant~~
