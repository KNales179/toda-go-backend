// routes/Chat.js
const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");
const Driver = require("../models/Drivers");
const Passenger = require("../models/Passenger");
const ChatConversation = require("../models/ChatConversation");
const { upsertConversationConnection } = require("../utils/chatConversation");
const { deleteExpiredChats } = require("../utils/deleteExpiredChats");
const upload = require("../middleware/upload");
const { uploadBufferToCloudinary } = require("../utils/cloudinaryConfig");

function buildDriverName(d) {
  if (!d) return "Driver";
  return (
    d.driverName ||
    [
      d.driverFirstName,
      d.driverMiddleName,
      d.driverLastName,
      d.driverSuffix,
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    [
      d.firstName,
      d.middleName,
      d.lastName,
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    "Driver"
  );
}

function buildPassengerName(p) {
  if (!p) return "Passenger";
  return (
    [
      p.firstName,
      p.middleName,
      p.lastName,
      p.suffix,
    ]
      .filter(Boolean)
      .join(" ")
      .trim() || "Passenger"
  );
}

function getRoomForPair(driverId, passengerId) {
  return `chat:${driverId}:${passengerId}`;
}

// --- FETCH MESSAGES FOR A DRIVER–PASSENGER PAIR ---
router.get("/:driverId/:passengerId", async (req, res) => {
  try {
    await deleteExpiredChats();

    const { driverId, passengerId } = req.params;
    if (!driverId || !passengerId) {
      return res.status(400).json({ message: "driverId and passengerId required" });
    }

    const convo = await ChatConversation.findOne({ driverId, passengerId });

    if (convo?.expiresAt && new Date(convo.expiresAt) <= new Date()) {
      await ChatMessage.deleteMany({ driverId, passengerId });
      await ChatConversation.deleteOne({ _id: convo._id });
      return res.status(200).json([]);
    }

    const messages = await ChatMessage.find({ driverId, passengerId }).sort({ createdAt: 1 });

    return res.status(200).json(messages);
  } catch (err) {
    console.error("❌ Chat fetch (pair) error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// --- SEND MESSAGE ---
router.post("/send", async (req, res) => {
  try {
    const { driverId, passengerId, bookingId, senderId, senderRole, message } = req.body;

    if (!driverId || !passengerId || !senderId || !senderRole || !message?.trim()) {
      return res.status(400).json({ message: "Missing fields" });
    }

    if (!["driver", "passenger"].includes(senderRole)) {
      return res.status(400).json({ message: "Invalid senderRole" });
    }

    const recipientRole = senderRole === "driver" ? "passenger" : "driver";
    const recipientId = senderRole === "driver" ? passengerId : driverId;

    const newMsg = new ChatMessage({
      driverId,
      passengerId,
      bookingId: bookingId ?? null,
      senderId,
      senderRole,
      recipientId,
      recipientRole,
      message: String(message).trim(),

      // delivered = true once saved to server
      delivered: true,
      deliveredAt: new Date(),

      // seen only when recipient opens chat
      seen: false,
      seenAt: null,
    });

    await newMsg.save();
    await upsertConversationConnection({
      driverId,
      passengerId,
      bookingId: bookingId ?? null,
      connectedAt: new Date(),
    });

    const pairRoom = getRoomForPair(driverId, passengerId);

    // Realtime updates
    req.io?.to(driverId).emit("sessions:update");
    req.io?.to(passengerId).emit("sessions:update");

    req.io?.to(pairRoom).emit("chat:new-message", newMsg);

    return res.status(201).json(newMsg);
  } catch (err) {
    console.error("❌ Chat send error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// --- MARK PAIR MESSAGES AS SEEN BY CURRENT USER ---
router.patch("/seen", async (req, res) => {
  try {
    const { driverId, passengerId, viewerId, viewerRole } = req.body;

    if (!driverId || !passengerId || !viewerId || !viewerRole) {
      return res.status(400).json({ message: "driverId, passengerId, viewerId, viewerRole are required" });
    }

    if (!["driver", "passenger"].includes(viewerRole)) {
      return res.status(400).json({ message: "Invalid viewerRole" });
    }

    const result = await ChatMessage.updateMany(
      {
        driverId,
        passengerId,
        recipientId: viewerId,
        recipientRole: viewerRole,
        seen: false,
      },
      {
        $set: {
          seen: true,
          seenAt: new Date(),
          delivered: true,
          deliveredAt: new Date(),
        },
      }
    );

    const pairRoom = getRoomForPair(driverId, passengerId);

    req.io?.to(driverId).emit("sessions:update");
    req.io?.to(passengerId).emit("sessions:update");
    req.io?.to(pairRoom).emit("chat:seen-updated", {
      driverId,
      passengerId,
      viewerId,
      viewerRole,
      modifiedCount: result.modifiedCount || 0,
    });

    return res.status(200).json({
      ok: true,
      modifiedCount: result.modifiedCount || 0,
    });
  } catch (err) {
    console.error("❌ mark seen error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// --- MARK PAIR MESSAGES AS DELIVERED TO CURRENT USER ---
router.patch("/delivered", async (req, res) => {
  try {
    const { driverId, passengerId, viewerId, viewerRole } = req.body;

    if (!driverId || !passengerId || !viewerId || !viewerRole) {
      return res.status(400).json({ message: "driverId, passengerId, viewerId, viewerRole are required" });
    }

    if (!["driver", "passenger"].includes(viewerRole)) {
      return res.status(400).json({ message: "Invalid viewerRole" });
    }

    const result = await ChatMessage.updateMany(
      {
        driverId,
        passengerId,
        recipientId: viewerId,
        recipientRole: viewerRole,
        delivered: false,
      },
      {
        $set: {
          delivered: true,
          deliveredAt: new Date(),
        },
      }
    );

    const pairRoom = getRoomForPair(driverId, passengerId);

    req.io?.to(driverId).emit("sessions:update");
    req.io?.to(passengerId).emit("sessions:update");
    req.io?.to(pairRoom).emit("chat:delivered-updated", {
      driverId,
      passengerId,
      viewerId,
      viewerRole,
      modifiedCount: result.modifiedCount || 0,
    });

    return res.status(200).json({
      ok: true,
      modifiedCount: result.modifiedCount || 0,
    });
  } catch (err) {
    console.error("❌ mark delivered error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Passenger sessions → all drivers they've chatted with
router.get("/sessions/passenger/:passengerId", async (req, res) => {
  try {
    await deleteExpiredChats();
    const { passengerId } = req.params;
    const chats = await ChatMessage.find({ passengerId }).sort({ createdAt: -1 });

    const sessionsMap = new Map();

    for (const chat of chats) {
      if (!sessionsMap.has(chat.driverId)) {
        let driverName = "Driver";

        try {
          const d = await Driver.findById(chat.driverId).select(
            "driverFirstName driverMiddleName driverLastName driverSuffix driverName firstName middleName lastName"
          );
          driverName = buildDriverName(d);
        } catch (err) {
          console.error("❌ driver lookup failed:", chat.driverId, err);
        }

        const unseenCount = await ChatMessage.countDocuments({
          driverId: chat.driverId,
          passengerId: chat.passengerId,
          recipientId: passengerId,
          recipientRole: "passenger",
          seen: false,
        });

        sessionsMap.set(chat.driverId, {
          bookingId: chat.bookingId || null,
          driverId: chat.driverId,
          passengerId: chat.passengerId,
          driverName,
          lastMessage: chat.message,
          lastAt: chat.createdAt,
          lastMessageSenderId: chat.senderId,
          lastMessageSenderRole: chat.senderRole,
          delivered: !!chat.delivered,
          deliveredAt: chat.deliveredAt || null,
          seen: !!chat.seen,
          seenAt: chat.seenAt || null,
          unseenCount,
        });
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
    await deleteExpiredChats();
    const { driverId } = req.params;
    const chats = await ChatMessage.find({ driverId }).sort({ createdAt: -1 });
    const sessionsMap = new Map();

    for (const chat of chats) {
      if (!sessionsMap.has(chat.passengerId)) {
        let passengerName = "Passenger";

        try {
          const p = await Passenger.findById(chat.passengerId).select(
            "firstName middleName lastName suffix"
          );
          passengerName = buildPassengerName(p);
        } catch (err) {
          console.error("❌ passenger lookup failed:", chat.passengerId, err);
        }

        const unseenCount = await ChatMessage.countDocuments({
          driverId: chat.driverId,
          passengerId: chat.passengerId,
          recipientId: driverId,
          recipientRole: "driver",
          seen: false,
        });

        sessionsMap.set(chat.passengerId, {
          bookingId: chat.bookingId || null,
          driverId: chat.driverId,
          passengerId: chat.passengerId,
          passengerName,
          lastMessage: chat.message,
          lastAt: chat.createdAt,
          lastMessageSenderId: chat.senderId,
          lastMessageSenderRole: chat.senderRole,
          delivered: !!chat.delivered,
          deliveredAt: chat.deliveredAt || null,
          seen: !!chat.seen,
          seenAt: chat.seenAt || null,
          unseenCount,
        });
      }
    }

    return res.json(Array.from(sessionsMap.values()));
  } catch (err) {
    console.error("❌ driver sessions error:", err);
    res.status(500).json({ message: "Server error fetching driver sessions" });
  }
});

router.get("/conversation/:driverId/:passengerId", async (req, res) => {
  try {
    const { driverId, passengerId } = req.params;

    const convo = await ChatConversation.findOne({ driverId, passengerId });

    if (!convo) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    return res.status(200).json(convo);
  } catch (err) {
    console.error("❌ conversation fetch error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/send-image", upload.single("image"), async (req, res) => {
  try {
    const {
      driverId,
      passengerId,
      bookingId,
      senderId,
      senderRole,
      message
    } = req.body;

    if (!driverId || !passengerId || !senderId || !senderRole) {
      return res.status(400).json({ message: "Missing fields" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    if (!["driver", "passenger"].includes(senderRole)) {
      return res.status(400).json({ message: "Invalid senderRole" });
    }

    const recipientRole = senderRole === "driver" ? "passenger" : "driver";
    const recipientId = senderRole === "driver" ? passengerId : driverId;

    const uploadResult = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "toda-go/chat-images",
      resource_type: "image",
      transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
      public_id: `chat_${driverId}_${passengerId}_${Date.now()}`
    });

    const newMsg = new ChatMessage({
      driverId,
      passengerId,
      bookingId: bookingId ? Number(bookingId) : null,
      senderId,
      senderRole,
      recipientId,
      recipientRole,
      messageType: "image",
      message: String(message || "").trim(),
      imageUrl: uploadResult.secure_url,
      imagePublicId: uploadResult.public_id,
      delivered: true,
      deliveredAt: new Date(),
      seen: false
    });

    await newMsg.save();

    req.io?.to(driverId).emit("sessions:update");
    req.io?.to(passengerId).emit("sessions:update");
    req.io?.emit("sessions:update");

    res.status(201).json(newMsg);

  } catch (err) {
    console.error("CHAT_IMAGE_SEND_ERROR", err);
    res.status(500).json({ message: "Server error sending image" });
  }
});

module.exports = router;