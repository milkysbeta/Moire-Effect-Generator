// Moiré disc drive
// ESP32 driving up to three 28BYJ-48 steppers, one per disc:
//   motor A → front disc  = Layer 1
//   motor B → second disc = Layer 2 (rear disc on a 2-disc build, middle disc on a 3-disc build)
//   motor C → rear disc   = Layer 3 (3-disc builds only)
// Speeds are disc rpm, positive = clockwise seen from the front. Each motor turns its
// disc through a gear pair: 15:45 on the centre spindle (3×), rim teeth on the edge drive
// (~13×; the generator's Send speeds sets it). The motor turns the opposite way.
//
// Driver options (pick the PlatformIO env):
//   ULN2003  the boards that ship with the motors. Half-stepping from a 4 kHz timer.
//            4 GPIOs per motor: a C3 SuperMini has pins for 2 motors; ESP32 / S3 for 3.
//   TMC2209  quiet StealthChop. The drivers make their own steps (VACTUAL) and share
//            one UART line (addresses 0, 1, 2). Motors need the bipolar mod.
//
// Web UI at http://moire.local (or the IP on the serial monitor). With no Wi-Fi
// saved, or if joining fails, it opens an access point "Moire-Setup"
// (password moiredisc) at http://192.168.4.1.
//
// Firmware updates without opening the case: the web page's Setup → Update firmware (upload the
// .bin from .pio/build/<env>/firmware.bin), or `pio run -e <env> -t upload --upload-port moire.local`
// (ArduinoOTA; uses the admin password when one is set).
//
// Edit lock: anyone on the network can watch the status, but once an admin password
// is set (Setup on the web page) every change needs it. Forgot it? Hold the BOOT
// button for 5 seconds while the drive is running: the password is cleared.
//
// Backlight (S3 env): a ring of WS2812B modules behind the diffuser, DIN on PIN_RING (GPIO 44, the RX pin)
// through 330 ohm. Glow, Breathe (with the breathe period) or Follow (a soft bright patch that turns with
// the front disc). Brightness is squared and capped, so it stays moody and well inside a 2 A charger.
// Panel button: double-tap = backlight on / off.

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <Update.h>
#include "web_ui.h"
#ifdef PIN_RING
#include <Adafruit_NeoPixel.h>
#endif

#if !defined(DRIVER_ULN2003) && !defined(DRIVER_TMC2209)
#define DRIVER_ULN2003
#endif

// ── Mechanics ────────────────────────────────────────────────────
constexpr float MOTOR_STEPS = 32.0f * 63.68395f;   // 28BYJ-48 full steps per output turn (~2038)
#ifdef DRIVER_TMC2209
constexpr float MAX_MOTOR_RPM = 18.0f;             // bipolar at 12 V
const char* DRIVER_NAME = "TMC2209";
constexpr int MOTORS = 3;
#else
constexpr float MAX_MOTOR_RPM = 12.0f;             // unipolar at 5 V starts skipping above ~13 rpm
const char* DRIVER_NAME = "ULN2003";
#ifdef ULN_M3
constexpr int MOTORS = 3;
#else
constexpr int MOTORS = 2;
#endif
#endif

// ── Settings (saved in flash) ────────────────────────────────────
enum Mode : uint8_t { STEADY = 0, BREATHE = 1, DRIFT = 2 };
struct Settings {
    float l[3] = { 1.0f, -1.0f, 0.5f };    // disc rpm per layer, + = clockwise from the front
    uint8_t discs = 2;                     // discs on this build (2 or 3)
    uint8_t mode = STEADY;
    float period = 60.0f;                  // breathe period, s
    float depth  = 0.5f;                   // breathe depth, 0..1
    float drift  = 0.4f;                   // drift amount, 0..1
    float accel  = 0.3f;                   // disc rpm per second
    uint16_t current = 150;                // mA RMS per motor (TMC2209 only)
    bool inv[3] = { false, false, false };
    bool running = true;
    float ratio = 3.0f;                    // motor turns per disc turn: 3 centre spindle (15:45), ~13 edge drive
    uint8_t version = 3;
} S;
enum LightMode : uint8_t { GLOW = 0, LBREATHE = 1, FOLLOW = 2 };
struct Light {
    bool on = true;
    float bri = 0.35f;                     // 0..1 (squared on the way out)
    float hue = 28.0f;                     // degrees; 28 = warm amber
    float sat = 0.8f;
    uint8_t mode = GLOW;
    uint8_t version = 1;
} LT;
#ifdef PIN_RING
constexpr int RING_N = RING_LEDS;
#else
constexpr int RING_N = 0;
#endif
float maxDiscRpm() { return MAX_MOTOR_RPM / S.ratio; }
String wifiSsid, wifiPass, adminPass;   // adminPass empty = not set yet, editing open
#if defined(CONFIG_IDF_TARGET_ESP32C3) || defined(CONFIG_IDF_TARGET_ESP32C6)
constexpr int PIN_BOOT = 9;
#else
constexpr int PIN_BOOT = 0;
#endif
// Panel button (to GND): tap = pause / play, hold 1 s = next motion mode
#ifndef PIN_BTN
#if defined(CONFIG_IDF_TARGET_ESP32C3) || defined(CONFIG_IDF_TARGET_ESP32C6)
#define PIN_BTN 20
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
#define PIN_BTN 14
#else
#define PIN_BTN 18
#endif
#endif
Preferences prefs;
WebServer server(80);

float cur[3] = { 0, 0, 0 };                // disc rpm being driven (after ramping)
bool ok[3] = { true, true, true };         // driver reachable (TMC2209 reports this)
bool apMode = false;
uint32_t saveAt = 0;
int activeDiscs() { return min((int)S.discs, MOTORS); }

// ════════════════════════════════════════════════════════════════
//  Motor backends: motorsBegin(), motorRpm(i, rpm), motorsSetCurrent(mA), motorsRetry()
// ════════════════════════════════════════════════════════════════
#ifdef DRIVER_ULN2003
#include "esp_timer.h"
#ifndef ULN_M1
#define ULN_M1 0, 1, 3, 4
#endif
#ifndef ULN_M2
#define ULN_M2 5, 6, 7, 10
#endif
#ifdef ULN_M3
const uint8_t ULN_PINS[3][4] = { { ULN_M1 }, { ULN_M2 }, { ULN_M3 } };
#else
const uint8_t ULN_PINS[2][4] = { { ULN_M1 }, { ULN_M2 } };
#endif
constexpr uint32_t ULN_TICK_US = 250;                         // 4 kHz
constexpr float HALF_STEPS = MOTOR_STEPS * 2;                 // ~4076 half-steps per turn
const uint8_t HALF_SEQ[8] = { 0b1000, 0b1100, 0b0100, 0b0110, 0b0010, 0b0011, 0b0001, 0b1001 };
volatile float ulnRate[3] = { 0, 0, 0 };                      // half-steps per tick, signed
float ulnAcc[3] = { 0, 0, 0 };
uint8_t ulnPhase[3] = { 0, 0, 0 };
bool ulnPowered[3] = { false, false, false };

void ulnWrite(int m, uint8_t bits) { for (int k = 0; k < 4; k++) digitalWrite(ULN_PINS[m][k], (bits >> (3 - k)) & 1); }
void ulnTick(void*) {
    for (int m = 0; m < MOTORS; m++) {
        float r = ulnRate[m];
        if (r == 0) {                                          // stopped: switch the coils off, they get hot
            if (ulnPowered[m]) { ulnWrite(m, 0); ulnPowered[m] = false; }
            continue;
        }
        if (!ulnPowered[m]) { ulnWrite(m, HALF_SEQ[ulnPhase[m]]); ulnPowered[m] = true; }
        ulnAcc[m] += r;
        while (ulnAcc[m] >= 1)  { ulnPhase[m] = (ulnPhase[m] + 1) & 7; ulnAcc[m] -= 1; ulnWrite(m, HALF_SEQ[ulnPhase[m]]); }
        while (ulnAcc[m] <= -1) { ulnPhase[m] = (ulnPhase[m] + 7) & 7; ulnAcc[m] += 1; ulnWrite(m, HALF_SEQ[ulnPhase[m]]); }
    }
}
void motorsBegin() {
    for (int m = 0; m < MOTORS; m++) for (uint8_t p : ULN_PINS[m]) { pinMode(p, OUTPUT); digitalWrite(p, LOW); }
    esp_timer_create_args_t a = {};
    a.callback = ulnTick; a.name = "uln";
    esp_timer_handle_t t;
    esp_timer_create(&a, &t);
    esp_timer_start_periodic(t, ULN_TICK_US);
    Serial.printf("ULN2003: %d motors\n", MOTORS);
}
void motorRpm(int i, float rpm) { if (i < MOTORS) ulnRate[i] = rpm / 60.0f * HALF_STEPS * ULN_TICK_US / 1e6f; }
void motorsSetCurrent(uint16_t) {}
void motorsRetry() {}
#endif

#ifdef DRIVER_TMC2209
#include <TMCStepper.h>
#ifndef PIN_TMC_TX
#define PIN_TMC_TX 7
#endif
#ifndef PIN_TMC_RX
#define PIN_TMC_RX 6
#endif
#ifndef PIN_TMC_EN
#define PIN_TMC_EN 10
#endif
constexpr float R_SENSE    = 0.11f;                            // BTT / FYSETC TMC2209 boards
constexpr int   MICROSTEPS = 16;
constexpr float VACTUAL_HZ = 12000000.0f / 16777216.0f;        // µsteps/s per VACTUAL unit
HardwareSerial& TMCSerial = Serial1;
TMC2209Stepper drv[3] = { TMC2209Stepper(&TMCSerial, R_SENSE, 0), TMC2209Stepper(&TMCSerial, R_SENSE, 1), TMC2209Stepper(&TMCSerial, R_SENSE, 2) };
int32_t lastV[3] = { INT32_MIN, INT32_MIN, INT32_MIN };

bool setupDriver(TMC2209Stepper& d) {
    d.begin();
    d.pdn_disable(true);           // PDN_UART pin is the UART, not power-down
    d.mstep_reg_select(true);      // microsteps from the register; MS1/MS2 set the address
    d.I_scale_analog(false);
    d.toff(4);
    d.blank_time(24);
    d.rms_current(S.current);
    d.ihold(4);                    // low hold current: the discs never need holding torque
    d.microsteps(MICROSTEPS);
    d.intpol(true);                // 256-step interpolation: smooth and quiet
    d.en_spreadCycle(false);       // StealthChop
    d.pwm_autoscale(true);
    d.VACTUAL(0);
    return d.test_connection() == 0;
}
void motorsBegin() {
    pinMode(PIN_TMC_EN, OUTPUT);
    digitalWrite(PIN_TMC_EN, LOW);                             // active low; idle current is set low anyway
    TMCSerial.begin(115200, SERIAL_8N1, PIN_TMC_RX, PIN_TMC_TX);
    delay(50);
    for (int i = 0; i < MOTORS; i++) {          // set up all three, so switching to 3 discs later just works
        ok[i] = setupDriver(drv[i]);
        Serial.printf("TMC2209 addr %d (motor %c): %s\n", i, 'A' + i, ok[i] ? "OK" : "NOT FOUND");
    }
}
void motorRpm(int i, float rpm) {
    if (i >= activeDiscs() || !ok[i]) return;
    int32_t v = (int32_t)lroundf(rpm / 60.0f * MOTOR_STEPS * MICROSTEPS / VACTUAL_HZ);
    if (v != lastV[i]) { drv[i].VACTUAL(v); lastV[i] = v; }
}
void motorsSetCurrent(uint16_t mA) { for (int i = 0; i < activeDiscs(); i++) drv[i].rms_current(mA); }
void motorsRetry() {                                           // drivers powered after the ESP32? try again
    static uint32_t last = 0;
    if (millis() - last < 5000) return;
    last = millis();
    for (int i = 0; i < activeDiscs(); i++) if (!ok[i]) { ok[i] = setupDriver(drv[i]); lastV[i] = INT32_MIN; }
}
#endif

// ── Persistence ──────────────────────────────────────────────────
void loadSettings() {
    prefs.begin("moire", true);
    Settings tmp;
    if (prefs.getBytesLength("s3") == sizeof(Settings)) { prefs.getBytes("s3", &tmp, sizeof(Settings)); if (tmp.version == 3) S = tmp; }
    wifiSsid = prefs.getString("ssid", "");
    wifiPass = prefs.getString("pass", "");
    adminPass = prefs.getString("admin", "");
    Light lt;
    if (prefs.getBytesLength("lt") == sizeof(Light)) { prefs.getBytes("lt", &lt, sizeof(Light)); if (lt.version == 1) LT = lt; }
    prefs.end();
    S.discs = constrain(S.discs, 2, 3);
}
void saveSoon() { saveAt = millis() + 2000; }   // debounce flash writes while sliders move
void saveNow() {
    prefs.begin("moire", false);
    prefs.putBytes("s3", &S, sizeof(Settings));
    prefs.putBytes("lt", &LT, sizeof(Light));
    prefs.end();
    saveAt = 0;
}

// ── Motion: targets from the mode, then a gentle ramp ────────────
float smoothNoise(float t, float seed) {   // smooth wander in -1..1 from incommensurate sines
    return (sinf(t * 0.0731f + seed) + 0.6f * sinf(t * 0.1913f + seed * 2.3f) + 0.35f * sinf(t * 0.4127f + seed * 4.1f)) / 1.95f;
}
float target(int i, float t) {
    if (!S.running || i >= activeDiscs()) return 0;
    float v = S.l[i];
    if (S.mode == BREATHE) v *= 1 + S.depth * sinf(2 * PI * t / max(5.0f, S.period) + i * PI / 2);   // each disc a quarter-cycle behind the last
    else if (S.mode == DRIFT) v *= 1 + S.drift * smoothNoise(t, 1.7f + i * 3.6f);
    return constrain(v, -maxDiscRpm(), maxDiscRpm());
}
void motionTick() {
    static uint32_t last = millis();
    uint32_t now = millis();
    float dt = (now - last) / 1000.0f; last = now;
    float step = max(0.01f, S.accel) * dt;
    for (int i = 0; i < 3; i++) {
        float tg = target(i, now / 1000.0f);
        cur[i] += constrain(tg - cur[i], -step, step);
        if (tg == 0 && fabsf(cur[i]) < 0.0005f) cur[i] = 0;
        motorRpm(i, (S.inv[i] ? 1 : -1) * cur[i] * S.ratio);   // gears reverse the direction
    }
}

// ── Web API ──────────────────────────────────────────────────────
const char* modeName(uint8_t m) { return m == BREATHE ? "breathe" : m == DRIFT ? "drift" : "steady"; }
const char* tf(bool b) { return b ? "true" : "false"; }
String stateJson() {
    char b[1000];
    snprintf(b, sizeof b,
        "{\"l\":[%.3f,%.3f,%.3f],\"cur\":[%.3f,%.3f,%.3f],\"inv\":[%s,%s,%s],\"ok\":[%s,%s,%s],"
        "\"discs\":%d,\"motors\":%d,\"mode\":\"%s\",\"period\":%.1f,\"depth\":%.2f,\"drift\":%.2f,\"accel\":%.2f,"
        "\"current\":%u,\"running\":%s,\"driver\":\"%s\",\"maxDiscRpm\":%.2f,\"ratio\":%.2f,\"ap\":%s,\"locked\":%s,\"ip\":\"%s\","
        "\"ring\":%d,\"lon\":%s,\"lbri\":%.2f,\"lhue\":%.0f,\"lsat\":%.2f,\"lmode\":\"%s\"}",
        S.l[0], S.l[1], S.l[2], cur[0], cur[1], cur[2], tf(S.inv[0]), tf(S.inv[1]), tf(S.inv[2]), tf(ok[0]), tf(ok[1]), tf(ok[2]),
        activeDiscs(), MOTORS, modeName(S.mode), S.period, S.depth, S.drift, S.accel,
        S.current, tf(S.running), DRIVER_NAME, maxDiscRpm(), S.ratio,
        tf(apMode), tf(adminPass.length() > 0), (apMode ? WiFi.softAPIP() : WiFi.localIP()).toString().c_str(),
        RING_N, tf(LT.on), LT.bri, LT.hue, LT.sat, LT.mode == LBREATHE ? "breathe" : LT.mode == FOLLOW ? "follow" : "glow");
    return b;
}
void cors() { server.sendHeader("Access-Control-Allow-Origin", "*"); server.sendHeader("Cache-Control", "no-store"); }
bool argF(const char* k, float& v, float lo, float hi) {
    if (!server.hasArg(k)) return false;
    float x = server.arg(k).toFloat();
    if (isnan(x)) return false;
    v = constrain(x, lo, hi); return true;
}
bool argB(const char* k, bool& v) {
    if (!server.hasArg(k)) return false;
    String a = server.arg(k); v = (a == "1" || a == "true" || a == "on"); return true;
}
// ── Edit lock ────────────────────────────────────────────────────
// The key arrives as ?key= or an X-Key header. Five wrong tries lock edits for 30 s.
uint8_t badTries = 0;
uint32_t lockoutUntil = 0;
bool sameText(const String& a, const String& b) {            // compare without leaking where they differ
    uint8_t d = a.length() != b.length();
    for (size_t i = 0; i < a.length(); i++) d |= a[i] ^ (i < b.length() ? b[i] : 0);
    return d == 0;
}
bool authorised() {
    if (!adminPass.length()) return true;
    if (lockoutUntil && (int32_t)(millis() - lockoutUntil) < 0) {
        cors(); server.send(429, "application/json", "{\"error\":\"too many tries, wait 30 s\"}"); return false;
    }
    String k = server.hasArg("key") ? server.arg("key") : server.header("X-Key");
    if (sameText(k, adminPass)) { badTries = 0; return true; }
    if (++badTries >= 5) { badTries = 0; lockoutUntil = millis() + 30000; }
    cors(); server.send(401, "application/json", "{\"error\":\"locked\"}");
    return false;
}
void handlePassword() {          // ?key=<current>&new=<new>; new empty removes the lock
    if (!authorised()) return;
    String n = server.arg("new");
    if (n.length() && (n.length() < 4 || n.length() > 63)) { cors(); server.send(400, "application/json", "{\"error\":\"use 4 to 63 characters\"}"); return; }
    adminPass = n;
    prefs.begin("moire", false); prefs.putString("admin", adminPass); prefs.end();
    cors(); server.send(200, "application/json", stateJson());
}
void checkPanelButton() {
    static bool down = false, held = false;
    static uint32_t since = 0, lastEdge = 0;
    bool now = digitalRead(PIN_BTN) == LOW;
    if (now != down && millis() - lastEdge > 30) {            // 30 ms debounce
        lastEdge = millis(); down = now;
        if (down) { since = millis(); held = false; }
        else if (!held) {
            static uint32_t lastTap = 0;
            if (RING_N && millis() - lastTap < 400) { S.running = !S.running; LT.on = !LT.on; lastTap = 0; }   // double-tap: undo the pause, flip the light
            else { S.running = !S.running; lastTap = millis(); }
            saveSoon();
        }
    }
    if (down && !held && millis() - since > 1000) {
        held = true; S.mode = (S.mode + 1) % 3; saveSoon();
        Serial.printf("Button: mode %s\n", modeName(S.mode));
    }
}
// Status LED (S3 SuperMini's RGB on GPIO 48): green running, amber paused, blue setup hotspot
void statusLed() {
#ifdef PIN_RGB
    static uint32_t last = 0;
    if (millis() - last < 250) return;
    last = millis();
    if (apMode) neopixelWrite(PIN_RGB, 0, 0, 24);
    else if (S.running) neopixelWrite(PIN_RGB, 0, 18, 0);
    else neopixelWrite(PIN_RGB, 20, 10, 0);
#endif
}
// ── Backlight ring ───────────────────────────────────────────────
#ifdef PIN_RING
Adafruit_NeoPixel ring(RING_LEDS, PIN_RING, NEO_GRB + NEO_KHZ800);
void hsv(float h, float s, float v, uint8_t& r, uint8_t& g, uint8_t& b) {
    h = fmodf(fmodf(h, 360) + 360, 360) / 60; int i = (int)h; float f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    float R, G, B;
    switch (i) { case 0: R = v; G = t; B = p; break; case 1: R = q; G = v; B = p; break; case 2: R = p; G = v; B = t; break;
                 case 3: R = p; G = q; B = v; break; case 4: R = t; G = p; B = v; break; default: R = v; G = p; B = q; }
    r = R * 255; g = G * 255; b = B * 255;
}
void ringTick() {
    static uint32_t last = 0;
    static float phase = 0, fade = 0;
    uint32_t now = millis();
    if (now - last < 40) return;
    float dt = (now - last) / 1000.0f; last = now;
    if (dt > 1) dt = 0.04f;
    phase += cur[0] * 6.0f * dt;                                   // degrees: follows the front disc
    fade += constrain((LT.on ? 1.0f : 0.0f) - fade, -dt / 1.5f, dt / 1.5f);   // 1.5 s fade on / off
    float base = LT.bri * fade, t = now / 1000.0f;
    if (LT.mode == LBREATHE) base *= 0.55f + 0.45f * sinf(2 * PI * t / max(5.0f, S.period));
    for (int i = 0; i < RING_LEDS; i++) {
        float h = LT.hue, v = base;
        if (LT.mode == FOLLOW) {
            float a = (i * 360.0f / RING_LEDS - phase) * PI / 180;
            v *= 0.35f + 0.65f * (0.5f + 0.5f * cosf(a)); h += 14 * sinf(a);
        }
        v = min(v * v, 0.6f);                                         // perceptual, and never past ~60 % (about 0.6 A for 16)
        uint8_t r, g, b; hsv(h, LT.sat, v, r, g, b);
        ring.setPixelColor(i, r, g, b);
    }
    ring.show();
}
#else
void ringTick() {}
#endif
// POST /update?key=… with the firmware .bin as the body (multipart form from the web page)
void handleUpdateDone() {
    bool ok = !Update.hasError();
    cors(); server.send(ok ? 200 : 500, "text/plain", ok ? "Updated. Restarting…" : "Update failed");
    if (ok) { delay(500); ESP.restart(); }
}
bool updateAllowed = false;
void handleUpdateUpload() {
    HTTPUpload& up = server.upload();
    if (up.status == UPLOAD_FILE_START) {
        updateAllowed = !adminPass.length() || sameText(server.arg("key"), adminPass);
        if (updateAllowed) { Serial.printf("Update: %s\n", up.filename.c_str()); Update.begin(UPDATE_SIZE_UNKNOWN); }
    } else if (!updateAllowed) {
        return;
    } else if (up.status == UPLOAD_FILE_WRITE) {
        Update.write(up.buf, up.currentSize);
    } else if (up.status == UPLOAD_FILE_END) {
        Update.end(true);
    }
}
void checkBootButton() {         // hold BOOT 5 s: clear the admin password
    static uint32_t downSince = 0;
    if (digitalRead(PIN_BOOT) == LOW) {
        if (!downSince) downSince = millis();
        else if (millis() - downSince > 5000 && adminPass.length()) {
            adminPass = "";
            prefs.begin("moire", false); prefs.remove("admin"); prefs.end();
            Serial.println("BOOT held: admin password cleared");
        }
    } else downSince = 0;
}

void handleSet() {
    if (!authorised()) return;
    bool ch = false;
    const char* lk[3] = { "l1", "l2", "l3" };
    const char* ik[3] = { "inv1", "inv2", "inv3" };
    for (int i = 0; i < 3; i++) { ch |= argF(lk[i], S.l[i], -maxDiscRpm(), maxDiscRpm()); ch |= argB(ik[i], S.inv[i]); }
    ch |= argF("front", S.l[0], -maxDiscRpm(), maxDiscRpm());  // older name for l1
    if (argF("ratio", S.ratio, 1, 40)) ch = true;               // sent by the generator for the chosen drive
    float dsc = S.discs;
    if (argF("discs", dsc, 2, 3)) { S.discs = (uint8_t)lroundf(dsc); ch = true; }
    ch |= argF("period", S.period, 5, 600);
    ch |= argF("depth",  S.depth,  0, 1);
    ch |= argF("drift",  S.drift,  0, 1);
    ch |= argF("accel",  S.accel,  0.02, 5);
    ch |= argB("run", S.running);
    if (server.hasArg("mode")) {
        String m = server.arg("mode");
        S.mode = m == "breathe" ? BREATHE : m == "drift" ? DRIFT : STEADY; ch = true;
    }
    float c = S.current;
    if (argF("current", c, 50, 400)) { S.current = (uint16_t)c; motorsSetCurrent(S.current); ch = true; }
    ch |= argB("lon", LT.on);
    ch |= argF("lbri", LT.bri, 0, 1);
    ch |= argF("lhue", LT.hue, 0, 360);
    ch |= argF("lsat", LT.sat, 0, 1);
    if (server.hasArg("lmode")) { String m = server.arg("lmode"); LT.mode = m == "breathe" ? LBREATHE : m == "follow" ? FOLLOW : GLOW; ch = true; }
    if (ch) saveSoon();
    cors(); server.send(200, "application/json", stateJson());
}
void handleWifi() {
    if (!authorised()) return;
    if (!server.hasArg("ssid") || !server.arg("ssid").length()) { server.send(400, "text/plain", "ssid missing"); return; }
    prefs.begin("moire", false);
    prefs.putString("ssid", server.arg("ssid"));
    prefs.putString("pass", server.arg("pass"));
    prefs.end();
    server.send(200, "text/html", "<meta name=viewport content='width=device-width'><body style='font:16px system-ui;background:#111;color:#eee;padding:24px'>Saved. Restarting and joining the network&hellip; Then open <b>http://moire.local</b>.</body>");
    delay(800);
    ESP.restart();
}

void startWifi() {
    if (wifiSsid.length()) {
        WiFi.mode(WIFI_STA);
        WiFi.setHostname("moire");
        WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
        Serial.printf("Joining %s", wifiSsid.c_str());
        for (int i = 0; i < 60 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print('.'); }
        Serial.println();
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("Connected: http://%s  (http://moire.local)\n", WiFi.localIP().toString().c_str());
        MDNS.begin("moire");
        MDNS.addService("http", "tcp", 80);
    } else {
        apMode = true;
        WiFi.mode(WIFI_AP);
        WiFi.softAP("Moire-Setup", "moiredisc");
        Serial.printf("Access point Moire-Setup (password moiredisc): http://%s\n", WiFi.softAPIP().toString().c_str());
    }
}

void setup() {
    Serial.begin(115200);
    delay(300);
    loadSettings();
    motorsBegin();
#ifdef PIN_RING
    ring.begin(); ring.clear(); ring.show();
#endif
    startWifi();
    server.on("/", [] { server.send_P(200, "text/html", WEB_UI); });
    server.on("/api/state", [] { cors(); server.send(200, "application/json", stateJson()); });
    server.on("/api/set", HTTP_GET, handleSet);
    server.on("/api/wifi", handleWifi);
    server.on("/api/password", handlePassword);
    // add-to-home-screen: name, colours and a moiré icon
    server.on("/manifest.json", [] { server.send(200, "application/manifest+json",
        "{\"name\":\"Moiré drive\",\"short_name\":\"Moiré\",\"start_url\":\"/\",\"display\":\"standalone\","
        "\"background_color\":\"#111214\",\"theme_color\":\"#111214\",\"icons\":[{\"src\":\"/icon.svg\",\"sizes\":\"any\",\"type\":\"image/svg+xml\"}]}"); });
    server.on("/icon.svg", [] { server.send(200, "image/svg+xml",
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#111214'/>"
        "<g fill='none' stroke='#f59e0b' stroke-width='2'><circle cx='29' cy='32' r='6'/><circle cx='29' cy='32' r='13'/><circle cx='29' cy='32' r='20'/></g>"
        "<g fill='none' stroke='#ececec' stroke-width='2'><circle cx='35' cy='32' r='6'/><circle cx='35' cy='32' r='13'/><circle cx='35' cy='32' r='20'/></g></svg>"); });
    server.on("/api/set", HTTP_OPTIONS, [] {          // browsers ask first when the generator sends an X-Key header
        cors(); server.sendHeader("Access-Control-Allow-Headers", "X-Key"); server.send(204);
    });
    const char* hdrs[] = { "X-Key" };
    server.collectHeaders(hdrs, 1);
    pinMode(PIN_BOOT, INPUT_PULLUP);
    pinMode(PIN_BTN, INPUT_PULLUP);
    server.on("/update", HTTP_POST, [] { if (!updateAllowed) { cors(); server.send(401, "text/plain", "locked"); return; } handleUpdateDone(); }, handleUpdateUpload);
    ArduinoOTA.setHostname("moire");
    if (adminPass.length()) ArduinoOTA.setPassword(adminPass.c_str());
    ArduinoOTA.begin();
    server.onNotFound([] { cors(); server.send(404, "text/plain", "not found"); });
    server.begin();
}

void loop() {
    server.handleClient();
    static uint32_t lastTick = 0;
    if (millis() - lastTick >= 20) { lastTick = millis(); motionTick(); }
    if (saveAt && millis() > saveAt) saveNow();
    motorsRetry();
    checkBootButton();
    checkPanelButton();
    ArduinoOTA.handle();
    statusLed();
    ringTick();
}
