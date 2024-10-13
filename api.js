const express = require('express');
const router = express.Router();
const axios = require("axios");
const moment = require("moment");
const nodemailer = require('nodemailer');
require('dotenv').config();

const client = require('./mongodb'); // Import the MongoDB client

const dbName = 'Mirage'; // Specify your database name
const collectionName = 'MirageCollection'; // Specify your collection name
const seatsCollectionName = 'seats'; // Collection name for seats

// Function to get access token
async function getAccessToken() {
  const consumer_key = process.env.CONSUMER_KEY;
  const consumer_secret = process.env.CONSUMER_SECRET;
  const url = "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
  const auth = "Basic " + Buffer.from(consumer_key + ":" + consumer_secret).toString("base64");

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: auth,
      },
    });
    return response.data.access_token;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get access token");
  }
}

const shortcode = process.env.MPESA_PAYBILL;

// MPESA STK push route
router.post("/api/stkpush", async (req, res) => {
  let { name, email, phone, amount, ticketType, totalQuantity, seats } = req.body;

  // Conditionally process seats only for VIP tickets
  let seatsString = "";
  if (ticketType === "vip" && seats && seats.length > 0) {
    // Convert seats array to a comma-separated string for VIP tickets
    seatsString = seats.join(",");
  }

  // Validate required fields
  if (!name || !email || !phone || amount === undefined || ticketType === undefined || typeof totalQuantity !== 'number') {
    return res.status(400).json({ error: "Missing or invalid required fields" });
  }

  // Format the phone number if it starts with 0
  if (phone.startsWith("0")) {
    phone = "254" + phone.slice(1);
  }

  try {
    const accessToken = await getAccessToken();
    const url = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
    const auth = "Bearer " + accessToken;
    const timestamp = moment().format("YYYYMMDDHHmmss");
    const password = Buffer.from(
      shortcode + process.env.MPESA_PASSKEY + timestamp
    ).toString("base64");

    const response = await axios.post(url, {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: "MIRAGE THEATRICS",
      TransactionDesc: "Mpesa Daraja API stk push test",
    }, {
      headers: { Authorization: auth },
    });

    const { CheckoutRequestID } = response.data;

    // Store the transaction details in MongoDB
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    await collection.insertOne({
      name,
      email,
      phone,
      amount,
      ticketType,
      totalQuantity,
      seats: seatsString, // Store as a comma-separated string for VIP tickets
      CheckoutRequestID,
      timestamp,
      status: "PENDING",
    });

    // Update seat statuses to "sold" only for VIP tickets
    if (ticketType === "vip" && seats && seats.length > 0) {
      const seatsArray = seats.map(Number); // Convert seats to numbers
      const seatUpdateResult = await db.collection(seatsCollectionName).updateMany(
        { seatNumber: { $in: seatsArray } },
        { $set: { status: "sold" } }
      );
      console.log(`Updated ${seatUpdateResult.modifiedCount} seats to "sold"`);
    }

    console.log(response.data);
    res.status(200).json({
      msg: "Request is successfully done ✔✔. Please enter mpesa pin to complete the transaction",
      status: true,
      transactionId: CheckoutRequestID
    });
  } catch (error) {
    console.error("Error during STK Push:", error.message);
    res.status(500).json({
      msg: "Request failed",
      status: false,
      error: error.message,
    });
  }
});

// STK push callback route (no changes)
router.post("/api/callback", async (req, res) => {
  console.log("STK PUSH CALLBACK");
  const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = req.body.Body.stkCallback;

  if (ResultCode === 0) {
    const { Item } = CallbackMetadata;
    const amount = Item.find(item => item.Name === 'Amount').Value;
    const mpesaReceiptNumber = Item.find(item => item.Name === 'MpesaReceiptNumber').Value;
    const transactionDate = Item.find(item => item.Name === 'TransactionDate').Value;
    const phoneNumber = Item.find(item => item.Name === 'PhoneNumber').Value;

    console.log("Payment Successful:");
    console.log("MerchantRequestID:", MerchantRequestID);
    console.log("CheckoutRequestID:", CheckoutRequestID);
    console.log("ResultDesc:", ResultDesc);
    console.log("Amount:", amount);
    console.log("MpesaReceiptNumber:", mpesaReceiptNumber);
    console.log("TransactionDate:", transactionDate);
    console.log("PhoneNumber:", phoneNumber);

    // Send confirmation email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: req.body.email, // Assuming email is passed in the callback
      subject: 'Ticket Purchase Confirmation',
      text: `Dear ${req.body.name},\n\nYour payment of KES ${amount} was successful. Please check your email for further instructions or ticket information.\n\nThank you for your purchase!\n\nBest regards,\nThe Team`,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("Email sent successfully");
    } catch (emailError) {
      console.error("Error sending email:", emailError.message);
    }

    // Handle successful payment (e.g., update database, notify user, etc.)
  } else {
    console.log("Payment Failed:");
    console.log("MerchantRequestID:", MerchantRequestID);
    console.log("CheckoutRequestID:", CheckoutRequestID);
    console.log("ResultDesc:", ResultDesc);
  }

  res.status(200).send("Callback received");
});

// Payment status check route (no changes)
router.get("/api/payment-status/:checkoutRequestID", async (req, res) => {
  const { checkoutRequestID } = req.params;
  try {
    const db = client.db(dbName);
    const result = await db.collection(collectionName).findOne({ CheckoutRequestID });
    const status = result ? result.status : "Not Found";
    res.json({ status });
  } catch (error) {
    console.error("Error fetching payment status:", error);
    res.status(500).json({ message: "Failed to fetch payment status" });
  }
});

// Fetch seat status route (no changes)
router.get('/seats-status', async (req, res) => {
  try {
    const seats = await client.db(dbName).collection(seatsCollectionName).find({}).toArray();
    const seatStatus = seats.reduce((acc, seat) => {
      acc[seat.seatNumber] = seat.status;
      return acc;
    }, {});
    res.json(seatStatus);
  } catch (error) {
    console.error("Error fetching seat status:", error);
    res.status(500).json({ message: "Failed to fetch seat status" });
  }
});

module.exports = router;
