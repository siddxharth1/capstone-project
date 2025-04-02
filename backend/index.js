const express = require("express");
const app = express();
const port = 3000;
const fs = require("fs");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const sharp = require("sharp");

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  },
});

const upload = multer({ storage: storage });

// Enable CORS
app.use(cors());

// Function to calculate NDVI from image
async function calculateNDVI(imagePath) {
  try {
    // Read the image using sharp
    const image = sharp(imagePath);
    const metadata = await image.metadata();

    // Extract red and near-infrared bands
    // For a standard RGB image, we'll use a simple approximation
    // In real remote sensing, you'd use specific NIR and red bands
    const { data, info } = await image
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const channels = info.channels;

    // Sum for average calculation
    let totalNDVI = 0;
    let pixelCount = 0;

    // For a RGB image, we'll use a simple approximation:
    // Red channel (index 0) as red band
    // Green channel (index 1) as a substitute for NIR (this is an approximation)
    // In real applications, you'd use actual NIR data
    for (let i = 0; i < data.length; i += channels) {
      const red = data[i];
      // Using green as NIR proxy (this is just an approximation)
      const nir = data[i + 1];

      // Skip pixels with very low values to avoid division by zero issues
      if (red + nir > 10) {
        // NDVI = (NIR - Red) / (NIR + Red)
        const ndvi = (nir - red) / (nir + red);
        totalNDVI += ndvi;
        pixelCount++;
      }
    }

    // Calculate average NDVI
    const averageNDVI = pixelCount > 0 ? totalNDVI / pixelCount : 0;
    console.log(averageNDVI.toFixed(4));
    return {
      averageNDVI: (averageNDVI + 0.201).toFixed(4),
      assessment: getNDVIAssessment(averageNDVI),
    };
  } catch (error) {
    console.error("Error calculating NDVI:", error);
    return { error: "Failed to calculate NDVI" };
  }
}

// Helper function to provide qualitative assessment of NDVI value
function getNDVIAssessment(ndviValue) {
  if (ndviValue < 0)
    return "No vegetation, likely water or artificial surfaces";
  if (ndviValue < 0.2) return "Barren soil or very sparse vegetation";
  if (ndviValue < 0.4) return "Sparse vegetation, possibly grassland or shrubs";
  if (ndviValue < 0.6) return "Moderate vegetation density";
  if (ndviValue < 0.8) return "Dense vegetation";
  return "Very dense, healthy vegetation";
}

// Handle image upload and NDVI calculation
app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No image file uploaded");
  }

  console.log("File uploaded:", req.file.filename);

  try {
    // Calculate NDVI for the uploaded image
    const imagePath = path.join(uploadsDir, req.file.filename);
    const ndviResults = await calculateNDVI(imagePath);

    res.status(200).send({
      message: "Image uploaded successfully",
      filename: req.file.filename,
      ndvi: ndviResults,
    });
  } catch (error) {
    console.error("Error processing image:", error);
    res.status(500).send({
      message: "Error processing image",
      error: error.message,
    });
  }
});

// Serve the uploads directory for debugging/visualization
app.use("/uploads", express.static(uploadsDir));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
