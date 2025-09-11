// routes/Chat.js
const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");

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

// --- GET MESSAGES FOR A BOOKING ---
router.get("/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;

    const messages = await ChatMessage.find({ bookingId })
      .sort({ createdAt: 1 }); // oldest → newest

    return res.status(200).json(messages);
  } catch (err) {
    console.error("❌ Chat fetch error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get all chats for a driver
router.get("/driver/:driverId", async (req, res) => {
  try {
    const chats = await ChatMessage.find({ senderId: req.params.driverId })
      .sort({ createdAt: -1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ message: "Error fetching driver chats" });
  }
});

// Get all chats for a passenger
router.get("/passenger/:passengerId", async (req, res) => {
  try {
    const chats = await ChatMessage.find({ senderId: req.params.passengerId })
      .sort({ createdAt: -1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ message: "Error fetching passenger chats" });
  }
});


module.exports = router;
