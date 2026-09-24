const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;


const entrySchema = new mongoose.Schema(
  {
    title: String,
    text: String,
    emotion: String,
    author: { type: ObjectId, ref: 'User' },
    authorName: String,
    performer: { type: ObjectId, ref: 'User' },
    performerName: String,
    media: {
      type: new mongoose.Schema({ file: String, mime: String, kind: String }, { _id: false }),
      default: null,
    },
    scriptVotes: { type: Number, default: 0 },
    actingVotes: { type: Number, default: 0 },
    scriptWinner: { type: Boolean, default: false },
    actingWinner: { type: Boolean, default: false },
  },
  { _id: false }
);

const matchSchema = new mongoose.Schema({
  roomCode: { type: String, required: true },
  host: { type: ObjectId, ref: 'User' },
  settings: {
    writeSeconds: Number,
    performSeconds: Number,
    emotionMode: String,
  },
  players: [
    {
      _id: false,
      user: { type: ObjectId, ref: 'User' },
      username: String,
      correctGuesses: { type: Number, default: 0 },
      guessWinner: { type: Boolean, default: false },
    },
  ],
  entries: [entrySchema],
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: Date.now },
});

matchSchema.index({ 'players.user': 1, endedAt: -1 });
matchSchema.index({ 'entries.media.file': 1 });

module.exports = mongoose.model('Match', matchSchema);
