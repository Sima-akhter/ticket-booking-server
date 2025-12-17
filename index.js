
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
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
        // await client.connect();

        const db = client.db("ticket_booking");
        const userCollection = db.collection("users");
        const ticketCollection = db.collection("tickets");
        const bookingsCollection = db.collection("bookings");


        /* ==========================
            TICKETS API
        ========================== */

        // vendor get api
        app.get("/users/:email/role", async (req, res) => {
            const email = req.params.email;

            const user = await usersCollection.findOne({ email });

            if (!user) {
                return res.status(404).send({ role: "user" });
            }

            res.send({ role: user.role });
        });


        // user api
        app.get("/bookings/user/:email", async (req, res) => {
            const email = req.params.email;
            const result = await bookingsCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });


        // vendor booking api

        app.get("/vendor/bookings/:email", async (req, res) => {
            const vendorEmail = req.params.email;

            const result = await bookingsCollection
                .find({ vendorEmail, status: "pending" })
                .toArray();

            res.send(result);
        });

        // vendor bookings accept
        app.patch("/bookings/accept/:id", async (req, res) => {
            const id = req.params.id;

            const result = await bookingsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "accepted" } }
            );

            res.send(result);
        });


        //vendor booking reject
        app.patch("/bookings/reject/:id", async (req, res) => {
            const id = req.params.id;

            const result = await bookingsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "rejected" } }
            );

            res.send(result);
        });


        // vendor revenue api
        app.get("/vendor/revenue/:email", async (req, res) => {
            const vendorEmail = req.params.email;

            // Total tickets added
            const totalTicketsAdded = await ticketCollection.countDocuments({
                vendorEmail,
            });

            // Accepted bookings
            const bookings = await bookingsCollection
                .find({ vendorEmail, status: "accepted" })
                .toArray();

            let totalRevenue = 0;
            let totalTicketsSold = 0;

            bookings.forEach((booking) => {
                totalTicketsSold += booking.bookingQuantity;
                totalRevenue += booking.bookingQuantity * booking.unitPrice;
            });

            res.send({
                totalRevenue,
                totalTicketsSold,
                totalTicketsAdded,
            });
        });

        //  Add ticket
        app.post("/tickets", async (req, res) => {
            const newTicket = req.body;
            newTicket.create_date = new Date();
            //   newTicket.isAdvertised = true; 

            const result = await ticketCollection.insertOne(newTicket);
            res.send(result);
        });

        //  Get all tickets
        app.get("/tickets", async (req, res) => {
            const result = await ticketCollection.find().toArray();
            res.send(result);
        });

        //  Advertisement tickets (Exactly 6)
        app.get("/tickets/advertised", async (req, res) => {
            const result = await ticketCollection
                .find({ isAdvertised: true })
                .limit(6)
                .toArray();
            res.send(result);
        });

        //  Single ticket details
        app.get("/tickets/:id", async (req, res) => {
            const id = req.params.id;
            const result = await ticketCollection.findOne({
                _id: new ObjectId(id),
            });
            res.send(result);
        });



        /* ==========================
            USERS API
        ========================== */

        //  Create user
        app.post("/users", async (req, res) => {
            const newUser = req.body;

            if (!newUser?.email) {
                return res.status(400).send({ message: "Email required" });
            }

            const query = { email: newUser.email };
            const existingUser = await userCollection.findOne(query);

            if (existingUser) {
                await userCollection.updateOne(query, {
                    $set: { last_loggedIn: new Date() },
                });
                return res.send({ message: "User already exists" });
            }

            newUser.role = "user";
            newUser.create_date = new Date();
            newUser.last_loggedIn = new Date();

            const result = await userCollection.insertOne(newUser);
            res.send(result);
        });

        console.log(" MongoDB Connected Successfully");
    } catch (error) {
        console.error(" MongoDB Connection Error:", error);
    }
}

run();

// Root route
app.get("/", (req, res) => {
    res.send("Ticket Booking Server Running");
});

app.listen(port, () => {
    console.log(` Server running on port ${port}`);
});




