// routes/Chat.js
const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");

// --- GET MESSAGES FOR A BOOKING ---
// Put the more specific endpoints first to avoid route conflicts
router.get("/driver/:driverId", async (req, res) => {
  try {
    const chats = await ChatMessage.find({ senderId: req.params.driverId })
      .sort({ createdAt: -1 });
    return res.status(200).json(chats);
  } catch (err) {
    console.error("❌ Chat driver fetch error:", err);
    return res.status(500).json({ message: "Error fetching driver chats" });
  }
});

router.get("/passenger/:passengerId", async (req, res) => {
  try {
    const chats = await ChatMessage.find({ senderId: req.params.passengerId })
      .sort({ createdAt: -1 });
    return res.status(200).json(chats);
  } catch (err) {
    console.error("❌ Chat passenger fetch error:", err);
    return res.status(500).json({ message: "Error fetching passenger chats" });
  }
});

// Booking ID endpoint — numeric booking ids expected
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

// --- SEND MESSAGE ---
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
