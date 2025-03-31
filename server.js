const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors'); // Добавьте этот модуль

const app = express();
const port = process.env.PORT || 3000;
const uri = 'mongodb+srv://maksimkryglyk:Prometey888!@asutp-notes.c17wh2w.mongodb.net/';

app.use(cors()); // Добавьте этот middleware
app.use(express.json());

async function connectToDatabase() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const database = client.db('asutp-notes');
    const collection = database.collection('notes');
    return { client, database, collection };
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}

app.get('/notes', async (req, res) => {
  try {
    const { client, collection } = await connectToDatabase();
    const notes = await collection.find().toArray();
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/notes', async (req, res) => {
  try {
    const { client, collection } = await connectToDatabase();
    const result = await collection.insertOne(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});