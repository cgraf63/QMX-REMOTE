import fs from "node:fs";

import { config } from "../../config.js";
import { detect, type Detected } from "./detect.js";
import { QmxService } from "./qmx.service.js";
import type { QrpRadio } from "./radio.interface.js";

/*
 * RadioManager: finds the transceiver and keeps the driver running.
 *
 *   searching   probe the serial ports with ID; + VN; every few seconds
 *   connected   driver running (it reconnects on its own after short
 *               interruptions)
 *
 * If the driver has had no connection or no answer for LOST_AFTER_MS
 * (cable moved to another radio, other USB port), it is stopped and the
 * search starts again. This way the box also works when the QMX is
 * swapped for a QMX+ (or a QDX).
 */

const SEARCH_INTERVAL_MS = 4000;
const LOST_AFTER_MS = 20_000;

export interface ManagerStatus {
    state: "searching" | "connected" | "unsupported";
    model: string | null;
    device: string;
    baudRate: number;
    id: string;
    message: string;
    since: number;
}


class RadioManager {

    private radio: QrpRadio | null = null;
    private found: Detected | null = null;
    private status: ManagerStatus = { state: "searching", model: null, device: "", baudRate: 0, id: "", message: "starting", since: Date.now() };
    private timer: NodeJS.Timeout | null = null;
    private searching = false;
    private stopped = false;
    private problemSince = 0;

    start(): void {
        this.stopped = false;
        void this.search();
        this.timer = setInterval(() => this.tick(), SEARCH_INTERVAL_MS);
    }

    stop(): void {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.radio?.stop();
        this.radio = null;
    }

    getRadio(): QrpRadio | null {
        return this.radio;
    }

    getStatus(): ManagerStatus {
        // QMX or QMX+ is known once the bands are known
        return this.radio ? { ...this.status, model: this.radio.getModel() } : { ...this.status };
    }

    private setStatus(patch: Partial<ManagerStatus>): void {
        const changed = patch.state !== undefined && patch.state !== this.status.state;
        this.status = { ...this.status, ...patch, ...(changed ? { since: Date.now() } : {}) };
    }

    private tick(): void {

        if (this.stopped) return;

        if (!this.radio) {
            void this.search();
            return;
        }

        // another radio on the same port: start over at once
        if (this.radio.isWrongRadio()) {
            console.log(`RADIO: another transceiver answers instead of the ${this.radio.getModel()} - searching again`);
            this.drop("other transceiver, searching");
            return;
        }

        // driver running: lost for good?
        const answering = this.radio.isConnected() && Date.now() - this.radio.getLastAnswerAt() < 5000;

        if (answering) {
            this.problemSince = 0;
            return;
        }

        if (!this.problemSince) this.problemSince = Date.now();

        if (Date.now() - this.problemSince > LOST_AFTER_MS) {
            console.log(`RADIO: ${this.radio.getModel()} lost - searching again`);
            this.drop("connection lost, searching");
        }

    }

    private drop(message: string): void {
        this.radio?.stop();
        this.radio = null;
        this.found = null;
        this.problemSince = 0;
        this.setStatus({ state: "searching", model: null, message });
        void this.search();
    }

    private async search(): Promise<void> {

        if (this.searching || this.radio || this.stopped) return;

        this.searching = true;

        try {

            let last = "";
            const found = await detect(config.cat.device, config.cat.baudRate, text => {
                last = text;
                this.setStatus({ message: text });
            });

            if (this.stopped) return;

            if (!found) {
                this.setStatus({ state: "searching", model: null, device: "", baudRate: 0, id: "", message: last || "no transceiver found" });
                return;
            }

            if (!found.kind) {
                // answers ID; like a Kenwood, but it is no QMX / QDX
                const name = `TS-480 compatible radio (ID${found.id}${found.version ? `, VN ${found.version}` : ""})`;
                if (this.status.state !== "unsupported" || this.status.id !== found.id) {
                    console.log(`RADIO: ${name} on ${found.device} - not a QMX`);
                }
                this.setStatus({ state: "unsupported", model: null, device: found.device, baudRate: found.baudRate, id: found.id, message: `${name} is not a QRP Labs QMX` });
                return;
            }

            const firmware = found.version ? ` firmware ${found.version}` : "";
            console.log(`RADIO: ${found.kind}${firmware} found on ${found.device}${realName(found.device)} @ ${found.baudRate}`);

            this.found = found;
            this.radio = new QmxService(found.device, found.baudRate, found.kind, config.qmx.bands);
            this.radio.start();
            this.problemSince = 0;

            this.setStatus({ state: "connected", model: found.kind, device: found.device, baudRate: found.baudRate, id: found.id, message: `${found.kind} on ${found.device}` });

        }
        catch (error) {
            this.setStatus({ message: (error as Error).message });
        }
        finally {
            this.searching = false;
        }

    }

    /* for the status API */
    getDetected(): Detected | null {
        return this.found;
    }

}

export const radioManager = new RadioManager();

/* " (/dev/ttyACM0)" for a /dev/serial/by-id name */
function realName(device: string): string {
    try {
        const real = fs.realpathSync(device);
        return real !== device ? ` (${real})` : "";
    }
    catch {
        return "";
    }
}
