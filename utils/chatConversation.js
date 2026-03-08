const ChatConversation = require("../models/ChatConversation");

const CHAT_RETENTION_DAYS = 14;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function upsertConversationConnection({
  driverId,
  passengerId,
  bookingId = null,
  connectedAt = new Date(),
}) {
  const expiresAt = addDays(connectedAt, CHAT_RETENTION_DAYS);

  const convo = await ChatConversation.findOneAndUpdate(
    { driverId, passengerId },
    {
      $set: {
        latestBookingId: bookingId,
        connectedAt,
        expiresAt,
        isArchived: false,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  return convo;
}

module.exports = {
  CHAT_RETENTION_DAYS,
  upsertConversationConnection,
};