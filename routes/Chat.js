// routes/Chat.js
const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");
const Driver = require("../models/Drivers");
const Passenger = require("../models/Passenger");


// --- FETCH MESSAGES FOR A DRIVER–PASSENGER PAIR ---
router.get("/:driverId/:passengerId", async (req, res) => {
  try {
    const { driverId, passengerId } = req.params;
    if (!driverId || !passengerId) {
      return res.status(400).json({ message: "driverId and passengerId required" });
    }

    const messages = await ChatMessage.find({ driverId, passengerId })
      .sort({ createdAt: 1 });

    return res.status(200).json(messages);
  } catch (err) {
    console.error("❌ Chat fetch (pair) error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// --- SEND MESSAGE (PAIR-BASED) ---
router.post("/send", async (req, res) => {
  try {
    const { driverId, passengerId, bookingId, senderId, senderRole, message } = req.body;
    if (!driverId || !passengerId || !senderId || !senderRole || !message) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const newMsg = new ChatMessage({
      driverId,
      passengerId,
      bookingId,     // optional; keep for tagging
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

// --- (Optional) Sessions for lists (one per pair) ---
router.get("/sessions/driver/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    const sessions = await ChatMessage.aggregate([
      { $match: { driverId } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { driverId: "$driverId", passengerId: "$passengerId" },
          lastMessage: { $first: "$message" },
          lastSenderId: { $first: "$senderId" },
          lastSenderRole: { $first: "$senderRole" },
          lastAt: { $first: "$createdAt" },
          messageCount: { $sum: 1 },
        }
      },
      { $sort: { lastAt: -1 } },
    ]);

    res.json(sessions.map(s => ({
      driverId: s._id.driverId,
      passengerId: s._id.passengerId,
      lastMessage: s.lastMessage,
      lastSenderId: s.lastSenderId,
      lastSenderRole: s.lastSenderRole,
      lastAt: s.lastAt,
      messageCount: s.messageCount,
    })));
  } catch (err) {
    console.error("❌ sessions driver error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/sessions/passenger/:passengerId", async (req, res) => {
  try {
    const { passengerId } = req.params;
    const sessions = await ChatMessage.aggregate([
      { $match: { passengerId } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { driverId: "$driverId", passengerId: "$passengerId" },
          lastMessage: { $first: "$message" },
          lastSenderId: { $first: "$senderId" },
          lastSenderRole: { $first: "$senderRole" },
          lastAt: { $first: "$createdAt" },
          messageCount: { $sum: 1 },
        }
      },
      { $sort: { lastAt: -1 } },
    ]);

    res.json(sessions.map(s => ({
      driverId: s._id.driverId,
      passengerId: s._id.passengerId,
      lastMessage: s.lastMessage,
      lastSenderId: s.lastSenderId,
      lastSenderRole: s.lastSenderRole,
      lastAt: s.lastAt,
      messageCount: s.messageCount,
    })));
  } catch (err) {
    console.error("❌ sessions passenger error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// Passenger sessions → all drivers they've chatted with
router.get("/sessions/passenger/:passengerId", async (req, res) => {
  try {
    const { passengerId } = req.params;

    const chats = await ChatMessage.find({ passengerId }).sort({ createdAt: -1 });

    const sessionsMap = new Map();
    for (const chat of chats) {
      if (!sessionsMap.has(chat.driverId)) {
        // Look up driver’s name
        let driverName = "Driver";
        try {
          const d = await Driver.findById(chat.driverId).select("firstName middleName lastName driverName");
          if (d) {
            driverName =
              d.driverName ||
              [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
          }
        } catch {}

        sessionsMap.set(chat.driverId, {
          bookingId: chat.bookingId || null,
          driverId: chat.driverId,
          passengerId: chat.passengerId,
          driverName,
          lastMessage: chat.message,
          lastAt: chat.createdAt,
        });
        console.log(sessionsMap)
      }
    }

    return res.json(Array.from(sessionsMap.values()));
  } catch (err) {
    
    console.error("❌ passenger sessions error:", err);
    res.status(500).json({ message: "Server error fetching passenger sessions" });
  }
});

// Driver sessions → all passengers they've chatted with
router.get("/sessions/driver/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;

    const chats = await ChatMessage.find({ driverId }).sort({ createdAt: -1 });

    const sessionsMap = new Map();
    for (const chat of chats) {
      if (!sessionsMap.has(chat.passengerId)) {
        // Look up passenger’s name
        let passengerName = "Passenger";
        try {
          const p = await Passenger.findById(chat.passengerId).select("firstName middleName lastName");
          if (p) {
            passengerName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
          }
        } catch {}

        sessionsMap.set(chat.passengerId, {
          bookingId: chat.bookingId || null,
          driverId: chat.driverId,
          passengerId: chat.passengerId,
          passengerName,
          lastMessage: chat.message,
          lastAt: chat.createdAt,
        });
        console.log(sessionsMap)
      }
    }

    return res.json(Array.from(sessionsMap.values()));
  } catch (err) {
    console.error("❌ driver sessions error:", err);
    res.status(500).json({ message: "Server error fetching driver sessions" });
  }
});

module.exports = router;
