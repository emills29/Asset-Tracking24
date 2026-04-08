const express = require('express');   // Web server framework
const cors = require('cors');         // Allows frontend to talk to backend
const axios = require('axios');       // Used to call Cisco Spaces API
require('dotenv').config();           // Loads .env variables

//  APP SETUP 

const app = express();
app.use(cors());              // Allow cross-origin requests 
app.use(express.json());      // Allows us to read JSON from ESP32

// CONFIG 

const PORT = process.env.PORT || 3000;

// Cisco Spaces API info 
const SPACES_BASE_URL = process.env.CISCO_SPACES_BASE_URL || 'https://dnaspaces.io';
const SPACES_TOKEN = process.env.CISCO_SPACES_TOKEN || '';

// How long before a tracker is considered "missing"
const HEARTBEAT_STALE_SECONDS = Number(process.env.HEARTBEAT_STALE_SECONDS || 45);

// STORAGE 

// Stores latest ESP32 heartbeat data 
const heartbeats = new Map();

// Maps MAC address → asset info 
const ASSET_REGISTRY = {
  'aa:bb:cc:dd:ee:ff': {
    assetId: 'A-101',
    name: 'Infusion Pump #1',
    type: 'Large Volume Infusion Pump',
    floorLabel: 'L1N',
    fallbackX: 0.42,
    fallbackY: 0.47,
    status: 'Available'
  }
};

// HELPER FUNCTIONS

// Makes MAC address lowercase + consistent
function normalizeMac(mac) {
  return String(mac || '').trim().toLowerCase();
}

// Calculates how long ago a heartbeat was sent
function secondsSince(isoString) {
  return Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
}

// Converts Cisco Spaces floor name → your frontend floor labels
function toViewFromHierarchy(hierarchy = '') {
  const text = String(hierarchy).toLowerCase();

  if (text.includes('north')) return 'L1N';
  if (text.includes('south')) return 'L1S';
  if (text.includes('3rd') || text.includes('floor 3')) return 'L3';
  if (text.includes('2nd') || text.includes('floor 2')) return 'L2';

  return 'L1N'; // default fallback
}

// Converts Cisco Spaces coordinates → screen-friendly (0–1)
function normalizeCoordinates(device, fallbackView, fallbackX, fallbackY) {

  const coords = Array.isArray(device?.coordinates) ? device.coordinates : null;

  // If NO Cisco data → use fallback
  if (!coords || coords.length < 2) {
    return { view: fallbackView, x: fallbackX, y: fallbackY, source: 'fallback' };
  }

  // Need to be tuned for real floor plan
  const FLOOR_SIZE = {
    L1N: { width: 250, height: 200 },
    L1S: { width: 250, height: 200 },
    L2:  { width: 250, height: 200 },
    L3:  { width: 250, height: 200 }
  };

  const view = toViewFromHierarchy(device.hierarchy || fallbackView);
  const size = FLOOR_SIZE[view] || FLOOR_SIZE.L1N;

  // Convert raw coordinates → % of screen
  const x = Math.max(0.02, Math.min(0.98, Number(coords[0]) / size.width));
  const y = Math.max(0.02, Math.min(0.98, Number(coords[1]) / size.height));

  return { view, x, y, source: 'cisco_spaces' };
}

//  ESP32 DATA RECEIVER 

// ESP32 sends data here
app.post('/api/heartbeat', (req, res) => {

  const macAddress = normalizeMac(req.body.macAddress);

  // If no MAC → reject
  if (!macAddress) {
    return res.status(400).json({ success: false, error: 'macAddress is required' });
  }

  const registry = ASSET_REGISTRY[macAddress] || {};

  // Save/update tracker info
  heartbeats.set(macAddress, {
    macAddress,
    assetId: req.body.assetId || registry.assetId || macAddress,
    name: req.body.name || registry.name || req.body.assetId || macAddress,
    type: req.body.type || registry.type || 'Tracked Asset',
    batteryPercent: Number.isFinite(req.body.batteryPercent) ? req.body.batteryPercent : null,
    status: req.body.status || registry.status || 'Available',
    floorLabel: req.body.floorLabel || registry.floorLabel || 'L1N',
    fallbackX: Number.isFinite(req.body.x) ? req.body.x : (registry.fallbackX ?? 0.5),
    fallbackY: Number.isFinite(req.body.y) ? req.body.y : (registry.fallbackY ?? 0.5),
    lastSeen: new Date().toISOString(),
    wifiRssi: Number.isFinite(req.body.rssi) ? req.body.rssi : null,
    ipAddress: req.body.ipAddress || null
  });

  res.json({ success: true });
});

//  CISCO SPACES API CALL 

async function getCiscoSpacesDevices() {

  // If no token → skip
  if (!SPACES_TOKEN) return [];

  try {
    const response = await axios.get(`${SPACES_BASE_URL}/api/location/v2/devices`, {
      headers: { Authorization: `Bearer ${SPACES_TOKEN}` },
      timeout: 10000
    });

    return Array.isArray(response.data?.results) ? response.data.results : [];

  } catch (error) {
    console.error('Cisco Spaces request failed:', error.response?.status || error.message);
    return [];
  }
}

// MAIN API FOR WEBSITE

// Website calls this to get asset positions
app.get('/api/assets', async (req, res) => {

  const devices = await getCiscoSpacesDevices();

  // Map Cisco devices by MAC address
  const devicesByMac = new Map(devices.map(d => [normalizeMac(d.macAddress), d]));

  const assets = [];

  // Combine ESP32 + Cisco Spaces
  for (const [macAddress, hb] of heartbeats.entries()) {

    const spacesDevice = devicesByMac.get(macAddress);

    // Get location (real OR fallback)
    const location = normalizeCoordinates(
      spacesDevice,
      hb.floorLabel,
      hb.fallbackX,
      hb.fallbackY
    );

    const ageSeconds = secondsSince(hb.lastSeen);
    const stale = ageSeconds > HEARTBEAT_STALE_SECONDS;

    assets.push({
      id: hb.assetId,
      assetId: hb.assetId,
      macAddress,
      name: hb.name,
      type: hb.type,
      status: hb.status,
      batteryPercent: hb.batteryPercent,

      // Position used by your frontend
      view: location.view,
      x: location.x,
      y: location.y,

      // If not updated recently → mark missing
      missing: stale || !spacesDevice,

      updatedText: stale
        ? `Last tag heartbeat ${ageSeconds}s ago`
        : 'Just now',

      // Extra Cisco data 
      locationSource: location.source,
      hierarchy: spacesDevice?.hierarchy || null,
      floorId: spacesDevice?.floorId || null,
      coordinates: spacesDevice?.coordinates || null,
      lastLocatedAt: spacesDevice?.lastLocatedAt || null,
      confidenceFactor: spacesDevice?.confidenceFactor || null,
      associated: spacesDevice?.associated ?? null
    });
  }

  res.json({
    success: true,
    syncedAt: new Date().toISOString(),
    count: assets.length,
    assets
  });
});

// HEALTH CHECK

// Quick test endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    serverTime: new Date().toISOString(),
    trackedTags: heartbeats.size,
    spacesEnabled: Boolean(SPACES_TOKEN)
  });
});

// START SERVER

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
