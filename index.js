import express from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";
dotenv.config();
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;
const app = express();

// middleware
const corsOptions = {
  origin: "https://zetroo-69f51.web.app",
  credentials: true,
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// verify token
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.negonxc.mongodb.net/?appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("Zetroo");
    const productCollection = db.collection("products");
    const usersCollection = db.collection("users");
    const orderCollection = db.collection("orders");

    const verifyAdmin = async (req, res, next) => {
      console.log("hello token");
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      console.log(result?.role);
      if (!result || result?.role !== "admin")
        return res.status(401).send({ message: "unauthorized access!!" });

      next();
    };

    // generate token api
    app.post("/jwt", (req, res) => {
      const user = req.body;

      // create token
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "7d",
      });

      //   save token in cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });

      // Inform the frontend
      res.send({ success: true });
    });
    // logout
    app.post("/logout", (req, res) => {
      res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });

      res.send({ success: true });
    });

    // save user in db
    app.post("/user", async (req, res) => {
      try {
        const user = req.body;
        const query = { email: user.email };

        // check if user already exists
        const isExist = await usersCollection.findOne(query);

        if (isExist) {
          return res.send({ message: "User already exists" });
        }

        const result = await usersCollection.insertOne(user);
        res.send({ message: "User saved successfully", result });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get all users (admin only)
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    // GET user by email
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;

      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ role: "guest" });
      }

      res.send({ role: user.role });
    });

    // add product
    app.post("/products", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const product = req.body;
        const result = await productCollection.insertOne(product);
        res.send({ message: "Product added successfully", result });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to add product" });
      }
    });

    // get products (optionally filtered by discount)
    app.get("/products", async (req, res) => {
      try {
        const discount = req.query.discount;
        let query = {};

        if (discount === "true") {
          // products that have discount
          query = { discount: { $gt: 0 } };
        }

        if (discount === "false") {
          // products without discount
          query = {
            $or: [{ discount: 0 }, { discount: { $exists: false } }],
          };
        }

        const result = await productCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send(error);
      }
    });

    // get products filtered by user query
    app.get("/products/filter", async (req, res) => {
      try {
        const { categories, brands, discount, name } = req.query;
        let query = {};

        //  Filter by discount
        if (discount === "true") {
          query.discount = { $gt: 0 };
        } else if (discount === "false") {
          query.$or = [{ discount: 0 }, { discount: { $exists: false } }];
        }

        //  Filter by categories
        if (categories) {
          const categoryArray = Array.isArray(categories)
            ? categories
            : categories.split(",");
          query.category = { $in: categoryArray };
        }

        //  Filter by brands
        if (brands) {
          const brandArray = Array.isArray(brands) ? brands : brands.split(",");
          query.brand = { $in: brandArray };
        }

        //  Filter by product name (search)
        if (name) {
          // case-insensitive search using regex
          query.name = { $regex: name, $options: "i" };
        }
        console.log(query);
        const products = await productCollection.find(query).toArray();
        res.send(products);
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    // Get single product by ID
    app.get("/productDetails/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };
        const product = await productCollection.findOne(query);

        if (!product) {
          return res.status(404).send({ message: "Product not found" });
        }

        res.send(product);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Server error Get single product by ID" });
      }
    });

    // Update a product by ID
    app.put("/products/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedProduct = req.body;

        const result = await productCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedProduct }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Product not found" });
        }

        res.send({ message: "Product updated successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to update product" });
      }
    });

    // Delete a product by ID
    app.delete("/products/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await productCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Product not found" });
        }

        res.send({ message: "Product deleted successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to delete product" });
      }
    });

    // Order save API
    app.post("/orders", verifyToken, async (req, res) => {
      const order = req.body;

      // user only can create his own order
      if (order.email !== req.user.email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      order.createdAt = new Date();
      order.deliveryStatus = "pending";

      const result = await orderCollection.insertOne(order);
      res.send({ success: true, result });
    });

    // User orders get
    app.get("/orders/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.user.email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      const orders = await orderCollection.find({ email }).toArray();
      res.send(orders);
    });

    // Admin Get all orders
    app.get("/orders", verifyToken, verifyAdmin, async (req, res) => {
        try {
            const orders = await orderCollection.find().toArray();
            res.send(orders);
        } catch (error) {
            console.error("Error fetching all orders:", error);
            res.status(500).send({ message: "Failed to retrieve orders.", error });
        }
    });

    // Admin Update delivery status
    app.patch("/orders/status/:id", verifyToken,verifyAdmin,async (req, res) => {
        const { status } = req.body;

        const result = await orderCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { deliveryStatus: status } }
        );

        res.send(result);
      }
    );

    // create-payment-intent
    app.post("/create-payment-intent", async (req, res) => {
      const amount = req.body.amount;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100, // dollars → cents
        currency: "usd",
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  console.log(req.cookies);
  res.send("Hello Zetroo server");
});

app.listen(port, () => {
  console.log(`Zetroo server is running on PORT ${port}`);
});
