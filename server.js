import express from "express";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import nodemailer from "nodemailer";
import crypto from "crypto";
import admin from "firebase-admin";

// Initialize Firebase Admin (If serviceAccountKey.json is missing, this will fail or require env vars)
// We'll wrap it in a try-catch so the server still boots for image uploads if the key is missing.
try {
  // If the user places serviceAccountKey.json in the backend folder, it will be picked up.
  // Otherwise, it might use default credentials if deployed on GCP.
  admin.initializeApp({
    credential: admin.credential.applicationDefault() // Or require('./serviceAccountKey.json')
  });
  console.log("Firebase Admin initialized.");
} catch (e) {
  console.error("Firebase Admin initialization failed. Reset password won't work without credentials.", e);
}

const app = express();
const PORT = process.env.PORT || 8080;

/* -----------------------------
   Cloudinary Configuration
----------------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/* -----------------------------
   Middleware
----------------------------- */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(morgan("tiny"));

/* -----------------------------
   Multer setup (memory upload)
----------------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

/* -----------------------------
   Health Check
----------------------------- */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    cloudinaryConfigured: Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ),
    version: "1.0.1"
  });
});

/* -----------------------------
   Image Upload Endpoint
----------------------------- */
app.post("/upload", upload.single("image"), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({
        error: "No image file provided. Use form field 'image'."
      });
    }

    const folder = "buildview/avatars";
    const publicId = `avatar_${Date.now()}`;

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        public_id: publicId,
        resource_type: "image"
      },
      (error, result) => {

        if (error) {
          console.error("Cloudinary Error:", error);

          return res.status(500).json({
            error: "Cloudinary upload failed",
            details: error.message
          });
        }

        return res.json({
          secure_url: result.secure_url,
          url: result.url,
          public_id: result.public_id,
          original_filename: req.file.originalname
        });
      }
    );

    stream.end(req.file.buffer);

  } catch (err) {

    console.error("Server Error:", err);

    res.status(500).json({
      error: "Unexpected server error",
      details: err.message
    });

  }
});



/* -----------------------------
   OTP Store & Mailer Setup
----------------------------- */
const otpStore = new Map(); // Stores { email: { otp: string, expiresAt: number, verified: boolean } }

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "buildview35@gmail.com",
    pass: "dhhv xszx lctv zxof"
  }
});

/* -----------------------------
   OTP / Forgot Password Endpoints
----------------------------- */
app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes from now

    otpStore.set(email, { otp, expiresAt, verified: false });

    // Send email
    await transporter.sendMail({
      from: '"BuildView Support" <buildview35@gmail.com>',
      to: email,
      subject: "Password Reset Code",
      text: `Your password reset code is: ${otp}\nThis code will expire in 10 minutes.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2>Password Reset Request</h2>
          <p>You requested to reset your password for BuildView.</p>
          <p>Your 6-digit verification code is:</p>
          <h1 style="color: #0055FF; letter-spacing: 5px; padding: 10px; background: #f0f4ff; display: inline-block; border-radius: 8px;">${otp}</h1>
          <p>This code will expire in 10 minutes.</p>
          <p>If you did not request this, please ignore this email.</p>
        </div>
      `
    });

    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ error: "Failed to process request", details: err.message });
  }
});

app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });

  const storedData = otpStore.get(email);
  
  if (!storedData) {
    return res.status(400).json({ error: "No OTP found for this email or it has expired" });
  }

  if (Date.now() > storedData.expiresAt) {
    otpStore.delete(email);
    return res.status(400).json({ error: "OTP has expired. Please request a new one." });
  }

  if (storedData.otp !== otp) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  // Mark as verified
  otpStore.set(email, { ...storedData, verified: true });
  
  res.json({ success: true, message: "OTP verified successfully" });
});

app.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword, otp } = req.body;
    if (!email || !newPassword || !otp) {
      return res.status(400).json({ error: "Email, new password, and OTP are required" });
    }

    const storedData = otpStore.get(email);
    if (!storedData || !storedData.verified || storedData.otp !== otp) {
      return res.status(401).json({ error: "Unauthorized request. Please verify OTP first." });
    }

    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ error: "Session expired. Please start over." });
    }

    // Use Firebase Admin to update the user's password
    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(userRecord.uid, {
      password: newPassword
    });

    // Clear the OTP store for this email
    otpStore.delete(email);

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ error: "Failed to reset password", details: err.message });
  }
});

/* -----------------------------
   404 Handler
----------------------------- */
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found"
  });
});

/* -----------------------------
   Start Server
----------------------------- */
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});