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
// Edit lock: anyone on the network can watch the status, but once an admin password
// is set (Setup on the web page) every change needs it. Forgot it? Hold the BOOT
// button for 5 seconds while the drive is running: the password is cleared.

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include "web_ui.h"

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
float maxDiscRpm() { return MAX_MOTOR_RPM / S.ratio; }
String wifiSsid, wifiPass, adminPass;   // adminPass empty = not set yet, editing open
#if defined(CONFIG_IDF_TARGET_ESP32C3) || defined(CONFIG_IDF_TARGET_ESP32C6)
constexpr int PIN_BOOT = 9;
#else
constexpr int PIN_BOOT = 0;
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
    prefs.end();
    S.discs = constrain(S.discs, 2, 3);
}
void saveSoon() { saveAt = millis() + 2000; }   // debounce flash writes while sliders move
void saveNow() {
    prefs.begin("moire", false);
    prefs.putBytes("s3", &S, sizeof(Settings));
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
    char b[800];
    snprintf(b, sizeof b,
        "{\"l\":[%.3f,%.3f,%.3f],\"cur\":[%.3f,%.3f,%.3f],\"inv\":[%s,%s,%s],\"ok\":[%s,%s,%s],"
        "\"discs\":%d,\"motors\":%d,\"mode\":\"%s\",\"period\":%.1f,\"depth\":%.2f,\"drift\":%.2f,\"accel\":%.2f,"
        "\"current\":%u,\"running\":%s,\"driver\":\"%s\",\"maxDiscRpm\":%.2f,\"ratio\":%.2f,\"ap\":%s,\"locked\":%s,\"ip\":\"%s\"}",
        S.l[0], S.l[1], S.l[2], cur[0], cur[1], cur[2], tf(S.inv[0]), tf(S.inv[1]), tf(S.inv[2]), tf(ok[0]), tf(ok[1]), tf(ok[2]),
        activeDiscs(), MOTORS, modeName(S.mode), S.period, S.depth, S.drift, S.accel,
        S.current, tf(S.running), DRIVER_NAME, maxDiscRpm(), S.ratio,
        tf(apMode), tf(adminPass.length() > 0), (apMode ? WiFi.softAPIP() : WiFi.localIP()).toString().c_str());
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
    startWifi();
    server.on("/", [] { server.send_P(200, "text/html", WEB_UI); });
    server.on("/api/state", [] { cors(); server.send(200, "application/json", stateJson()); });
    server.on("/api/set", HTTP_GET, handleSet);
    server.on("/api/wifi", handleWifi);
    server.on("/api/password", handlePassword);
    server.on("/api/set", HTTP_OPTIONS, [] {          // browsers ask first when the generator sends an X-Key header
        cors(); server.sendHeader("Access-Control-Allow-Headers", "X-Key"); server.send(204);
    });
    const char* hdrs[] = { "X-Key" };
    server.collectHeaders(hdrs, 1);
    pinMode(PIN_BOOT, INPUT_PULLUP);
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
}
