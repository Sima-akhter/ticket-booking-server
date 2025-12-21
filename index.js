
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 5000;
const crypto = require("crypto");

//firebase-admin
const admin = require("firebase-admin");

const serviceAccount = require("./ticket-booking-service-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

function generateTrackingId() {
    const prefix = "PRCL";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();

    return `${prefix}-${date}-${random}`;
}


// middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {

    // console.log('headers in the middleware', req.headers?.authorization)

    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }


}

// MongoDB URI
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASS}@programming-hero.ifoutmp.mongodb.net/?appName=programming-hero`;
console.log(uri)
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

        //=====================////================
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const user = await userCollection.findOne({ email });

            if (user?.role !== "admin") {
                return res.status(404).send({ message: "forbidden" });
            }
            next();
        };


        // CREATE BOOKING
        app.post("/bookings", verifyFBToken, async (req, res) => {
            const booking = req.body;
            booking.userEmail = req.decoded_email;
            booking.status = "pending";
            booking.createdAt = new Date();

            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        });





        //users related apis
        app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText;
            const query = {};

            if (searchText) {
                // query.displayName = {$regex: searchText, $options: 'i'}

                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },
                    { email: { $regex: searchText, $options: 'i' } },
                ]
            }



            const cursor = userCollection.find(query).sort({ createdAt: -1 }).limit(5);
            const result = await cursor.toArray();
            res.send(result);
        })


        // Get user profile by email
        app.get("/users/profile/:email", verifyFBToken, async (req, res) => {
            const email = req.params.email;

            if (req.decoded_email !== email) {
                return res.status(403).send({ message: "Forbidden" });
            }

            const userProfile = await userCollection.findOne({ email });

            if (!userProfile) {
                return res.status(404).send({ message: "User not found" });
            }

            res.send(userProfile);
        });



        app.get("/bookings/user/:email", verifyFBToken, async (req, res) => {
            if (req.params.email !== req.decoded_email) {
                return res.status(403).send({ message: "Forbidden" });
            }

            const result = await bookingsCollection
                .find({ userEmail: req.params.email })
                .toArray();

            res.send(result);
        });


        app.patch("/bookings/pay/:id", verifyFBToken, async (req, res) => {
            const bookingId = req.params.id;

            const booking = await bookingsCollection.findOne({
                _id: new ObjectId(bookingId),
            });

            // update booking status
            await bookingsCollection.updateOne(
                { _id: new ObjectId(bookingId) },
                { $set: { status: "paid" } }
            );

            // reduce ticket quantity
            await ticketCollection.updateOne(
                { _id: new ObjectId(booking.ticketId) },
                { $inc: { ticketQuantity: -booking.bookingQuantity } }
            );

            res.send({ success: true });
        });





        // Get user bookings api
        app.get("/bookings/user/:email", async (req, res) => {
            const email = req.params.email;
            const result = await bookingsCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updateDoc)
            res.send(result);
        })

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
        app.post('/payment-checkout-session', verifyFBToken, async (req, res) => {
            try {
                const { bookingId } = req.body;

                const booking = await bookingsCollection.findOne({
                    _id: new ObjectId(bookingId)
                });

                if (!booking) {
                    return res.status(404).json({ message: "Booking not found" });
                }

                const ticket = await ticketCollection.findOne({
                    _id: new ObjectId(booking.ticketId)
                });
                console.log(ticket, booking)

                const now = new Date();
                const departure = new Date(ticket?.departureDateTime);

                if (departure < now) {
                    return res.status(400).json({
                        message: "Departure time passed. Payment not allowed."
                    });
                }

                if (booking.status !== "accepted") {
                    return res.status(400).json({
                        message: "Booking not accepted yet"
                    });
                }

                const amount = booking.totalPrice * 100;

                const session = await stripe.checkout.sessions.create({
                    line_items: [
                        {
                            price_data: {
                                currency: 'USD',
                                unit_amount: amount,
                                product_data: {
                                    name: booking.ticketTitle
                                }
                            },
                            quantity: 1
                        }
                    ],
                    mode: 'payment',
                    metadata: {
                        bookingId: booking._id.toString()
                    },
                    customer_email: booking.userEmail,
                    success_url: `${process.env.SITE_DOMAIN || 'http://localhost:3000'}/dashboard/bookingSuccess`,
                    cancel_url: `${process.env.SITE_DOMAIN || 'http://localhost:3000'}/dashboard/bookingCancelled`,
                });

                res.json({ url: session.url }); // Changed from res.send to res.json
            } catch (error) {
                console.error('Payment session error:', error);
                res.status(500).json({ message: error.message }); // Return JSON error
            }
        });

        app.post("/payment/success/:bookingId", verifyFBToken, async (req, res) => {
            const bookingId = req.params.bookingId;

            const booking = await bookingsCollection.findOne({
                _id: new ObjectId(bookingId)
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
                { $inc: { ticketQuantity: -booking.bookingQuantity } }
            );

            await paymentsCollection.insertOne({
                bookingId,
                userEmail: booking.userEmail,
                ticketTitle: booking.ticketTitle,
                amount: booking.totalPrice,
                transactionId: "stripe_txn",
                paymentDate: new Date()
            });

            res.send({ success: true });
        });

        app.get("/user/payments/:email", verifyFBToken, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                return res.status(403).send({ message: "forbidden" });
            }

            const payments = await paymentsCollection
                .find({ userEmail: email })
                .sort({ paymentDate: -1 })
                .toArray();

            res.send(payments);
        });




        //payments api
        app.get("/payments/:email", async (req, res) => {
            const email = req.params.email;
            const result = await paymentsCollection.find({ email }).toArray();
            res.send(result);
        });


        // GET vendor profile
        app.get("/vendors/profile/:email", verifyFBToken, async (req, res) => {
            const email = req.params.email;


            if (req.decoded_email !== email) {

                return res.status(403).send({ message: "Forbidden" });
            }

            const vendor = await userCollection.findOne({ email, role: "vendor" });

            if (!vendor) {
                return res.status(404).send({ message: "Vendor not found" });
            }

            res.send(vendor);
        });


        // vendor get api
        app.get("/users/:email/role", async (req, res) => {

            const email = req.params.email;
            console.log(email)

            const user = await userCollection.findOne({ email });
            console.log(user)

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
            newTicket.isAdvertised = true
            newTicket.create_date = new Date();


            const result = await ticketCollection.insertOne(newTicket);
            res.send(result);
        });
        app.get("/tickets/pending", async (req, res) => {
            const newTicket = req.body;
            newTicket.status = "Pending"
            newTicket.isAdvertised = false
            newTicket.create_date = new Date();


            const result = await ticketCollection.insertOne(newTicket);
            res.send(result);
        });

        // =====================//===============
        app.get("/admin/profile/:email", verifyFBToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const adminInfo = await userCollection.findOne({ email });
            res.send(adminInfo);
        });

        //===================//====================
        app.get("/admin/tickets", verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await ticketCollection.find({ status: "Pending" }).toArray();
            res.send(result);
        });

        //===============//===============
        app.patch("/admin/tickets/approve/:id", verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const result = await ticketCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "approved" } }
            );

            res.send(result);
        });


        ////=================///
        app.patch("/admin/tickets/reject/:id", verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const result = await ticketCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "Rejected" } }
            );

            res.send(result);
        });


        //=======================//===============
        app.get("/admin/users", verifyFBToken, verifyAdmin, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });


        //==========================//=================
        app.patch("/admin/users/role/:id", verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { role } = req.body;

            const result = await userCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );

            res.send(result);
        });


        //=======================//=================
        app.patch("/admin/users/fraud/:id", verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const vendor = await userCollection.findOne({ _id: new ObjectId(id) });

            if (vendor.role !== "vendor") {
                return res.status(400).send({ message: "Not a vendor" });
            }

            // Mark vendor as fraud
            await userCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { isFraud: true } }
            );

            // Hide all vendor tickets
            await ticketCollection.updateMany(
                { vendorEmail: vendor.email },
                { $set: { status: "Hidden" } }
            );

            res.send({ success: true });
        });

        //===========================//======================
        app.get("/admin/approved-tickets", verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await ticketCollection
                .find({ status: "Approved" })
                .toArray();
            res.send(result);
        });


        //==========================//=======================
        app.patch("/admin/tickets/advertise/:id", verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { isAdvertised } = req.body;

            if (isAdvertised) {
                const advertisedCount = await ticketCollection.countDocuments({
                    isAdvertised: true,
                });

                if (advertisedCount >= 6) {
                    return res.status(400).send({
                        message: "Maximum 6 tickets can be advertised",
                    });
                }
            }

            const result = await ticketCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { isAdvertised } }
            );

            res.send(result);
        });

        // isAdvertise Toggle 

        app.patch("/tickets/:id", async (req, res) => {
            const id = req.params.id
            const isAdvertise = req.body
            const query = { _id: new ObjectId(id) }
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
            query.status = 'approved'
            if (email) {
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








