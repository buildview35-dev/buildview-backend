import express from "express";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import crypto from "crypto";
import admin from "firebase-admin";
import axios from "axios";

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
app.use(express.json());

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
   OTP Store & Brevo Config
----------------------------- */
const otpStore = new Map(); // Stores { email: { otp: string, expiresAt: number, verified: boolean } }

const brevoConfig = {
  apiKey: "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",
  senderEmail: "candari.arvin@gmail.com",
  senderName: "BuildView"
};

const emailJsConfig = {
  serviceId: "service_jdf79hm",
  templateId: "template_g67x3mp",
  publicKey: "wKfRS2OvlD5r9ShaE",
  privateKey: "Hr7y90kpHXU97p32grVm4"
};

async function sendOtpViaBrevoApi(email, otp) {
  return axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: {
        email: brevoConfig.senderEmail,
        name: brevoConfig.senderName
      },
      to: [{ email }],
      subject: "BuildView Password Reset OTP",
      htmlContent: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>BuildView Password Reset</h2>
          <p>Your one-time password is:</p>
          <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
          <p>This OTP will expire in 10 minutes.</p>
        </div>
      `
    },
    {
      headers: {
        "api-key": brevoConfig.apiKey,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      timeout: 10000
    }
  );
}

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

    const response = await sendOtpViaBrevoApi(email, otp);
    if (response.status >= 200 && response.status < 300) {
      return res.json({ success: true, message: "OTP sent successfully via Brevo API" });
    }

    throw new Error(`Brevo API Error: ${JSON.stringify(response.data)}`);
  } catch (err) {
    const brevoError = err.response?.data || err.message;
    console.error("Forgot Password Error:", brevoError);
    res.status(500).json({ error: "Failed to process request", details: JSON.stringify(brevoError) });
  }
});

app.post("/emailjs/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const recipientEmail = email;

    const payload = {
      service_id: emailJsConfig.serviceId,
      template_id: emailJsConfig.templateId,
      user_id: emailJsConfig.publicKey,
      accessToken: emailJsConfig.privateKey,
      template_params: {
        // Include multiple common field names so different EmailJS templates still resolve recipient/message.
        to_email: recipientEmail,
        email: recipientEmail,
        user_email: recipientEmail,
        recipient: recipientEmail,
        to: recipientEmail,
        from_name: "BuildView",
        to_name: "BuildView User",
        subject: "BuildView Password Reset",
        message: `A forgot-password request was triggered for ${recipientEmail}.`,
        requested_at: new Date().toISOString()
      }
    };

    const response = await axios.post(
      "https://api.emailjs.com/api/v1.0/email/send",
      payload,
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    console.log("EmailJS send success:", {
      recipientEmail,
      status: response.status,
      data: response.data
    });

    return res.json({
      success: true,
      message: "EmailJS forgot-password email request sent",
      status: response.status,
      recipientEmail,
      emailJsResponse: response.data
    });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error("EmailJS Forgot Password Error:", details);
    return res.status(500).json({
      error: "Failed to send forgot-password email via EmailJS",
      details: typeof details === "string" ? details : JSON.stringify(details)
    });
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
