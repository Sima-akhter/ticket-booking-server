require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

//  middleware
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@programming-hero.ifoutmp.mongodb.net/?appName=programming-hero`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect(); // MUST

    const db = client.db('ticket_booking');
    const userCollection = db.collection('users');

    //  POST users
    app.post('/users', async (req, res) => {
      const newUser = req.body;

      if (!newUser?.email) {
        return res.status(400).send({ message: 'Email required' });
      }

      const query = { email: newUser.email };
      const alreadyExist = await userCollection.findOne(query);

      if (alreadyExist) {
        await userCollection.updateOne(query, {
          $set: { last_loggedIn: new Date() },
        });
        return res.send({ message: 'User already exists' });
      }

      newUser.create_date = new Date();
      newUser.last_loggedIn = new Date();
      newUser.role = 'user';

      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });

    await client.db('admin').command({ ping: 1 });
    console.log(' MongoDB connected');
  } catch (error) {
    console.error(error);
  }
}
run();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
