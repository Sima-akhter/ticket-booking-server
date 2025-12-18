
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 5000;

//firebase-admin
const admin = require("firebase-admin");

const serviceAccount = require("./ticket-booking-service-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


// middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASS}@programming-hero.ifoutmp.mongodb.net/?appName=programming-hero`;

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
        const paymentsCollection = db.collection("payments")



        // Get user bookings api
        app.get("/bookings/user/:email", async (req, res) => {
            const email = req.params.email;
            const result = await bookingsCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });

        // Fake payment (no stripe)
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


        //creat payment
        app.post('/payment-checkout-session', async (req, res) => {

            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: `Please pay for : ${paymentInfo.parcelName}`
                            }
                        },

                        quantity: 1,
                    },
                ],

                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.bookingId
                },
                customer_email: paymentInfo.senderEmail,
                success_url: `${process.env.SITE_DOMAON}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAON}/dashboard/payment-cancelled`,
            });

            res.send({ url: session.url })

        })





        // app.post("/create-payment-intent", async (req, res) => {
        //     const { price, bookingId } = req.body;

        //     const session = await stripe.checkout.sessions.create({
        //         payment_method_types: ["card"],
        //         mode: "payment",
        //         line_items: [{
        //             price_data: {
        //                 currency: "bdt",
        //                 product_data: { name: "Ticket Payment" },
        //                 unit_amount: price * 100
        //             },
        //             quantity: 1
        //         }],
        //         success_url: `${process.env.SITE_DOMAIN}payment-success/${bookingId}`,
        //         cancel_url: `http://localhost:5173/dashboard/myBookedTickets`
        //     });

        //     res.send({ sessionId: session.id });
        // });


        //payments api
        app.get("/payments/:email", async (req, res) => {
            const email = req.params.email;
            const result = await paymentsCollection.find({ email }).toArray();
            res.send(result);
        });



        // vendor get api
        app.get("/users/:email/role", async (req, res) => {
            const email = req.params.email;

            const user = await usersCollection.findOne({ email });

            if (!user) {
                return res.status(404).send({ role: "user" });
            }

            res.send({ role: user.role });
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
            newTicket.status = "Pending"
            newTicket.isAdvertised = false
            newTicket.create_date = new Date();
        

            const result = await ticketCollection.insertOne(newTicket);
            res.send(result);
        });

        // isAdvertise Toggle 

        app.patch("/tickets/:id", async(req, res)=>{
            const id = req.params.id
            const isAdvertise = req.body
            const query = {_id: new ObjectId(id)}
            const newDoc = {
                $set: {
                    isAdvertised: isAdvertise
                }
            }

            const result = await ticketCollection.updateOne(query, newDoc)
            res.send(result)
        })

        //  Get all tickets
        app.get("/tickets", async (req, res) => {
            const email = req.query.vendorEmail
            const query = {}
            if(email){
                query.vendorEmail = email
            }
            const result = await ticketCollection.find(query).toArray();
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








