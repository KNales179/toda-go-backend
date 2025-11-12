const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const Feedback = require('../models/Feedback');

// GET /api/reports?page=&limit=&q=&status=
router.get('/reports', async (req, res) => {
  try {
    const { page = 1, limit = 10, q = '', status = '' } = req.query;

    // Build queries
    const qRegex = q?.trim() ? new RegExp(q.trim(), 'i') : null;

    // Reports query (supports status + search)
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
    // Fetch in parallel
    const [reports] = await Promise.all([
      Report.find(reportQuery).sort({ submittedAt: -1 }).lean(),
    ]);

    // Normalize into one list
    const combined = [
      ...reports.map((r) => ({
        kind: 'report',
        _id: r._id,
        bookingId: r.bookingId,
        passengerId: r.passengerId,
        driverId: r.driverId,
        subject: r.reportType || 'Report',
        details: r.otherReport || '',
        status: (r.status || 'open').toLowerCase(),
        submittedAt: r.submittedAt,
      })),
    ];

    // Sort newest first (cross-type)
    combined.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    // Manual pagination on the merged array
    const pageNum = parseInt(page, 10);
    const lim = parseInt(limit, 10);
    const start = (pageNum - 1) * lim;
    const end = start + lim;
    const items = combined.slice(start, end);

    res.json({ items, total: combined.length });
  } catch (error) {
    console.error('Error fetching reports/feedback:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

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
    const items = await Feedback.find(query)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({ items, total });
  } catch (err) {
    console.error('Error fetching feedback:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

// POST /api/reports/:id/resolve  body: { resolutionNote?: string }
router.post('/reports/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolutionNote } = req.body || {};

    // If this ID is actually a Feedback, block it
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

router.patch('/reports/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body || {};
    const allowed = ['open', 'in progress', 'resolved', 'dismissed'];

    if (!allowed.includes((status || '').toLowerCase())) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
    }

    // Block feedback IDs
    const asFeedback = await Feedback.findById(id).lean();
    if (asFeedback) {
      return res.status(400).json({ error: 'Only reports can be updated.' });
    }

    const update = {
      status: status.toLowerCase(),
    };

    if (note) update.resolutionNote = note;

    // Handle resolvedAt timestamp
    if (update.status === 'resolved') {
      update.resolvedAt = new Date();
    } else {
      update.resolvedAt = undefined; // clear if moving away from resolved
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
