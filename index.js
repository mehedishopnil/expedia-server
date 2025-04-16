const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dhkkn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("brianExpediaDB");
    const Users = db.collection("users");
    const Resorts = db.collection("allResorts");
    const Bookings = db.collection("allBookings");

    // === Users === //
    app.post("/users", async (req, res) => {
      const { name, email, photoURL } = req.body;
      if (!name || !email) return res.status(400).json({ error: "Name and email are required" });

      const existing = await Users.findOne({ email });
      if (existing) return res.status(409).json({ error: "User already exists" });

      const user = { name, email, photoURL, isAdmin: false, createdAt: new Date() };
      const result = await Users.insertOne(user);
      res.status(201).json({ message: "User created", data: { _id: result.insertedId, ...user } });
    });

    app.get("/users", async (req, res) => {
      const { email } = req.query;
      const user = await Users.findOne({ email });
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json(user);
    });

    app.get("/all-users", async (_req, res) => {
      const users = await Users.find().toArray();
      res.json(users);
    });

    app.patch("/update-user", async (req, res) => {
      const { email, isAdmin } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const result = await Users.updateOne({ email }, { $set: { isAdmin } });
      res.json({ modified: result.modifiedCount });
    });

    // === Bookings ===
app.post("/bookings", async (req, res) => {
  try {
    const bookingData = req.body;

    // Create booking object with meta info
    const now = new Date();
    const newBooking = {
      ...bookingData,
      bookingId: `TR-${Math.floor(100000 + Math.random() * 900000)}`,
      createdAt: now,
      updatedAt: now,
      paymentDate: now
    };

    // Insert into DB
    const result = await Bookings.insertOne(newBooking);

    // Send response back
    res.status(201).json({
      message: "Booking confirmed successfully",
      bookingId: newBooking.bookingId,
      data: {
        ...newBooking,
        _id: result.insertedId,
        paymentInfo: newBooking.paymentInfo?.cardNumber
          ? {
              ...newBooking.paymentInfo,
              cardNumber: maskCardNumber(newBooking.paymentInfo.cardNumber)
            }
          : newBooking.paymentInfo
      }
    });

  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
});

// Helper to mask card numbers
function maskCardNumber(cardNumber) {
  const last4 = cardNumber.slice(-4);
  return `•••• •••• •••• ${last4}`;
}


// Get user bookings
app.get("/bookings", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const bookings = await Bookings.find({ email })
      .sort({ createdAt: -1 })
      .project({
        paymentInfo: 0 // Exclude payment details from listing
      })
      .toArray();

    res.json({ 
      count: bookings.length, 
      data: bookings.map(booking => ({
        ...booking,
        // Format dates for display
        startDate: formatDisplayDate(booking.startDate),
        endDate: formatDisplayDate(booking.endDate)
      }))
    });

  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin booking management
app.get("/admin/bookings", async (req, res) => {
  try {
    const { status, resortId, startDate, endDate } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (resortId) query.resortId = resortId;
    
    // Date range filtering
    if (startDate && endDate) {
      query.startDate = { $gte: new Date(startDate) };
      query.endDate = { $lte: new Date(endDate) };
    }

    const bookings = await Bookings.find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ 
      count: bookings.length, 
      data: bookings 
    });

  } catch (error) {
    console.error("Admin bookings error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Cancel booking
app.put("/bookings/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;

    const booking = await Bookings.findOne({ _id: new ObjectId(id) });
    
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Check if booking can be cancelled
    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "Booking already cancelled" });
    }

    const now = new Date();
    const refundDeadline = new Date(booking.startDate);
    refundDeadline.setDate(refundDeadline.getDate() - 3); // 3-day cancellation policy

    const update = {
      status: "cancelled",
      updatedAt: now,
      cancellation: {
        date: now,
        reason: cancellationReason || "User requested",
        refundEligible: now < refundDeadline
      }
    };

    await Bookings.updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );

    // Process refund if eligible (pseudo-code)
    // if (update.cancellation.refundEligible) {
    //   await processRefund(booking.paymentInfo);
    // }

    res.json({ 
      message: "Booking cancelled successfully",
      refundEligible: update.cancellation.refundEligible
    });

  } catch (error) {
    console.error("Cancel booking error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Helper function to format dates for display
function formatDisplayDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

    // === Resorts ===
    app.get("/allResorts", async (_req, res) => {
      const resorts = await Resorts.find().toArray();
      res.json(resorts);
    });

    app.post("/resorts", async (req, res) => {
      const result = await Resorts.insertOne(req.body);
      res.json(result);
    });

    // Health
    app.get("/", (_req, res) => res.send("Server is running"));
    app.get("/health", (_req, res) =>
      res.json({ status: "ok", time: new Date(), db: client.topology?.isConnected() ? "connected" : "disconnected" })
    );

    // Start Server
    app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
  } catch (err) {
    console.error("❌ MongoDB Connection Failed", err);
    process.exit(1);
  }
}

run().catch(console.dir);

// Graceful Shutdown
["SIGINT", "SIGTERM"].forEach(signal =>
  process.on(signal, async () => {
    console.log(`👋 Received ${signal}, closing MongoDB`);
    await client.close();
    process.exit(0);
  })
);
