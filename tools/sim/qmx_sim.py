#!/usr/bin/env python3
"""
QRP Labs QMX / QMX+ CAT simulator on a virtual serial port.

Opens a pty in raw mode and answers CAT commands like the QMX (CAT
manual, firmware 1_04_003), so the server and the page can be tested
without a radio. Python 3, standard library only.

    python3 tools/sim/qmx_sim.py --link /tmp/qmx-sim
    CAT_DEVICE=/tmp/qmx-sim AUDIO=off npm run dev

Options:
    --model qmx|qdx|ts480   what VN / OM answer (detection test):
                            qmx   VN1_04_003QMX; OMQC;
                            qdx   VN1_08QDX;  OM unknown
                            ts480 VN and OM unknown (not a QRP Labs radio)
    --bands 80-20|60-15|20-10|plus   band version (BN numbers), default plus
    --old-firmware          like 1_02_005: no BN, BU, BD, TR, RG, SA, LC
    --rit relative          RU / RD relative instead of absolute
    --verbose               print every command

Like the real QMX, a carriage return switches the port into terminal
mode: the simulator then stops answering CAT (restart it).

Not a complete radio: it keeps what the driver sets and returns it,
simulates the S-meter, power / SWR while transmitting and a little CW
in the decoder buffer (TB).
"""

import argparse
import os
import pty
import random
import select
import time
import tty

BANDS = {
    "160m": (1_800_000, 2_000_000, 1_836_000), "80m": (3_500_000, 4_000_000, 3_573_000),
    "60m": (5_250_000, 5_450_000, 5_357_000), "40m": (7_000_000, 7_300_000, 7_030_000),
    "30m": (10_100_000, 10_150_000, 10_116_000), "20m": (14_000_000, 14_350_000, 14_060_000),
    "17m": (18_068_000, 18_168_000, 18_086_000), "15m": (21_000_000, 21_450_000, 21_060_000),
    "12m": (24_890_000, 24_990_000, 24_906_000), "11m": (26_965_000, 27_405_000, 27_185_000),
    "10m": (28_000_000, 29_700_000, 28_060_000), "6m": (50_000_000, 54_000_000, 50_096_000),
}

VERSIONS = {
    "80-20": ["80m", "60m", "40m", "30m", "20m"],
    "60-15": ["60m", "40m", "30m", "20m", "17m", "15m"],
    "20-10": ["20m", "17m", "15m", "12m", "11m", "10m"],
    "plus": ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "11m", "10m", "6m"],
}

MODE_NAMES = {"1": "LSB", "2": "USB", "3": "CW", "5": "AM", "6": "DIG", "7": "CWR", "9": "DGR"}

OLD_FIRMWARE_MISSING = {"BN", "BU", "BD", "TR", "RG", "SA", "LC"}

CW_TEXT = "CQ CQ DE HB9XYZ HB9XYZ K   TNX FER CALL UR RST 579 579 ES 73  "


class Qmx:

    def __init__(self, model, bands, old_firmware, rit_relative):
        self.model = model
        self.bands = VERSIONS[bands]
        self.missing = OLD_FIRMWARE_MISSING if old_firmware else set()
        self.firmware = "1_02_005" if old_firmware else "1_04_003"
        self.rit_relative = rit_relative
        start = "20m" if "20m" in self.bands else self.bands[0]
        self.freq = [BANDS[start][2], BANDS[start][2] + 2_000]
        self.mode = "3"
        self.vfo_mode = 0            # FR set: 0 A, 1 B, 2 split
        self.tx = 0
        self.key_down = 0
        self.rit_on = 0
        self.rit = 0
        self.ks = 20
        self.ag = 91                  # 0.25 dB steps
        self.rg = 63
        self.tr = 6                   # 100 Hz
        self.ky = ""                  # characters still to send
        self.ky_next = 0.0
        self.decoded = ""             # TB buffer (40 characters, not circular)
        self.cw_pos = 0
        self.terminal = False
        self.smeter = 30

    # ---------------------------------------------------------------- helpers

    def rx_vfo(self):
        return 1 if self.vfo_mode == 1 else 0

    def tx_vfo(self):
        return 0 if self.vfo_mode == 0 else 1

    def band_number(self):
        f = self.freq[self.rx_vfo()]
        for i, name in enumerate(self.bands):
            low, high, _ = BANDS[name]
            if low <= f <= high:
                return i
        return 0

    def transmitting(self):
        return self.tx or self.key_down or bool(self.ky)

    def tick(self):
        now = time.time()
        # CW sending: about one character per 60 / (WPM * 1.2) * 8 s
        if self.ky and now >= self.ky_next:
            self.ky = self.ky[1:]
            self.ky_next = now + 60 / (self.ks * 50) * 8
        # receiving CW: decoded characters into the TB buffer
        if not self.transmitting() and self.mode in ("3", "7") and random.random() < 0.35:
            if len(self.decoded) < 40:
                ch = CW_TEXT[self.cw_pos % len(CW_TEXT)]
                self.cw_pos += 1
                # some noise characters now and then
                self.decoded += random.choice("ETI*") if random.random() < 0.06 else ch
        self.smeter = max(0, min(100, self.smeter + random.randint(-4, 4)))

    def lcd(self):
        f = self.freq[self.rx_vfo()]
        mhz, rest = divmod(f, 1_000_000)
        freq = f"{mhz}.{rest // 1000:03d}.{rest % 1000 // 10:02d}"
        vfo = "B" if self.rx_vfo() else "A"
        line1 = f"{freq:>10} {MODE_NAMES.get(self.mode, '?'):<3} {vfo}"
        if self.transmitting():
            line2 = f"TX {4.5 if self.key_down or self.ky else 4.2:.1f}W {self.ks:2d}WPM"
        else:
            line2 = f"S{min(9, self.smeter // 6)}       {self.ks:2d}WPM"
        return (line1[:16].ljust(16) + line2[:16].ljust(16))[:32]

    def info(self):
        f = self.freq[self.rx_vfo()] if not self.tx else self.freq[self.tx_vfo()]
        rit = f"{'+' if self.rit >= 0 else '-'}{abs(self.rit):04d}"
        split = 1 if self.vfo_mode == 2 else 0
        return (f"IF{f:011d}     {rit}{self.rit_on}000"
                f"0{1 if self.transmitting() else 0}{self.mode}{self.rx_vfo()}0{split}000 ;")

    # ---------------------------------------------------------------- commands

    def handle(self, cmd):
        c, body = cmd[:2].upper(), cmd[2:]

        if c in self.missing:
            return "?;"

        if c == "ID":
            return "ID020;"
        if c == "VN":
            if self.model == "qmx":
                return f"VN{self.firmware}QMX;"
            if self.model == "qdx":
                return "VN1_08QDX;"
            return "?;"
        if c == "OM":
            return "OMQC;" if self.model == "qmx" else "?;"

        if c in ("FA", "FB"):
            i = 0 if c == "FA" else 1
            if body:
                self.freq[i] = int(body)
                return ""
            return f"{c}{self.freq[i]:011d};"

        if c == "IF":
            return self.info()

        if c == "MD":
            if body:
                if body not in MODE_NAMES and body != "8":
                    return "?;"
                self.mode = "2" if body == "8" else body
                return ""
            return f"MD{self.mode};"

        if c == "FR":
            if body:
                self.vfo_mode = int(body)
                return ""
            return f"FR{self.rx_vfo()};"
        if c == "FT":
            if body:
                self.vfo_mode = int(body)
                return ""
            return f"FT{self.tx_vfo()};"
        if c == "SP":
            if body:
                self.vfo_mode = 2 if body == "1" else 0
                return ""
            return f"SP{1 if self.vfo_mode == 2 else 0};"

        if c in ("TX", "TQ") and (c == "TX" or body):
            self.tx = 1 if c == "TX" or body == "1" else 0
            return ""
        if c == "TQ":
            return f"TQ{1 if self.transmitting() else 0};"
        if c == "RX":
            self.tx = 0
            self.key_down = 0
            self.ky = ""
            return ""
        if c == "KD":
            if body:
                self.key_down = 1 if body == "1" else 0
                return ""
            return f"KD{self.key_down};"

        if c == "KS":
            if body:
                self.ks = int(body)
                return ""
            return f"KS{self.ks:03d};"
        if c == "KY":
            if body:
                text = body[1:] if body.startswith(" ") else body
                if len(self.ky) + len(text) > 80:
                    return "?;"
                self.ky += text
                self.ky_next = time.time()
                return ""
            return "KY2;" if not self.ky else "KY0;"
        if c == "TB":
            text = self.decoded
            self.decoded = ""
            return f"TB{min(9, len(self.ky))}{len(text):02d}{text};"

        if c == "AG":
            if body and body != "0":
                self.ag = max(0, min(799, int(body)))
                return ""
            return f"AG0{self.ag:03d};"
        if c == "RG":
            if body:
                self.rg = int(body)
                return ""
            return f"RG{self.rg:03d};"
        if c == "TR":
            if body:
                v = int(body)
                if not 0 <= v <= 7:
                    return "?;"
                self.tr = v
                return ""
            return f"TR{self.tr};"

        if c == "SM":
            return f"SM{0 if self.transmitting() else self.smeter:03d};"
        if c == "SA":
            return f"SA{max(0, self.smeter - 40):02d};"
        if c == "PC":
            if not self.transmitting():
                return "PC;"
            return f"PC{45 if self.key_down or self.ky else 42};"
        if c == "SW":
            if not self.transmitting():
                return "SW;"
            return f"SW{random.randint(115, 135)};"

        if c == "RT":
            if body:
                self.rit_on = 1 if body == "1" else 0
                return ""
            return f"RT{self.rit_on};"
        if c == "RC":
            self.rit = 0
            return ""
        if c in ("RU", "RD"):
            v = int(body or "0") * (1 if c == "RU" else -1)
            self.rit = max(-9999, min(9999, self.rit + v if self.rit_relative else v))
            return ""

        if c == "BN":
            if body:
                n = int(body)
                if not 0 <= n < len(self.bands):
                    return "?;"
                self.freq[self.rx_vfo()] = BANDS[self.bands[n]][2]
                return ""
            return f"BN{self.band_number()};"
        if c in ("BU", "BD"):
            n = (self.band_number() + (1 if c == "BU" else -1)) % len(self.bands)
            self.freq[self.rx_vfo()] = BANDS[self.bands[n]][2]
            return ""

        if c == "LC":
            return f"LC{self.lcd()};"
        if c == "PS":
            return "PS1;"
        if c == "AI":
            return "AI0;" if not body else ""

        return "?;"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", choices=["qmx", "qdx", "ts480"], default="qmx")
    ap.add_argument("--bands", choices=sorted(VERSIONS), default="plus")
    ap.add_argument("--old-firmware", action="store_true")
    ap.add_argument("--rit", choices=["absolute", "relative"], default="absolute")
    ap.add_argument("--link", default="", help="create a symlink to the pty, e.g. /tmp/qmx-sim")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    master, slave = pty.openpty()
    tty.setraw(slave)
    path = os.ttyname(slave)

    if args.link:
        try:
            os.unlink(args.link)
        except FileNotFoundError:
            pass
        os.symlink(path, args.link)

    radio = Qmx(args.model, args.bands, args.old_firmware, args.rit == "relative")
    print(f"{args.model.upper()} simulator ({args.bands}, firmware {radio.firmware}) on {path}"
          + (f" ({args.link})" if args.link else ""), flush=True)

    buffer = b""
    last_tick = 0.0

    try:
        while True:
            ready, _, _ = select.select([master], [], [], 0.1)
            now = time.time()
            if now - last_tick > 0.2:
                radio.tick()
                last_tick = now
            if not ready:
                continue
            try:
                data = os.read(master, 4096)
            except OSError:
                time.sleep(0.1)
                continue
            if radio.terminal:
                continue
            if b"\r" in data:
                radio.terminal = True
                print("carriage return received: terminal mode, CAT stops (like the QMX)", flush=True)
                continue
            buffer += data
            while b";" in buffer:
                raw, buffer = buffer.split(b";", 1)
                cmd = raw.decode("latin1").lstrip("\n ")
                if not cmd:
                    continue
                try:
                    answer = radio.handle(cmd)
                except ValueError:
                    answer = "?;"
                if args.verbose:
                    print(f"> {cmd};  < {answer}", flush=True)
                if answer:
                    os.write(master, answer.encode("latin1"))
    except KeyboardInterrupt:
        pass
    finally:
        if args.link:
            try:
                os.unlink(args.link)
            except OSError:
                pass


if __name__ == "__main__":
    main()
