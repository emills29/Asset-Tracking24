#include <WiFi.h>        // Library to connect ESP32 to WiFi
#include <HTTPClient.h>  // Library to send HTTP requests (POST to backend)

// ====================== WIFI + SERVER CONFIG ======================

// Your WiFi credentials (same network as your backend ideally)
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// URL of your backend server that receives tracker data
const char* BACKEND_URL = "http://YOUR_COMPUTER_IP:3000/api/heartbeat";

// ====================== ASSET INFORMATION ======================

// Unique ID for this piece of equipment
const char* ASSET_ID = "A-101";

// Name shown on your website
const char* ASSET_NAME = "Infusion Pump #1";

// Type/category of equipment
const char* ASSET_TYPE = "Large Volume Infusion Pump";

// Fallback floor (used if Cisco Spaces data is unavailable)
const char* FLOOR_LABEL = "L1N";

// ====================== BATTERY SETTINGS ======================

// Analog pin for battery reading (depends on your board wiring)
const int BATTERY_PIN = A0;

// Set to true ONLY if you actually wired a battery reader
const bool HAS_BATTERY_READER = false;

// ====================== TIMING ======================

// Stores last time we sent data
unsigned long lastPost = 0;

// How often to send data (milliseconds)
const unsigned long POST_INTERVAL_MS = 5000;

// ====================== BATTERY FUNCTIONS ======================

// Reads battery voltage from analog pin
float readBatteryVoltage() {
  if (!HAS_BATTERY_READER) return -1.0; // Skip if not enabled

  int raw = analogRead(BATTERY_PIN);   // Read analog value (0–4095)
  
  // Convert to voltage (adjust multiplier depending on voltage divider)
  float voltage = ((float)raw / 4095.0f) * 3.3f * 2.0f;

  return voltage;
}

// Converts voltage to percentage (approximation)
int batteryPercentFromVoltage(float v) {
  if (v < 0) return -1;     // No reading
  if (v >= 4.2f) return 100; // Fully charged
  if (v <= 3.2f) return 0;   // Dead

  // Linear interpolation between 3.2V–4.2V
  return (int)(((v - 3.2f) / (4.2f - 3.2f)) * 100.0f);
}

// ====================== WIFI CONNECTION ======================

// Connects ESP32 to WiFi
void connectWifi() {
  WiFi.mode(WIFI_STA); // Set to station mode (client)
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");

  // Wait until connected
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");

  // Print useful debugging info
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  Serial.print("MAC: ");
  Serial.println(WiFi.macAddress()); // IMPORTANT: used by Cisco Spaces
}

// ====================== SEND DATA TO BACKEND ======================

// Sends asset data (heartbeat) to your server
void postHeartbeat() {

  // If WiFi dropped, reconnect
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    return;
  }

  HTTPClient http;

  // Start HTTP connection
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");

  // Get battery info
  float batteryVoltage = readBatteryVoltage();
  int batteryPercent = batteryPercentFromVoltage(batteryVoltage);

  // ====================== BUILD JSON PAYLOAD ======================

  String payload = "{";

  payload += "\"assetId\":\"" + String(ASSET_ID) + "\",";
  payload += "\"name\":\"" + String(ASSET_NAME) + "\",";
  payload += "\"type\":\"" + String(ASSET_TYPE) + "\",";

  // Used by your frontend if Cisco Spaces location is missing
  payload += "\"floorLabel\":\"" + String(FLOOR_LABEL) + "\",";

  // VERY IMPORTANT: this MAC is what Cisco Spaces tracks
  payload += "\"macAddress\":\"" + WiFi.macAddress() + "\",";

  // Useful debugging info
  payload += "\"ipAddress\":\"" + WiFi.localIP().toString() + "\",";
  payload += "\"rssi\":" + String(WiFi.RSSI()) + ",";

  // Hardcoded status (you can make this dynamic later)
  payload += "\"status\":\"Available\",";

  // Battery (if available)
  if (batteryPercent >= 0) {
    payload += "\"batteryPercent\":" + String(batteryPercent);
  } else {
    payload += "\"batteryPercent\":null";
  }

  payload += "}";

  // ====================== SEND REQUEST ======================

  int code = http.POST(payload);     // Send POST request
  String response = http.getString(); // Get server response

  // Debug output
  Serial.print("POST code: ");
  Serial.println(code);
  Serial.println(response);

  http.end(); // Close connection
}

// ====================== SETUP ======================

void setup() {
  Serial.begin(115200); // Start serial monitor
  delay(1000);

  connectWifi(); // Connect to WiFi at startup
}

// ====================== MAIN LOOP ======================

void loop() {

  // Send data every X milliseconds (non-blocking)
  if (millis() - lastPost >= POST_INTERVAL_MS) {
    lastPost = millis();
    postHeartbeat();
  }
}