const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const Feedback = require('../models/Feedback');
const Passenger = require('../models/Passenger');
const Driver = require('../models/Drivers'); // adjust path/name if needed

// helper: build "nice" name
function buildName(doc) {
  if (!doc) return "Unknown";
  return (
    doc.fullName ||
    doc.name ||
    [doc.firstName, doc.middleName, doc.lastName].filter(Boolean).join(" ") ||
    doc.driverName ||
    "Unknown"
  );
}

// --------------------
// GET /api/reports?page=&limit=&q=&status=
// --------------------
router.get('/reports', async (req, res) => {
  try {
    const { page = 1, limit = 10, q = '', status = '' } = req.query;

    const qRegex = q?.trim() ? new RegExp(q.trim(), 'i') : null;

    const reportQuery = {};
    if (status) reportQuery.status = new RegExp(`^${status}$`, 'i');
    if (qRegex) {
      reportQuery.$or = [
        { reportType: qRegex },
        { otherReport: qRegex },
        { passengerId: qRegex },
        { driverId: qRegex },
        { bookingId: qRegex },
      ];
    }

    const reports = await Report.find(reportQuery)
      .sort({ submittedAt: -1 })
      .lean();

    // collect unique IDs
    const passengerIds = [...new Set(reports.map(r => r.passengerId).filter(Boolean))];
    const driverIds = [...new Set(reports.map(r => r.driverId).filter(Boolean))];

    // fetch passengers + drivers
    const [passengers, drivers] = await Promise.all([
      Passenger.find({ _id: { $in: passengerIds } }).lean(),
      Driver.find({ _id: { $in: driverIds } }).lean(),
    ]);

    const passengerMap = {};
    passengers.forEach(p => {
      passengerMap[String(p._id)] = buildName(p);
    });

    const driverMap = {};
    drivers.forEach(d => {
      driverMap[String(d._id)] = buildName(d);
    });

    const combined = reports.map((r) => ({
      kind: 'report',
      _id: r._id,
      bookingId: r.bookingId,
      passengerId: r.passengerId,
      passengerName: passengerMap[String(r.passengerId)] || r.passengerId || "Unknown passenger",
      driverId: r.driverId,
      driverName: r.driverId ? (driverMap[String(r.driverId)] || r.driverId) : null,
      subject: r.reportType || 'Report',
      details: r.otherReport || '',
      status: (r.status || 'open').toLowerCase(),
      submittedAt: r.submittedAt,
    }));

    // Pagination
    const pageNum = parseInt(page, 10);
    const lim = parseInt(limit, 10);
    const start = (pageNum - 1) * lim;
    const end = start + lim;
    const items = combined.slice(start, end);

    res.json({ items, total: combined.length });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// --------------------
// GET /api/feedback?page=&limit=&q=
// --------------------
router.get('/feedback', async (req, res) => {
  try {
    const { page = 1, limit = 10, q = '' } = req.query;

    const query = {};
    if (q.trim()) {
      const regex = new RegExp(q.trim(), 'i');
      query.$or = [
        { feedback: regex },
        { passengerId: regex },
        { driverId: regex },
        { bookingId: regex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Feedback.countDocuments(query);
    const feedbackDocs = await Feedback.find(query)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const passengerIds = [...new Set(feedbackDocs.map(f => f.passengerId).filter(Boolean))];
    const driverIds = [...new Set(feedbackDocs.map(f => f.driverId).filter(Boolean))];

    const [passengers, drivers] = await Promise.all([
      Passenger.find({ _id: { $in: passengerIds } }).lean(),
      Driver.find({ _id: { $in: driverIds } }).lean(),
    ]);

    const passengerMap = {};
    passengers.forEach(p => {
      passengerMap[String(p._id)] = buildName(p);
    });

    const driverMap = {};
    drivers.forEach(d => {
      driverMap[String(d._id)] = buildName(d);
    });

    const items = feedbackDocs.map((f) => ({
      kind: 'feedback',
      _id: f._id,
      bookingId: f.bookingId,
      passengerId: f.passengerId,
      passengerName: passengerMap[String(f.passengerId)] || f.passengerId || "Unknown passenger",
      driverId: f.driverId,
      driverName: f.driverId ? (driverMap[String(f.driverId)] || f.driverId) : null,
      subject: 'Passenger Feedback',
      details: f.feedback || '',
      submittedAt: f.submittedAt,
    }));

    res.json({ items, total });
  } catch (err) {
    console.error('Error fetching feedback:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --------------------
// POST /api/reports/:id/resolve
// --------------------
router.post('/reports/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolutionNote } = req.body || {};

    const asFeedback = await Feedback.findById(id).lean();
    if (asFeedback) {
      return res.status(400).json({ error: 'Only reports can be resolved.' });
    }

    const updated = await Report.findByIdAndUpdate(
      id,
      {
        status: 'resolved',
        resolutionNote: resolutionNote || 'Marked as resolved by admin',
        resolvedAt: new Date(),
      },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: 'Report not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error resolving report:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --------------------
// PATCH /api/reports/:id/status
// --------------------
router.patch('/reports/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body || {};
    const allowed = ['open', 'in progress', 'resolved', 'dismissed'];

    if (!allowed.includes((status || '').toLowerCase())) {
      return res
        .status(400)
        .json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
    }

    const asFeedback = await Feedback.findById(id).lean();
    if (asFeedback) {
      return res.status(400).json({ error: 'Only reports can be updated.' });
    }

    const update = {
      status: status.toLowerCase(),
    };
    if (note) update.resolutionNote = note;

    if (update.status === 'resolved') {
      update.resolvedAt = new Date();
    } else {
      update.resolvedAt = undefined;
    }

    const updated = await Report.findByIdAndUpdate(id, update, { new: true });
    if (!updated) return res.status(404).json({ error: 'Report not found' });

    res.json(updated);
  } catch (err) {
    console.error('Error updating report status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
