import express from "express";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

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
