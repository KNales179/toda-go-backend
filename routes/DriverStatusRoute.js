const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const requireUserAuth = require('../middleware/requireUserAuth');
const Driver = require('../models/Drivers');
const DriverStatus = require('../models/DriverStatus');
const DriverPresence = require('../models/DriverPresence');
const DriverMeter = require('../models/DriverMeter');

// --- helpers ---
router.use(requireUserAuth);
const isObjectId = (s) => mongoose.Types.ObjectId.isValid(String(s || ''));

function sanitizeCap(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 4;
  return Math.min(6, Math.max(1, Math.round(x)));
}

function normalizeLocation(loc) {
  if (!loc || typeof loc !== 'object') return { latitude: 0, longitude: 0 };
  const lat = Number(loc.lat ?? loc.latitude ?? 0);
  const lng = Number(loc.lng ?? loc.longitude ?? 0);
  return { latitude: lat, longitude: lng };
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 🔹 presence writer: extend last 10-min window or create a new one
async function touchPresence(driverId, when = new Date()) {
  const tenMinAgo = new Date(when.getTime() - 10 * 60 * 1000);
  const last = await DriverPresence.findOne({
    driverId: String(driverId),
    endAt: { $gte: tenMinAgo },
  }).sort({ endAt: -1 });

  if (last) {
    await DriverPresence.updateOne({ _id: last._id }, { $set: { endAt: when } });
  } else {
    await DriverPresence.create({ driverId: String(driverId), startAt: when, endAt: when });
  }
}

// POST /api/driver-status  ➜ toggle Online/Offline
router.post('/driver-status', async (req, res) => {
  try {
    const { isOnline, location, currentTodaId, inTodaZone } = req.body;

    if (String(req.user?.role || '').toLowerCase() !== 'driver') {
      return res.status(403).json({ error: 'Drivers only' });
    }

    const driverId = String(req.user.sub || '');
    if (!isObjectId(driverId)) return res.status(401).json({ error: 'Invalid authenticated driver id' });

    const normLoc = normalizeLocation(location);

    // normalize TODA fields
    const todaObjectId =
      currentTodaId && isObjectId(currentTodaId)
        ? new mongoose.Types.ObjectId(currentTodaId)
        : null;
    const todaFlag = !!inTodaZone;

    if (isOnline === true) {
      const driver = await Driver.findById(driverId).lean();
      if (!driver) return res.status(404).json({ error: 'Driver not found' });

      const cap = sanitizeCap(driver.capacity ?? 4);

      const status = await DriverStatus.findOneAndUpdate(
        { driverId: new mongoose.Types.ObjectId(driverId) },
        {
          $set: {
            isOnline: true,
            location: normLoc,
            capacityTotal: cap,
            capacityUsed: 0,
            lockedSolo: false,
            updatedAt: new Date(),

            // 🔵 TODA tagging
            currentTodaId: todaObjectId,
            inTodaZone: todaFlag,
          },
          $setOnInsert: { activeBookingIds: [] },
        },
        { upsert: true, new: true }
      ).lean();

      await touchPresence(driverId, new Date());
      // init/reset driver meter baseline when going online
try {
  await DriverMeter.updateOne(
    { driverId: String(driverId) },
    {
      $setOnInsert: { totalMeters: 0 },
      $set: {
        lastLat: normLoc.latitude,
        lastLng: normLoc.longitude,
        lastUpdatedAt: new Date(),
      },
    },
    { upsert: true }
  );
} catch (e) {
  console.warn("DriverMeter init failed:", e?.message || e);
}

return res.status(200).json({ message: 'Driver is online (capacity synced)', status });
    } else {
      const status = await DriverStatus.findOneAndUpdate(
        { driverId: new mongoose.Types.ObjectId(driverId) },
        {
          $set: {
            isOnline: false,
            capacityUsed: 0,
            lockedSolo: false,
            updatedAt: new Date(),
            ...(location ? { location: normLoc } : {}),

            // when going offline, we still record the latest TODA context
            currentTodaId: todaObjectId,
            inTodaZone: todaFlag,
          },
        },
        { upsert: true, new: true }
      ).lean();

      await touchPresence(driverId, new Date()); // closes current slice by extending to "now"
      return res.status(200).json({ message: 'Driver is offline', status });
    }
  } catch (err) {
    console.error('❌ Error toggling driver status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/driver-heartbeat  ➜ keep alive + presence extend
router.post('/driver-heartbeat', async (req, res) => {
  try {
    const { location, currentTodaId, inTodaZone } = req.body;

    if (String(req.user?.role || '').toLowerCase() !== 'driver') {
      return res.status(403).json({ error: 'Drivers only' });
    }

    const driverId = String(req.user.sub || '');
    if (!isObjectId(driverId)) return res.status(401).json({ error: 'Invalid authenticated driver id' });
    if (!location || (typeof location.lat !== 'number' && typeof location.latitude !== 'number')) {
      return res.status(400).json({ error: 'location {lat,lng} or {latitude,longitude} required' });
    }

    const driver = await Driver.findById(driverId).lean();
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const cap = sanitizeCap(driver.capacity ?? 4);

    const normLoc = normalizeLocation(location);

    const todaObjectId =
      currentTodaId && isObjectId(currentTodaId)
        ? new mongoose.Types.ObjectId(currentTodaId)
        : null;
    const todaFlag = !!inTodaZone;

    const status = await DriverStatus.findOneAndUpdate(
      { driverId: new mongoose.Types.ObjectId(driverId) },
      {
        $set: {
          isOnline: true,
          location: normLoc,
          updatedAt: new Date(),
          capacityTotal: cap,

          // 🔵 TODA tagging from live GPS heartbeat
          currentTodaId: todaObjectId,
          inTodaZone: todaFlag,
        },
        $setOnInsert: {
          capacityUsed: 0,
          lockedSolo: false,
          activeBookingIds: [],
        },
      },
      { upsert: true, new: true }
    ).lean();

    await touchPresence(driverId, new Date());
    // --- update driver meter (virtual odometer) ---
try {
  const m = await DriverMeter.findOne({ driverId: String(driverId) });
  if (!m) {
    await DriverMeter.create({
      driverId: String(driverId),
      totalMeters: 0,
      lastLat: normLoc.latitude,
      lastLng: normLoc.longitude,
      lastUpdatedAt: new Date(),
    });
  } else {
    if (typeof m.lastLat === "number" && typeof m.lastLng === "number") {
      const delta = haversineMeters(
        m.lastLat,
        m.lastLng,
        normLoc.latitude,
        normLoc.longitude
      );
      // ignore GPS jumps between heartbeats
      const safeDelta = delta > 250 ? 0 : delta;
      m.totalMeters = (m.totalMeters || 0) + safeDelta;
    }
    m.lastLat = normLoc.latitude;
    m.lastLng = normLoc.longitude;
    m.lastUpdatedAt = new Date();
    await m.save();
  }
} catch (e) {
  console.warn("DriverMeter update failed:", e?.message || e);
}

return res.status(200).json({ ok: true, updatedAt: status.updatedAt, status });
  } catch (err) {
    console.error('❌ Heartbeat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/driver-status/:driverId (unchanged except we also expose TODA fields)
router.get('/driver-status/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    if (String(req.user?.role || '').toLowerCase() !== 'driver' || String(req.user.sub || '') !== String(driverId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!driverId) return res.status(400).json({ message: 'driverId required' });
    if (!isObjectId(driverId)) return res.status(400).json({ error: 'Invalid driverId' });

    const status = await DriverStatus.findOne({ driverId: new mongoose.Types.ObjectId(driverId) }).lean();
    if (!status) {
      return res.status(404).json({ message: 'Driver status not found' });
    }

    const now = Date.now();
    const effectiveOnline =
      status.isOnline && (now - new Date(status.updatedAt).getTime() < 60_000);

    res.status(200).json({
      isOnline: effectiveOnline,
      location: status.location,
      updatedAt: status.updatedAt,
      capacityTotal: status.capacityTotal ?? 4,
      capacityUsed: status.capacityUsed ?? 0,
      lockedSolo: !!status.lockedSolo,

      // 🔵 expose TODA info for debugging / future UI
      currentTodaId: status.currentTodaId || null,
      inTodaZone: !!status.inTodaZone,
    });
  } catch (err) {
    console.error('❌ Error fetching driver status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
