import type { QmxBandVersion } from "../../config.js";

/*
 * What the radio manager, the routes and the OLED need from a driver.
 * There is one driver (qmx.service.ts) for the QRP Labs radios:
 *
 *   QMX   QMX and QMX+ (same firmware, told apart by the bands)
 *   QDX   same CAT core, digital modes only (not tested yet)
 */

export type RadioKind = "QMX" | "QDX";

export interface QrpRadio {

    readonly kind: RadioKind;

    start(): void;
    stop(): void;

    isConnected(): boolean;
    getLastError(): string;

    /* another radio answers on the same port (VN; changed) */
    isWrongRadio(): boolean;

    /* time of the last valid answer (ms), 0 = never */
    getLastAnswerAt(): number;

    /* "QMX", "QMX+" or "QDX" */
    getModel(): string;

    getState(): Record<string, unknown>;
    control(control: string, value: unknown): void;

    setBandVersion(version: QmxBandVersion): void;

}
