const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema({
  title: { type: String, required: true }, 
  content: { type: String, required: true }, 
  color: { type: String, default: "#ffffff" }, 
  pinned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }, 
});

// Create and export the Note model
const Note = mongoose.model("Note", noteSchema);
module.exports = Note;
