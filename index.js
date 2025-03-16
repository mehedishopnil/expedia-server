const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Validate environment variables
if (!process.env.DB_PASS) {
  console.error("DB_PASS environment variable is missing.");
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(helmet()); // Add security headers
app.use(morgan("combined")); // Log incoming requests

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// MongoDB connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dhkkn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;



const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("brianExpediaDB");
    const allResortDataCollection = db.collection("allResorts");
    const usersCollection = db.collection("users");

    // ==================== Users Routes ====================
    app.post("/users", async (req, res) => {
      try {
        const { name, email } = req.body;

        if (!name || !email) {
          return res.status(400).send("Name and email are required");
        }

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(409).send("User with this email already exists");
        }

        const result = await usersCollection.insertOne(req.body);
        res.status(201).send({
          message: "User successfully added",
          userId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding user data:", error.message);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/users", async (req, res) => {
      const { email } = req.query;

      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        res.json(user);
      } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/all-users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching all user data:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.patch("/update-user", async (req, res) => {
      const { email, isAdmin } = req.body;

      try {
        if (!email || typeof isAdmin !== "boolean") {
          return res.status(400).send("Email and isAdmin status are required");
        }

        const result = await usersCollection.updateOne(
          { email },
          { $set: { isAdmin } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send("User not found or role not updated");
        }

        res.send({ success: true, message: "User role updated successfully" });
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.patch("/update-user-info", async (req, res) => {
      const { email, age, securityDeposit, idNumber } = req.body;

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { age, securityDeposit, idNumber } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "User not found or information not updated.",
          });
        }

        res.json({
          success: true,
          message: "User information updated successfully.",
        });
      } catch (error) {
        console.error("Error updating user info:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
      }
    });

    // ==================== Resorts Routes ====================
    app.get("/allResorts", async (req, res) => {
     try {
       const resorts = await allResortDataCollection.find().toArray();
       res.send(resorts);
     } catch (error) {
       console.error("Error fetching all resort data:", error);
       res.status(500).send("Internal Server Error");
     }
   });

    app.post("/resorts", async (req, res) => {
      try {
        const resort = req.body;
        const result = await allResortDataCollection.insertOne(resort);
        res.send(result);
      } catch (error) {
        console.error("Error adding resort data:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // ==================== Bookings Routes ====================
    // Placeholder for bookings routes
    app.get("/bookings", (req, res) => {
      res.send("Bookings routes will be implemented here.");
    });

    // Health check route
    app.get("/", (req, res) => {
      res.send("Expedia brian server is running");
    });

    // Start the server
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}



// Run the server
run().catch(console.dir);

// Gracefully close the MongoDB connection on process termination
process.on("SIGINT", async () => {
  await client.close();
  console.log("MongoDB connection closed.");
  process.exit();
});