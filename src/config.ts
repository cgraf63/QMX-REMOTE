import fs from "node:fs";
import path from "node:path";

/*
 * Configuration: defaults < data/config.json < environment.
 * Everything works without a config file: the QMX is found
 * automatically (ID; + VN;), audio uses the QMX's USB sound card.
 *
 * data/config.json (all optional):
 *   {
 *     "http":  { "port": 8080, "host": "0.0.0.0" },
 *     "cat":   { "device": "auto", "baudRate": 0 },
 *     "audio": { "enabled": true, "device": "auto" },      // or e.g. "plughw:CARD=Transceiver,DEV=0"
 *     "wifi":  { "interface": "wlan0", "hotspot": false },  // hotspot: own setup Wi-Fi when offline
 *     "qmx":   { "bands": "auto" },                       // auto | 80-20 | 60-15 | 20-10 | plus
 *     "callsign": "HB9OM"                                 // {CALL} in the CW keys
 *   }
 *
 * "qmx.bands" and "callsign" are also set from the page (saveSettings).
 *
 * Environment: PORT, HOST, CAT_DEVICE, CAT_BAUD, AUDIO_DEVICE, AUDIO,
 * QMX_DATA (data directory), NMCLI (nmcli command, for tests),
 * WIFI_HOTSPOT=1 (own setup Wi-Fi when offline, see wifi.service.ts).
 */

export type QmxBandVersion = "auto" | "80-20" | "60-15" | "20-10" | "plus";

export const BAND_VERSIONS: QmxBandVersion[] = ["auto", "80-20", "60-15", "20-10", "plus"];

export interface Config {
    dataDir: string;
    publicDir: string;
    http: { port: number; host: string };
    /* device "auto" = search; baudRate 0 = 115200 on USB (ttyACM), else the usual rates */
    cat: { device: string; baudRate: number };
    /* device "auto" = the sound card of the QMX (audio-device.ts) */
    audio: { enabled: boolean; device: string; sampleRate: number; channels: number };
    /*
     * Wi-Fi via NetworkManager. The setup network is the way in on the
     * first start: a phone hotspot with exactly this name and password.
     */
    wifi: { interface: string; nmcli: string; setupSsid: string; setupPassword: string; hotspot: boolean };
    /* which bands the QMX has (auto = detected with BN;) */
    qmx: { bands: QmxBandVersion };
    callsign: string;
}

const dataDir = process.env.QMX_DATA || path.join(process.cwd(), "data");
const configFile = path.join(dataDir, "config.json");

function readFile(): Partial<Config> & Record<string, unknown> {
    try {
        return JSON.parse(fs.readFileSync(configFile, "utf8")) as Partial<Config>;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error("config.json:", (error as Error).message, "- using defaults");
        }
        return {};
    }
}

const file = readFile();
const env = process.env;

/* public/ next to the compiled index.js (dist/public) or src/public with tsx */
const here = path.dirname(new URL(import.meta.url).pathname);

function bandVersion(value: unknown): QmxBandVersion {
    return BAND_VERSIONS.includes(value as QmxBandVersion) ? value as QmxBandVersion : "auto";
}

export const config: Config = {
    dataDir,
    publicDir: path.join(here, "public"),
    http: {
        port: Number(env.PORT) || file.http?.port || 8080,
        host: env.HOST || file.http?.host || "0.0.0.0"
    },
    cat: {
        device: env.CAT_DEVICE || file.cat?.device || "auto",
        baudRate: Number(env.CAT_BAUD) || file.cat?.baudRate || 0
    },
    audio: {
        enabled: env.AUDIO ? env.AUDIO !== "off" : file.audio?.enabled ?? true,
        device: env.AUDIO_DEVICE || file.audio?.device || "auto",
        sampleRate: file.audio?.sampleRate || 48000,
        channels: file.audio?.channels || 1
    },
    wifi: {
        interface: file.wifi?.interface || "wlan0",
        nmcli: env.NMCLI || "nmcli",
        setupSsid: "QMX-REMOTE",
        setupPassword: "qmx-remote",
        // ready-made image: on; own installation: scripts/install.sh --setup-hotspot
        hotspot: env.WIFI_HOTSPOT ? env.WIFI_HOTSPOT === "1" : (file.wifi as { hotspot?: boolean } | undefined)?.hotspot === true
    },
    qmx: {
        bands: bandVersion(file.qmx?.bands)
    },
    callsign: String(file.callsign ?? "").toUpperCase()
};

/*
 * Settings from the page: written into data/config.json (other keys
 * kept) and applied to the running config.
 */
export function saveSettings(patch: { bands?: QmxBandVersion; callsign?: string }): void {

    const current = readFile();

    if (patch.bands !== undefined) {
        config.qmx.bands = bandVersion(patch.bands);
        current.qmx = { ...(current.qmx ?? {}), bands: config.qmx.bands };
    }

    if (patch.callsign !== undefined) {
        config.callsign = patch.callsign.toUpperCase();
        current.callsign = config.callsign;
    }

    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${configFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2) + "\n");
    fs.renameSync(tmp, configFile);

}
