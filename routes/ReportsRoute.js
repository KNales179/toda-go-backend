const express = require('express');
const router = express.Router();
const Report = require('../models/Report');

// 🟢 GET /api/reports?page=&limit=&q=&status=
router.get('/reports', async (req, res) => {
  try {
    const { page = 1, limit = 10, q = '', status = '' } = req.query;

    const query = {};

    // Filter by status (optional)
    if (status) {
      query.status = new RegExp(`^${status}$`, 'i'); // case-insensitive
    }

    // Search query across multiple fields
    if (q.trim()) {
      const regex = new RegExp(q.trim(), 'i');
      query.$or = [
        { id: regex },
        { reporter: regex },
        { reportedUser: regex },
        { subject: regex },
        { details: regex },
        { type: regex },
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Report.countDocuments(query);
    const items = await Report.find(query)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({ items, total });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟡 POST /api/reports/:id/resolve
router.post('/reports/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolutionNote } = req.body || {};

    const updated = await Report.findByIdAndUpdate(
      id,
      {
        status: "Resolved",
        resolutionNote: resolutionNote || "Marked as resolved by admin",
        resolvedAt: new Date(),
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Report not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error resolving report:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
