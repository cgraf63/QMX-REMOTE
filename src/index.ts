import http from "node:http";

import { config } from "./config.js";
import { Router, sendJson, serveStatic } from "./http/server.js";
import { displayRoutes } from "./routes/display.js";
import { radioRoutes } from "./routes/radio.js";
import { updateRoutes } from "./routes/update.js";
import { wifiRoutes } from "./routes/wifi.js";
import { startAudioWebSocket } from "./services/audio/audio-ws.service.js";
import { radioManager } from "./services/radio/radio-manager.js";
import { updateService } from "./services/system/update.service.js";
import { WifiService } from "./services/wifi/wifi.service.js";

/*
 * QMX-REMOTE - browser remote for QRP Labs QMX / QMX+ (QDX)
 *
 *   /            remote page (QMX look: LCD, knob, CW decoder)
 *   /wifi.html   Wi-Fi setup (NetworkManager)
 *   /update.html software version and update (routes/update.ts)
 *   /api/...     radio state and control (routes/radio.ts)
 *   /audio       RX audio WebSocket (48 kHz, 16 bit, mono)
 *   /audio-tx    TX audio WebSocket (browser microphone, not used by the page yet)
 */

const wifi = new WifiService();

const router = new Router();
radioRoutes(router);
updateRoutes(router);
wifiRoutes(router, wifi);
displayRoutes(router, wifi);

const server = http.createServer((req, res) => {

    const url = new URL(req.url ?? "/", "http://localhost");

    void router.handle(req, res, url).then(handled => {
        if (handled) return;
        if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
        serveStatic(config.publicDir, req, res, url);
    });

});

server.on("error", error => {
    console.error("HTTP:", error.message);
    process.exit(1);
});

startAudioWebSocket(server);

server.listen(config.http.port, config.http.host, () => {
    console.log(`QMX-REMOTE listening on http://${config.http.host}:${config.http.port}`);
    radioManager.start();
    void updateService.start();
    void wifi.start();
});

/* never leave the radio transmitting (carrier, CW) when the server stops */
function shutdown(signal: string): void {
    console.log(`${signal}: stopping`);
    try {
        radioManager.getRadio()?.control("rx", true);
    }
    catch { /* not connected */ }
    setTimeout(() => {
        radioManager.stop();
        updateService.stop();
        wifi.stop();
        server.close();
        process.exit(0);
    }, 150);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
