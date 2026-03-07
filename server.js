import express from "express";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

const app = express();
const PORT = process.env.PORT || 8080;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(morgan("tiny"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.get("/health", (req, res) => {
  res.json({ ok: true, cloudinaryConfigured: Boolean(process.env.CLOUDINARY_URL), version: "1.0.0" });
});

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided. Use form field 'image'." });
    }
    const folder = "buildview/avatars";
    const publicId = `avatar_${Date.now()}`;

    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: "image" },
      (error, result) => {
        if (error) {
          return res.status(500).json({ error: "Cloudinary upload failed", details: error.message });
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
    res.status(500).json({ error: "Unexpected server error", details: err.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

