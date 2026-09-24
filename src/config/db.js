const mongoose = require('mongoose');

async function connectDB(uri) {
  await mongoose.connect(uri);
  console.log('MongoDB conectado');
}

module.exports = connectDB;
