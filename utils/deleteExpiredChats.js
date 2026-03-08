const ChatConversation = require("../models/ChatConversation");
const ChatMessage = require("../models/ChatMessage");

async function deleteExpiredChats() {
  const now = new Date();

  const expiredConversations = await ChatConversation.find({
    expiresAt: { $ne: null, $lte: now },
  }).select("driverId passengerId");

  if (!expiredConversations.length) {
    return {
      deletedConversations: 0,
      deletedMessages: 0,
    };
  }

  let deletedMessages = 0;

  for (const convo of expiredConversations) {
    const result = await ChatMessage.deleteMany({
      driverId: convo.driverId,
      passengerId: convo.passengerId,
    });
    deletedMessages += result.deletedCount || 0;
  }

  const convoDeleteResult = await ChatConversation.deleteMany({
    expiresAt: { $ne: null, $lte: now },
  });

  return {
    deletedConversations: convoDeleteResult.deletedCount || 0,
    deletedMessages,
  };
}

module.exports = { deleteExpiredChats };