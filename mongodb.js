// mongodb.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to the MongoDB database');
  } catch (err) {
    console.error('Error connecting to the database:', err);
  }
}

connectToDatabase();

module.exports = client;
