import { BAND_VERSIONS, config, saveSettings, type QmxBandVersion } from "../config.js";
import { HttpError, Router, sendJson } from "../http/server.js";
import { radioManager } from "../services/radio/radio-manager.js";
import { QMX_BANDS, QMX_MODES, QMX_STEPS, QMX_VERSIONS } from "../services/radio/qmx.service.js";
import type { QrpRadio } from "../services/radio/radio.interface.js";

/*
 * /api/radio - the connected QMX / QMX+ (QDX)
 *
 *   GET  /api/status          server + detection status
 *   GET  /api/radio           state (409 while no radio is connected)
 *   GET  /api/radio/tables    modes, bands, tune steps, band versions
 *   POST /api/radio/control   { control, value }
 *   POST /api/radio/bands     { version: auto | 80-20 | 60-15 | 20-10 | plus }
 *                             which bands the QMX has, saved in config.json
 *   GET  /api/settings        { callsign }
 *   POST /api/settings        { callsign }   ({CALL} in the CW keys)
 */

const started = Date.now();

function radio(): QrpRadio {
    const r = radioManager.getRadio();
    if (!r) {
        const status = radioManager.getStatus();
        throw new HttpError(409, status.state === "unsupported" ? status.message : "No transceiver connected", { status });
    }
    return r;
}


export function radioRoutes(router: Router): void {

    router.get("/api/status", ({ res }) => {
        const r = radioManager.getRadio();
        sendJson(res, 200, {
            name: "QMX-REMOTE",
            uptime: Math.round((Date.now() - started) / 1000),
            radio: radioManager.getStatus(),
            connected: r ? r.isConnected() : false
        });
    });

    router.get("/api/radio", ({ res }) => {
        const r = radio();
        const status = radioManager.getStatus();
        sendJson(res, 200, { name: r.getModel(), device: status.device, ...r.getState() });
    });

    router.get("/api/radio/tables", ({ res }) => {
        sendJson(res, 200, {
            modes: Object.keys(QMX_MODES),
            bands: QMX_BANDS.map(({ name, start }) => ({ name, start })),
            steps: QMX_STEPS,
            versions: Object.entries(QMX_VERSIONS).map(([value, v]) => ({ value, label: v.label }))
        });
    });

    router.post("/api/radio/control", ({ res, body }) => {

        const r = radio();
        const { control, value } = body;

        if (typeof control !== "string" || !control) throw new HttpError(400, "control missing");

        try {
            r.control(control, value);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new HttpError(/not connected/i.test(message) ? 503 : 400, message);
        }

        sendJson(res, 200, { success: true, control, value });

    });

    router.post("/api/radio/bands", ({ res, body }) => {

        const version = String(body.version ?? "") as QmxBandVersion;
        if (!BAND_VERSIONS.includes(version)) throw new HttpError(400, "Unknown band version");

        try {
            saveSettings({ bands: version });
        }
        catch (error) {
            throw new HttpError(500, `config.json: ${(error as Error).message}`);
        }

        // applied without reconnecting; a radio found later gets it from the config
        radioManager.getRadio()?.setBandVersion(version);
        sendJson(res, 200, { success: true, version });

    });

    router.get("/api/settings", ({ res }) => {
        sendJson(res, 200, { callsign: config.callsign, bands: config.qmx.bands });
    });

    router.post("/api/settings", ({ res, body }) => {

        const callsign = String(body.callsign ?? "").trim().toUpperCase();
        if (!/^[A-Z0-9/]{0,12}$/.test(callsign)) throw new HttpError(400, "Callsign: letters, digits and /, at most 12");

        try {
            saveSettings({ callsign });
        }
        catch (error) {
            throw new HttpError(500, `config.json: ${(error as Error).message}`);
        }

        sendJson(res, 200, { success: true, callsign });

    });

}
