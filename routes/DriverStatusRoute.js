const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Driver = require('../models/Drivers');
const DriverStatus = require('../models/DriverStatus');
const DriverPresence = require('../models/DriverPresence');

// --- helpers ---
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
    const { driverId, isOnline, location } = req.body;
    if (!driverId) return res.status(400).json({ error: 'driverId is required' });
    if (!isObjectId(driverId)) return res.status(400).json({ error: 'Invalid driverId' });

    const normLoc = normalizeLocation(location);

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
          },
          $setOnInsert: { activeBookingIds: [] },
        },
        { upsert: true, new: true }
      ).lean();

      await touchPresence(driverId, new Date());
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
    const { driverId, location } = req.body;
    if (!driverId) return res.status(400).json({ error: 'driverId is required' });
    if (!isObjectId(driverId)) return res.status(400).json({ error: 'Invalid driverId' });
    if (!location || (typeof location.lat !== 'number' && typeof location.latitude !== 'number')) {
      return res.status(400).json({ error: 'location {lat,lng} or {latitude,longitude} required' });
    }

    const driver = await Driver.findById(driverId).lean();
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const cap = sanitizeCap(driver.capacity ?? 4);

    const normLoc = normalizeLocation(location);

    const status = await DriverStatus.findOneAndUpdate(
      { driverId: new mongoose.Types.ObjectId(driverId) },
      {
        $set: {
          isOnline: true,
          location: normLoc,
          updatedAt: new Date(),
          capacityTotal: cap,
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
    return res.status(200).json({ ok: true, updatedAt: status.updatedAt, status });
  } catch (err) {
    console.error('❌ Heartbeat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/driver-status/:driverId (unchanged)
router.get('/driver-status/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    if (!driverId) return res.status(400).json({ message: 'driverId required' });
    if (!isObjectId(driverId)) return res.status(400).json({ error: 'Invalid driverId' });

    const status = await DriverStatus.findOne({ driverId: new mongoose.Types.ObjectId(driverId) }).lean();
    if (!status) {
      return res.status(404).json({ message: 'Driver status not found' });
    }

    const now = Date.now();
    const effectiveOnline = status.isOnline && (now - new Date(status.updatedAt).getTime() < 60_000);

    res.status(200).json({
      isOnline: effectiveOnline,
      location: status.location,
      updatedAt: status.updatedAt,
      capacityTotal: status.capacityTotal ?? 4,
      capacityUsed: status.capacityUsed ?? 0,
      lockedSolo: !!status.lockedSolo,
    });
  } catch (err) {
    console.error('❌ Error fetching driver status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
