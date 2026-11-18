// Moiré disc drive
// ESP32 driving two 28BYJ-48 steppers: front disc = Layer 1 in the generator,
// rear disc = Layer 2. Speeds are in disc rpm, positive = clockwise seen from the
// front. Each motor turns its disc through a 15:45 gear pair, so the motor runs
// 3× faster and the opposite way.
//
// Two driver options (pick the PlatformIO env):
//   ULN2003  the boards that ship with the motors. Half-stepping from a 4 kHz timer.
//            Simple, no mods, a little buzzy.
//   TMC2209  quiet StealthChop. The drivers make their own steps (VACTUAL), so the
//            wiring is one UART line + enable. Motors need the bipolar mod.
//
// Web UI at http://moire.local (or the IP on the serial monitor). With no Wi-Fi
// saved, or if joining fails, it opens an access point "Moire-Setup"
// (password moiredisc) at http://192.168.4.1.

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
constexpr float GEAR_RATIO  = 45.0f / 15.0f;       // motor turns per disc turn
#ifdef DRIVER_TMC2209
constexpr float MAX_MOTOR_RPM = 18.0f;             // bipolar at 12 V
const char* DRIVER_NAME = "TMC2209";
#else
constexpr float MAX_MOTOR_RPM = 12.0f;             // unipolar at 5 V starts skipping above ~13 rpm
const char* DRIVER_NAME = "ULN2003";
#endif
constexpr float MAX_DISC_RPM = MAX_MOTOR_RPM / GEAR_RATIO;

// ── Settings (saved in flash) ────────────────────────────────────
enum Mode : uint8_t { STEADY = 0, BREATHE = 1, DRIFT = 2 };
struct Settings {
    float front = 1.0f, rear = -1.0f;      // disc rpm, + = clockwise from the front
    uint8_t mode = STEADY;
    float period = 60.0f;                  // breathe period, s
    float depth  = 0.5f;                   // breathe depth, 0..1
    float drift  = 0.4f;                   // drift amount, 0..1
    float accel  = 0.3f;                   // disc rpm per second
    uint16_t current = 150;                // mA RMS per motor (TMC2209 only)
    bool invFront = false, invRear = false;
    bool running = true;
} S;
String wifiSsid, wifiPass;
Preferences prefs;
WebServer server(80);

float curFront = 0, curRear = 0;           // disc rpm being driven (after ramping)
bool okFront = true, okRear = true;        // driver reachable (TMC2209 reports this)
bool apMode = false;
uint32_t saveAt = 0;

// ════════════════════════════════════════════════════════════════
//  Motor backends: motorsBegin(), motorRpm(i, rpm), motorsSetCurrent(mA)
// ════════════════════════════════════════════════════════════════
#ifdef DRIVER_ULN2003
#include "esp_timer.h"
#ifndef ULN_FRONT
#define ULN_FRONT 0, 1, 3, 4
#endif
#ifndef ULN_REAR
#define ULN_REAR 5, 6, 7, 10
#endif
const uint8_t ULN_PINS[2][4] = { { ULN_FRONT }, { ULN_REAR } };
constexpr uint32_t ULN_TICK_US = 250;                         // 4 kHz
constexpr float HALF_STEPS = MOTOR_STEPS * 2;                 // ~4076 half-steps per turn
const uint8_t HALF_SEQ[8] = { 0b1000, 0b1100, 0b0100, 0b0110, 0b0010, 0b0011, 0b0001, 0b1001 };
volatile float ulnRate[2] = { 0, 0 };                         // half-steps per tick, signed
float ulnAcc[2] = { 0, 0 };
uint8_t ulnPhase[2] = { 0, 0 };
bool ulnPowered[2] = { false, false };

void ulnWrite(int m, uint8_t bits) { for (int k = 0; k < 4; k++) digitalWrite(ULN_PINS[m][k], (bits >> (3 - k)) & 1); }
void ulnTick(void*) {
    for (int m = 0; m < 2; m++) {
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
    for (auto& m : ULN_PINS) for (uint8_t p : m) { pinMode(p, OUTPUT); digitalWrite(p, LOW); }
    esp_timer_create_args_t a = {};
    a.callback = ulnTick; a.name = "uln";
    esp_timer_handle_t t;
    esp_timer_create(&a, &t);
    esp_timer_start_periodic(t, ULN_TICK_US);
    Serial.println("ULN2003 drivers ready");
}
void motorRpm(int i, float rpm) { ulnRate[i] = rpm / 60.0f * HALF_STEPS * ULN_TICK_US / 1e6f; }
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
TMC2209Stepper drv[2] = { TMC2209Stepper(&TMCSerial, R_SENSE, 0), TMC2209Stepper(&TMCSerial, R_SENSE, 1) };
int32_t lastV[2] = { INT32_MIN, INT32_MIN };

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
    okFront = setupDriver(drv[0]);
    okRear  = setupDriver(drv[1]);
    Serial.printf("TMC2209 front (addr 0): %s, rear (addr 1): %s\n", okFront ? "OK" : "NOT FOUND", okRear ? "OK" : "NOT FOUND");
}
void motorRpm(int i, float rpm) {
    int32_t v = (int32_t)lroundf(rpm / 60.0f * MOTOR_STEPS * MICROSTEPS / VACTUAL_HZ);
    if (v != lastV[i]) { drv[i].VACTUAL(v); lastV[i] = v; }
}
void motorsSetCurrent(uint16_t mA) { drv[0].rms_current(mA); drv[1].rms_current(mA); }
void motorsRetry() {                                           // drivers powered after the ESP32? try again
    static uint32_t last = 0;
    if ((okFront && okRear) || millis() - last < 5000) return;
    last = millis();
    if (!okFront) { okFront = setupDriver(drv[0]); lastV[0] = INT32_MIN; }
    if (!okRear)  { okRear  = setupDriver(drv[1]); lastV[1] = INT32_MIN; }
}
#endif

// ── Persistence ──────────────────────────────────────────────────
void loadSettings() {
    prefs.begin("moire", true);
    if (prefs.getBytesLength("s") == sizeof(Settings)) prefs.getBytes("s", &S, sizeof(Settings));
    wifiSsid = prefs.getString("ssid", "");
    wifiPass = prefs.getString("pass", "");
    prefs.end();
}
void saveSoon() { saveAt = millis() + 2000; }   // debounce flash writes while sliders move
void saveNow() {
    prefs.begin("moire", false);
    prefs.putBytes("s", &S, sizeof(Settings));
    prefs.end();
    saveAt = 0;
}

// ── Motion: targets from the mode, then a gentle ramp ────────────
float smoothNoise(float t, float seed) {   // smooth wander in -1..1 from incommensurate sines
    return (sinf(t * 0.0731f + seed) + 0.6f * sinf(t * 0.1913f + seed * 2.3f) + 0.35f * sinf(t * 0.4127f + seed * 4.1f)) / 1.95f;
}
void targets(float t, float& f, float& r) {
    f = S.front; r = S.rear;
    if (!S.running) { f = r = 0; return; }
    if (S.mode == BREATHE) {
        float w = 2 * PI * t / max(5.0f, S.period);
        f *= 1 + S.depth * sinf(w);
        r *= 1 + S.depth * sinf(w + PI / 2);       // rear lags a quarter cycle
    } else if (S.mode == DRIFT) {
        f *= 1 + S.drift * smoothNoise(t, 1.7f);
        r *= 1 + S.drift * smoothNoise(t, 5.3f);
    }
    f = constrain(f, -MAX_DISC_RPM, MAX_DISC_RPM);
    r = constrain(r, -MAX_DISC_RPM, MAX_DISC_RPM);
}
float discToMotor(float discRpm, bool invert) { return (invert ? 1 : -1) * discRpm * GEAR_RATIO; }  // gears reverse direction
void motionTick() {
    static uint32_t last = millis();
    uint32_t now = millis();
    float dt = (now - last) / 1000.0f; last = now;
    float tf, tr; targets(now / 1000.0f, tf, tr);
    float step = max(0.01f, S.accel) * dt;
    curFront += constrain(tf - curFront, -step, step);
    curRear  += constrain(tr - curRear,  -step, step);
    if (fabsf(curFront) < 0.0005f && tf == 0) curFront = 0;
    if (fabsf(curRear)  < 0.0005f && tr == 0) curRear = 0;
    motorRpm(0, discToMotor(curFront, S.invFront));
    motorRpm(1, discToMotor(curRear,  S.invRear));
}

// ── Web API ──────────────────────────────────────────────────────
const char* modeName(uint8_t m) { return m == BREATHE ? "breathe" : m == DRIFT ? "drift" : "steady"; }
String stateJson() {
    char b[700];
    snprintf(b, sizeof b,
        "{\"front\":%.3f,\"rear\":%.3f,\"curFront\":%.3f,\"curRear\":%.3f,\"mode\":\"%s\",\"period\":%.1f,\"depth\":%.2f,"
        "\"drift\":%.2f,\"accel\":%.2f,\"current\":%u,\"invFront\":%s,\"invRear\":%s,\"running\":%s,"
        "\"driver\":\"%s\",\"driverFront\":%s,\"driverRear\":%s,\"maxDiscRpm\":%.2f,\"ratio\":%.1f,\"ap\":%s,\"ip\":\"%s\"}",
        S.front, S.rear, curFront, curRear, modeName(S.mode), S.period, S.depth, S.drift, S.accel, S.current,
        S.invFront ? "true" : "false", S.invRear ? "true" : "false", S.running ? "true" : "false",
        DRIVER_NAME, okFront ? "true" : "false", okRear ? "true" : "false", MAX_DISC_RPM, GEAR_RATIO,
        apMode ? "true" : "false", (apMode ? WiFi.softAPIP() : WiFi.localIP()).toString().c_str());
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
void handleSet() {
    bool ch = false;
    ch |= argF("front", S.front, -MAX_DISC_RPM, MAX_DISC_RPM);
    ch |= argF("rear",  S.rear,  -MAX_DISC_RPM, MAX_DISC_RPM);
    ch |= argF("period", S.period, 5, 600);
    ch |= argF("depth",  S.depth,  0, 1);
    ch |= argF("drift",  S.drift,  0, 1);
    ch |= argF("accel",  S.accel,  0.02, 5);
    ch |= argB("invFront", S.invFront);
    ch |= argB("invRear",  S.invRear);
    ch |= argB("run", S.running);
    if (server.hasArg("mode")) {
        String m = server.arg("mode");
        S.mode = m == "breathe" ? BREATHE : m == "drift" ? DRIFT : STEADY; ch = true;
    }
    float cur = S.current;
    if (argF("current", cur, 50, 400)) { S.current = (uint16_t)cur; motorsSetCurrent(S.current); ch = true; }
    if (ch) saveSoon();
    cors(); server.send(200, "application/json", stateJson());
}
void handleWifi() {
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
    server.on("/api/set", handleSet);
    server.on("/api/wifi", handleWifi);
    server.onNotFound([] { cors(); server.send(404, "text/plain", "not found"); });
    server.begin();
}

void loop() {
    server.handleClient();
    static uint32_t lastTick = 0;
    if (millis() - lastTick >= 20) { lastTick = millis(); motionTick(); }
    if (saveAt && millis() > saveAt) saveNow();
    motorsRetry();
}
