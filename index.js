
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 5000;

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
        const paymentsCollection = db.collection("payments");

        /* ================= USERS ================= */

        // create user
        app.post("/users", async (req, res) => {
            const user = req.body;

            if (!user?.email) {
                return res.status(400).send({ message: "Email required" });
            }

            const existing = await userCollection.findOne({ email: user.email });

            if (existing) {
                await userCollection.updateOne(
                    { email: user.email },
                    { $set: { last_loggedIn: new Date() } }
                );
                return res.send({ message: "User already exists" });
            }

            user.role = "user";
            user.create_date = new Date();
            user.last_loggedIn = new Date();

            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        // get user role
        app.get("/users/:email/role", async (req, res) => {
            const email = req.params.email;

            const user = await userCollection.findOne({ email });
            if (!user) return res.send({ role: "user" });

            res.send({ role: user.role });
        });

        /* ================= TICKETS ================= */

        // add ticket
        app.post("/tickets", async (req, res) => {
            const ticket = req.body;
            ticket.create_date = new Date();

            const result = await ticketCollection.insertOne(ticket);
            res.send(result);
        });

        // get all tickets
        app.get("/tickets", async (req, res) => {
            const result = await ticketCollection.find().toArray();
            res.send(result);
        });

        // advertised tickets
        app.get("/tickets/advertised", async (req, res) => {
            const result = await ticketCollection
                .find({ isAdvertised: true })
                .limit(6)
                .toArray();
            res.send(result);
        });

        // single ticket
        app.get("/tickets/:id", async (req, res) => {
            const id = req.params.id;
            const result = await ticketCollection.findOne({
                _id: new ObjectId(id),
            });
            res.send(result);
        });

        /* ================= BOOKINGS ================= */

        // user bookings
        app.get("/bookings/user/:email", async (req, res) => {
            const email = req.params.email;
            const result = await bookingsCollection
                .find({ userEmail: email })
                .toArray();
            res.send(result);
        });

        // vendor pending bookings
        app.get("/vendor/bookings/:email", async (req, res) => {
            const vendorEmail = req.params.email;

            const result = await bookingsCollection
                .find({ vendorEmail, status: "pending" })
                .toArray();

            res.send(result);
        });

        // accept booking
        app.patch("/bookings/accept/:id", async (req, res) => {
            const id = req.params.id;

            const result = await bookingsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "accepted" } }
            );

            res.send(result);
        });

        // reject booking
        app.patch("/bookings/reject/:id", async (req, res) => {
            const id = req.params.id;

            const result = await bookingsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "rejected" } }
            );

            res.send(result);
        });

        /* ================= FAKE PAYMENT (NO STRIPE) ================= */

        app.post("/pay/:bookingId", async (req, res) => {
            const bookingId = req.params.bookingId;

            const booking = await bookingsCollection.findOne({
                _id: new ObjectId(bookingId),
            });

            if (!booking) {
                return res.status(404).send({ message: "Booking not found" });
            }

            await bookingsCollection.updateOne(
                { _id: new ObjectId(bookingId) },
                { $set: { status: "paid" } }
            );

            await ticketCollection.updateOne(
                { _id: new ObjectId(booking.ticketId) },
                { $inc: { ticketQuantity: -booking.quantity } }
            );

            await paymentsCollection.insertOne({
                bookingId,
                userEmail: booking.userEmail,
                ticketTitle: booking.ticketTitle,
                amount: booking.totalPrice,
                paymentDate: new Date(),
            });

            res.send({ success: true });
        });

        /* ================= PAYMENTS ================= */

        // get user payments
        app.get("/payments/:email", async (req, res) => {
            const email = req.params.email;

            const result = await paymentsCollection
                .find({ userEmail: email })
                .toArray();

            res.send(result);
        });

        /* ================= VENDOR REVENUE ================= */

        app.get("/vendor/revenue/:email", async (req, res) => {
            const vendorEmail = req.params.email;

            const totalTicketsAdded = await ticketCollection.countDocuments({
                vendorEmail,
            });

            const bookings = await bookingsCollection
                .find({ vendorEmail, status: "accepted" })
                .toArray();

            let totalRevenue = 0;
            let totalTicketsSold = 0;

            bookings.forEach((booking) => {
                totalTicketsSold += booking.quantity;
                totalRevenue += booking.totalPrice;
            });

            res.send({
                totalRevenue,
                totalTicketsSold,
                totalTicketsAdded,
            });
        });

        console.log("✅ MongoDB Connected Successfully");
    } catch (error) {
        console.error("❌ MongoDB Error:", error);
    }
}

run();

// root
app.get("/", (req, res) => {
    res.send("🚀 Ticket Booking Server Running");
});

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});



