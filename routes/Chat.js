// routes/Chat.js
const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");

// --- SESSIONS: grouped by bookingId for a driver ---
router.get("/sessions/driver/:driverId", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    if (!driverId) return res.status(400).json({ message: "driverId required" });

    // Group by bookingId, get latest message & participants
    const sessions = await ChatMessage.aggregate([
      { $match: { $or: [{ senderId: driverId }] } }, // messages sent by driver (driver participated)
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$bookingId",
          lastMessage: { $first: "$message" },
          lastSenderId: { $first: "$senderId" },
          lastSenderRole: { $first: "$senderRole" },
          lastAt: { $first: "$createdAt" },
          participants: { $addToSet: "$senderId" },
          count: { $sum: 1 },
        },
      },
      { $sort: { lastAt: -1 } },
    ]);

    return res.status(200).json(sessions.map(s => ({
      bookingId: s._id,
      lastMessage: s.lastMessage,
      lastSenderId: s.lastSenderId,
      lastSenderRole: s.lastSenderRole,
      lastAt: s.lastAt,
      participants: s.participants,
      messageCount: s.count,
    })));
  } catch (err) {
    console.error("❌ Chat sessions (driver) error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// --- SESSIONS: grouped by bookingId for a passenger ---
router.get("/sessions/passenger/:passengerId", async (req, res) => {
  try {
    const passengerId = req.params.passengerId;
    if (!passengerId) return res.status(400).json({ message: "passengerId required" });

    const sessions = await ChatMessage.aggregate([
      { $match: { $or: [{ senderId: passengerId }] } }, // messages sent by passenger
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$bookingId",
          lastMessage: { $first: "$message" },
          lastSenderId: { $first: "$senderId" },
          lastSenderRole: { $first: "$senderRole" },
          lastAt: { $first: "$createdAt" },
          participants: { $addToSet: "$senderId" },
          count: { $sum: 1 },
        },
      },
      { $sort: { lastAt: -1 } },
    ]);

    return res.status(200).json(sessions.map(s => ({
      bookingId: s._id,
      lastMessage: s.lastMessage,
      lastSenderId: s.lastSenderId,
      lastSenderRole: s.lastSenderRole,
      lastAt: s.lastAt,
      participants: s.participants,
      messageCount: s.count,
    })));
  } catch (err) {
    console.error("❌ Chat sessions (passenger) error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// --- existing endpoints below (keep them) ---
// Booking messages fetch
router.get("/:bookingId", async (req, res) => {
  try {
    const bookingId = Number(req.params.bookingId);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ message: "Invalid bookingId" });
    }

    const messages = await ChatMessage.find({ bookingId })
      .sort({ createdAt: 1 }); // oldest → newest

    return res.status(200).json(messages);
  } catch (err) {
    console.error("❌ Chat fetch error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Send message
router.post("/send", async (req, res) => {
  try {
    const { bookingId, senderId, senderRole, message } = req.body;
    if (!bookingId || !senderId || !senderRole || !message) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const newMsg = new ChatMessage({
      bookingId,
      senderId,
      senderRole,
      message,
    });

    await newMsg.save();
    return res.status(201).json(newMsg);
  } catch (err) {
    console.error("❌ Chat send error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
