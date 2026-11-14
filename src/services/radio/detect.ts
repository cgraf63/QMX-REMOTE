import fs from "node:fs";
import path from "node:path";

import { TtyPort } from "./tty-port.js";
import type { RadioKind } from "./radio.interface.js";

/*
 * Find the transceiver.
 *
 * QRP Labs radios emulate a Kenwood TS-480: "ID;" always answers
 * "ID020;" - on the QMX, the QMX+, the QDX and on a real TS-480 alike.
 * So the model comes from two more questions (QMX CAT manual):
 *
 *   VN;   firmware version + product, e.g. VN1_04_003QMX;
 *   OM;   model, QMX: OMQC;
 *
 *   ID020 + VN…QMX or OMQC   -> QMX (QMX or QMX+, same firmware; the
 *                               driver tells them apart by the bands)
 *   ID020 + VN…QDX           -> QDX
 *   ID020, no VN / OM answer -> the USB name in /dev/serial/by-id decides
 *                               (…QMX… / …QDX…),
 *                               else "TS-480 compatible, not supported"
 *
 * The QMX is a USB CDC device (ttyACM): the baud rate does not matter,
 * one rate is enough. Nothing here ever sends a carriage return - on
 * the QMX a CR switches the port into terminal mode.
 */

export interface Detected {
    device: string;
    baudRate: number;
    id: string;
    version: string;
    om: string;
    kind: RadioKind | null;
}

/* serial adapters (not the QMX): the usual rates */
export const BAUD_RATES = [38400, 115200, 19200, 9600, 4800];
const USB_CDC_RATE = 115200;

const BY_ID = "/dev/serial/by-id";
const QRP = /QRP|QMX|QDX/i;


function list(dir: string, filter: (name: string) => boolean): string[] {
    try {
        return fs.readdirSync(dir).filter(filter).sort().map(name => path.join(dir, name));
    }
    catch {
        return [];
    }
}

function realpath(p: string): string {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return "";
    }
}

/* candidate CAT ports, best first */
export function candidates(): string[] {

    const byId = list(BY_ID, () => true);

    if (byId.length) {
        // The by-id name is kept (not /dev/ttyACMn): after a USB drop the
        // QMX may come back as ttyACM1, the same name points to it.
        // QMX: up to three virtual COM ports (if00, if02, if04) - the
        // first one is CAT. Other multi-port adapters: interface 00.
        // QRP Labs devices first, then ttyACM, then the rest.
        const rank = (p: string) => QRP.test(p) ? 0 : /ttyACM/.test(realpath(p)) ? 1 : 2;
        const cat = byId
            .filter(p => /-if00/.test(p) || !/-if\d\d/.test(p))
            .sort((a, b) => rank(a) - rank(b));
        const seen = new Set<string>();
        return cat.filter(p => {
            const real = realpath(p);
            if (!real || seen.has(real)) return false;
            seen.add(real);
            return true;
        });
    }

    return [
        ...list("/dev", name => /^ttyACM\d+$/.test(name)),
        ...list("/dev", name => /^ttyUSB\d+$/.test(name))
    ];

}

/* USB CDC (ttyACM, pty of the simulator): one rate is enough */
export function ratesFor(device: string, configured: number): number[] {
    if (configured) return [configured];
    const real = realpath(device) || device;
    return /ttyACM|\/pts\//.test(real) ? [USB_CDC_RATE] : BAUD_RATES;
}

export function kindOf(version: string, om: string, device: string): RadioKind | null {
    if (/QMX/i.test(version) || om === "QC") return "QMX";
    if (/QDX/i.test(version)) return "QDX";
    // older firmware without VN / OM: the USB name in /dev/serial/by-id
    if (!version && !om && device.startsWith(BY_ID)) {
        if (/QMX/i.test(device)) return "QMX";
        if (/QDX/i.test(device)) return "QDX";
    }
    return null;
}


/* one device, one rate: null = no answer to ID; */
export function probe(device: string, baudRate: number, timeoutMs = 600): Promise<Detected | null> {

    return new Promise(resolve => {

        const port = new TtyPort(device, { baudRate, dataBits: 8, stopBits: 1, parity: "none", rtscts: false });
        let buffer = "";
        let done = false;
        let id = "";
        let version = "";
        let om = "";
        let timer: NodeJS.Timeout | undefined;
        let retry: NodeJS.Timeout | undefined;

        const finish = (result: Detected | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearTimeout(retry);
            port.removeAllListeners();
            port.on("error", () => undefined);
            port.close();
            resolve(result);
        };

        const result = (): Detected => ({ device, baudRate, id, version, om, kind: kindOf(version, om, device) });

        timer = setTimeout(() => finish(null), timeoutMs);

        port.on("error", () => finish(id ? result() : null));
        port.on("close", () => finish(id ? result() : null));
        port.on("data", (data: Buffer) => {

            buffer += data.toString("latin1");
            if (buffer.length > 512) buffer = buffer.slice(-128);

            if (!id) {
                const m = buffer.match(/ID(\d{3,4});/);
                if (!m) return;
                id = m[1]!;
                // a TS-480 style radio: ask for the model, give it time
                clearTimeout(timer);
                clearTimeout(retry);
                timer = setTimeout(() => finish(result()), 800);
                port.write("VN;OM;");
                return;
            }

            const vn = buffer.match(/VN([^;]*);/);
            if (vn) version = vn[1]!.trim();
            const mo = buffer.match(/OM([^;]*);/);
            if (mo) om = mo[1]!.trim();

            if (version && om) finish(result());
            // an unknown command answers "?;" - VN and OM both unknown: done
            if ((buffer.match(/\?;/g) ?? []).length >= 2 && !version && !om) finish(result());

        });

        port.open(error => {
            if (error) return finish(null);
            port.write("ID;");
            // a radio that just woke up may drop the first command
            retry = setTimeout(() => { if (!done && !id) port.write("ID;"); }, timeoutMs / 2);
        });

    });

}


/*
 * Search all candidates (or the configured device) at the rates that
 * make sense for it (or the configured rate).
 */
export async function detect(device: string, baudRate: number, log: (text: string) => void): Promise<Detected | null> {

    const devices = device && device !== "auto" ? [device] : candidates();

    if (!devices.length) {
        log("no serial device (USB cable plugged in, QMX switched on?)");
        return null;
    }

    let other: Detected | null = null;

    for (const dev of devices) {
        for (const rate of ratesFor(dev, baudRate)) {
            log(`trying ${dev} @ ${rate}`);
            const found = await probe(dev, rate);
            if (found?.kind) return found;
            // answers ID; but is no QRP Labs radio: keep looking
            if (found && !other) other = found;
            if (found) break;
        }
    }

    if (other) return other;

    log(`no answer to ID; on ${devices.join(", ")}`);
    return null;

}
