// routes/Driverauth.js
const express = require("express");
const router = express.Router();

const Driver = require("../models/Drivers");
const Notification = require("../models/Notification");

const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailer");

// --- Cloudinary + Multer (memory) ---
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../utils/cloudinaryConfig");
const Tesseract = require("tesseract.js");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

let sharp = null;
try {
  sharp = require("sharp"); // optional
} catch (_) {
  // ok if not installed
}


// ---------- helpers ----------
function getBaseUrl(req) {
  return (
    process.env.BACKEND_BASE_URL ||
    `${(req.headers["x-forwarded-proto"] || req.protocol)}://${req.get("host")}`
  );
}

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const up = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(up);
  });
}

function normalizePHMobile(input) {
  if (!input) return null;
  let s = String(input).replace(/[^\d+0-9]/g, "");
  if (s.startsWith("+639") && s.length === 13) return "0" + s.slice(3);
  if (s.startsWith("09") && s.length === 11) return s;
  return null;
}

async function safeDestroy(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });
  } catch (e) {
    console.warn("⚠️ Cloudinary destroy failed:", publicId, e?.message);
  }
}

// ✅ create internal notification helper
async function pushNotif({ userId, userType, category, title, message, meta = {} }) {
  try {
    if (!userId) return;
    await Notification.create({
      userId,
      userType, // "driver" or "passenger"
      category, // "verification" | "report" | "feedback" | "notice"
      title,
      message,
      meta,
      createdByAdminName: "System",
    });
  } catch (e) {
    console.warn("⚠️ pushNotif failed:", e?.message);
  }
}

// ===================================================================
// ================ G C A S H   E N D P O I N T S =====================
// ===================================================================

router.get("/:id/payment-info", async (req, res) => {
  try {
    const d = await Driver.findById(req.params.id).select(
      "gcashNumber gcashQRUrl gcashQRPublicId"
    );
    if (!d) return res.status(404).json({ ok: false, error: "Driver not found" });

    return res.json({
      ok: true,
      gcashNumber: d.gcashNumber || "",
      gcashQRUrl: d.gcashQRUrl || null,
      gcashQRPublicId: d.gcashQRPublicId || null,
    });
  } catch (e) {
    console.error("payment-info error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/:id/gcash-number", async (req, res) => {
  try {
    const { id } = req.params;
    const normalized = normalizePHMobile(req.body?.gcashNumber);
    if (!normalized) {
      return res.status(400).json({
        ok: false,
        error: "Invalid PH mobile. Use 09xxxxxxxxx or +639xxxxxxxxx",
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      id,
      { gcashNumber: normalized },
      { new: true, select: "_id driverName gcashNumber" }
    );

    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });
    return res.json({ ok: true, gcashNumber: driver.gcashNumber });
  } catch (err) {
    console.error("GCASH_NUM_SAVE", err);
    return res.status(500).json({ ok: false, error: "Save failed" });
  }
});

router.post("/:id/gcash-qr", upload.single("qr"), async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "No image uploaded" });
    }

    const current = await Driver.findById(id).select("gcashQRPublicId");
    if (!current) return res.status(404).json({ ok: false, error: "Driver not found" });

    const oldPublicId = current.gcashQRPublicId || null;

    const up = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "toda-go/gcash-qrs",
      resource_type: "image",
      transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
      public_id: `driver_${id}_gcashqr_${Date.now()}`,
    });

    const driver = await Driver.findByIdAndUpdate(
      id,
      { gcashQRUrl: up.secure_url, gcashQRPublicId: up.public_id },
      { new: true, select: "_id driverName gcashQRUrl gcashQRPublicId" }
    );

    if (oldPublicId && oldPublicId !== up.public_id) safeDestroy(oldPublicId);

    return res.json({
      ok: true,
      gcashQRUrl: driver.gcashQRUrl,
      gcashQRPublicId: driver.gcashQRPublicId,
    });
  } catch (err) {
    console.error("GCASH_QR_UPLOAD", err);
    return res.status(500).json({ ok: false, error: "Upload failed" });
  }
});

// ===================================================================
// ==================== R E G I S T R A T I O N ======================
// ===================================================================

router.post(
  "/register-driver",
  upload.fields([
    { name: "selfie", maxCount: 1 },
    { name: "driversLicenseImage", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        driverEmail,
        driverPassword,

        driverFirstName,
        driverMiddleName,
        driverLastName,
        driverSuffix,
        driverBirthdate,
        driverPhone,

        franchiseNumber,
        plateNumber,
        todaName,
        sector,
        experienceYears,
        capacity,
        trikeColor,
      } = req.body;

      if (!driverEmail || !driverPassword) {
        return res.status(400).json({
          error: "Email and password are required",
        });
      }

      if (!driverFirstName || !driverLastName || !driverBirthdate || !driverPhone) {
        return res.status(400).json({
          error: "Driver personal details are incomplete",
        });
      }

      if (!franchiseNumber || !todaName || !sector || !experienceYears || !plateNumber) {
        return res.status(400).json({
          error: "Franchise and tricycle details are incomplete",
        });
      }

      if (!req.files?.driversLicenseImage?.[0]) {
        return res.status(400).json({
          error: "Driver's license image is required",
        });
      }

      if (!req.files?.selfie?.[0]) {
        return res.status(400).json({
          error: "Selfie image is required",
        });
      }

      const normalizedEmail = String(driverEmail).trim().toLowerCase();

      const existingDriver = await Driver.findOne({ email: normalizedEmail });
      if (existingDriver) {
        return res.status(400).json({
          error: "Driver already exists",
        });
      }

      const sectorEnum = ["East", "West", "North", "South", "Other"];
      if (!sectorEnum.includes(sector)) {
        return res.status(400).json({
          error: "Invalid sector",
        });
      }

      const experienceEnum = ["1-5 taon", "6-10 taon", "16-20 taon", "20 taon pataas"];
      if (!experienceEnum.includes(experienceYears)) {
        return res.status(400).json({
          error: "Invalid driving experience",
        });
      }

      const colorEnum = ["yellow", "green", ""];
      if (!colorEnum.includes(trikeColor || "")) {
        return res.status(400).json({
          error: "Invalid tricycle color",
        });
      }

      const birthDateObj = new Date(driverBirthdate);
      if (Number.isNaN(birthDateObj.getTime())) {
        return res.status(400).json({
          error: "Invalid birthdate",
        });
      }

      const today = new Date();
      const adultLimit = new Date(
        today.getFullYear() - 18,
        today.getMonth(),
        today.getDate()
      );

      if (birthDateObj > adultLimit) {
        return res.status(400).json({
          error: "Driver must be at least 18 years old",
        });
      }

      const profileID = uuidv4();
      const cap = Math.min(6, Math.max(1, Number(capacity) || 4));
      const savedImgs = {};

      const licenseUpload = await uploadBufferToCloudinary(
        req.files.driversLicenseImage[0].buffer,
        {
          folder: "toda-go/licenses",
          resource_type: "image",
          transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
        }
      );

      savedImgs.driversLicenseImage = licenseUpload.secure_url;
      savedImgs.driversLicenseImagePublicId = licenseUpload.public_id;

      const selfieUpload = await uploadBufferToCloudinary(req.files.selfie[0].buffer, {
        folder: "toda-go/selfies",
        resource_type: "image",
        transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
      });

      savedImgs.selfieImage = selfieUpload.secure_url;
      savedImgs.selfieImagePublicId = selfieUpload.public_id;

      const dFirst = String(driverFirstName || "").trim();
      const dMiddle = String(driverMiddleName || "").trim();
      const dLast = String(driverLastName || "").trim();
      const dSuffix = String(driverSuffix || "").trim();

      const driverName = [dFirst, dMiddle, dLast, dSuffix]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const newDriver = new Driver({
        profileID,

        email: normalizedEmail,
        password: driverPassword,
        isVerified: false,

        driverVerified: false,
        driverVerification: {
          status: "unverify",
          reviewedAt: null,
          rejectionReason: null,
          reviewedByAdminId: null,
        },

        driverFirstName: dFirst,
        driverMiddleName: dMiddle,
        driverLastName: dLast,
        driverSuffix: dSuffix,
        driverName,
        driverBirthdate: String(driverBirthdate).trim(),
        driverPhone: String(driverPhone).trim(),

        franchiseNumber: String(franchiseNumber).trim(),
        todaName: String(todaName).trim(),
        sector: String(sector).trim(),
        experienceYears: String(experienceYears).trim(),
        plateNumber: String(plateNumber).trim().toUpperCase(),
        trikeColor: trikeColor || "",
        capacity: cap,

        driversLicenseImage: savedImgs.driversLicenseImage,
        driversLicenseImagePublicId: savedImgs.driversLicenseImagePublicId,
        selfieImage: savedImgs.selfieImage,
        selfieImagePublicId: savedImgs.selfieImagePublicId,
      });

      await newDriver.save();

      const baseUrl = getBaseUrl(req);

      const token = jwt.sign(
        { kind: "driver", id: String(newDriver._id) },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
      );

      const verifyUrl = `${baseUrl}/api/auth/driver/verify-email?token=${encodeURIComponent(
        token
      )}`;

      await sendMail({
        to: newDriver.email,
        subject: "Verify your TodaGo Driver Account",
        html: `
          <p>Hello ${newDriver.driverName || "Driver"},</p>
          <p>Please verify your account:</p>
          <p>
            <a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#1a73e8;color:#fff;border-radius:6px;text-decoration:none">
              Verify Email
            </a>
          </p>
          <p>Or paste this link: ${verifyUrl}</p>
          <p>After email verification, your driver account will still be reviewed by the admin.</p>
        `,
        text: `Hello ${newDriver.driverName || "Driver"}, verify your account here: ${verifyUrl}`,
      });

      await pushNotif({
        userId: newDriver._id,
        userType: "driver",
        category: "verification",
        title: "Verify your email",
        message: "We sent you a verification link. Please check your email and Spam folder.",
        meta: {
          sentTo: newDriver.email,
          kind: "driver",
        },
      });

      return res.status(201).json({
        message:
          "Registration successful. Please verify your email. Your driver account will be reviewed by the admin.",
      });
    } catch (error) {
      console.error("Driver registration failed:", error);
      return res.status(500).json({
        error: "Server error",
        details: error.message,
      });
    }
  }
);


router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) return res.status(400).send("Missing token");

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(400).send("Invalid or expired verification link");
    }

    const id = decoded.id;

    if (!id) {
      return res.status(400).send("Invalid token payload");
    }

    const driver = await Driver.findById(id);

    if (!driver) {
      return res.status(404).send("Account not found");
    }

    if (driver.isVerified) {
      return res.send("Already verified. You can log in.");
    }

    driver.isVerified = true;
    await driver.save();

    await pushNotif({
      userId: driver._id,
      userType: "driver",
      category: "verification",
      title: "Email verified",
      message: "Your email has been verified successfully. Please wait for admin driver verification.",
      meta: {
        driverId: String(driver._id),
      },
    });

    return res.send("✅ Driver email verified! Please wait for admin verification.");
  } catch (e) {
    console.error("driver verify-email error:", e);
    return res.status(500).send("Server error");
  }
});

// ✅ resend verification now also saves notification
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const driver = await Driver.findOne({ email });
    if (!driver) return res.status(404).json({ message: "No driver found" });
    if (driver.isVerified) return res.json({ message: "Already verified" });

    const baseUrl = process.env.BACKEND_BASE_URL;
    const token = jwt.sign({ kind: "driver", id: String(driver._id) }, process.env.JWT_SECRET, { expiresIn: "1d" });
    const verifyUrl = `${baseUrl}/api/auth/driver/verify-email?token=${encodeURIComponent(token)}`;

    try {
      await sendMail({
        to: driver.email,
        subject: "Verify your TodaGo Driver Account",
        html: `
          <p>Hello ${driver.driverFirstName || "Driver"},</p>
          <p>Please verify your account by clicking below (expires in 24 hours):</p>
          <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#1a73e8;color:#fff;border-radius:6px;text-decoration:none">Verify Email</a></p>
          <p>If the button doesn't work, copy and paste:<br>${verifyUrl}</p>
        `,
        text: `Verify: ${verifyUrl}`,
      });
    } catch (e) {
      console.error("❌ driver resend sendMail failed:", e.message);
    }

    await pushNotif({
      userId: driver._id,
      userType: "driver",
      category: "verification",
      title: "Verification link resent",
      message: "We resent your email verification link. Please check your inbox (and Spam).",
      meta: { sentTo: driver.email },
    });

    return res.json({ message: "Verification email sent" });
  } catch (e) {
    console.error("driver resend-verification error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});



// Reuse a single worker (faster on repeated calls)
let _workerPromise = null;
async function getOcrWorker() {
  if (_workerPromise) return _workerPromise;

  _workerPromise = (async () => {
    const worker = await Tesseract.createWorker("eng");
    return worker;
  })();

  return _workerPromise;
}

// basic text cleanup
function cleanText(s) {
  return String(s || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Try to find a date in many common formats and return YYYY-MM-DD if possible
function extractBirthdate(text) {
  const t = text;

  // Examples:
  // 1994-03-21
  // 03/21/1994
  // 21/03/1994
  // Mar 21 1994
  const iso = t.match(/\b(19|20)\d{2}[-/.](0?\d|1[0-2])[-/.]([0-2]?\d|3[01])\b/);
  if (iso) {
    const yyyy = iso[0].slice(0, 4);
    const parts = iso[0].slice(5).split(/[-/.]/);
    const mm = String(parts[0]).padStart(2, "0");
    const dd = String(parts[1]).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const mdy = t.match(/\b(0?\d|1[0-2])[-/.]([0-2]?\d|3[01])[-/.]((19|20)\d{2})\b/);
  if (mdy) {
    const mm = String(mdy[1]).padStart(2, "0");
    const dd = String(mdy[2]).padStart(2, "0");
    const yyyy = mdy[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const dmy = t.match(/\b([0-2]?\d|3[01])[-/.](0?\d|1[0-2])[-/.]((19|20)\d{2})\b/);
  if (dmy) {
    const dd = String(dmy[1]).padStart(2, "0");
    const mm = String(dmy[2]).padStart(2, "0");
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const monthNames =
    "(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)";
  const mon = t.toLowerCase().match(new RegExp(`\\b${monthNames}\\s+([0-2]?\\d|3[01])[,\\s]+((19|20)\\d{2})\\b`, "i"));
  if (mon) {
    const map = {
      jan: "01", january: "01",
      feb: "02", february: "02",
      mar: "03", march: "03",
      apr: "04", april: "04",
      may: "05",
      jun: "06", june: "06",
      jul: "07", july: "07",
      aug: "08", august: "08",
      sep: "09", sept: "09", september: "09",
      oct: "10", october: "10",
      nov: "11", november: "11",
      dec: "12", december: "12",
    };
    const m = map[mon[1].toLowerCase()] || null;
    const dd = String(mon[2]).padStart(2, "0");
    const yyyy = mon[3];
    if (m) return `${yyyy}-${m}-${dd}`;
  }

  return null;
}

// VERY simple name guesser:
// - looks for lines with 2-4 words that look like a name
// - avoids lines with common ID keywords
function extractName(text) {
  const bad = [
    "republic", "philippines", "license", "driver", "voter", "id", "address",
    "date", "birth", "sex", "height", "weight", "nationality", "signature",
    "expiry", "expires", "issued", "authority", "city", "province",
  ];

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 60);

  const looksBad = (l) => bad.some((b) => l.toLowerCase().includes(b));

  // candidate lines: mostly letters/spaces/dots/commas
  const candidates = lines
    .filter((l) => !looksBad(l))
    .filter((l) => /^[A-Z ,.'-]+$/i.test(l))
    .map((l) => l.replace(/\s+/g, " ").trim());

  // prefer lines like "LAST, FIRST MIDDLE"
  const comma = candidates.find((l) => /,/.test(l) && l.split(" ").length >= 2);
  if (comma) {
    const parts = comma.split(",");
    const last = parts[0].trim();
    const rest = (parts[1] || "").trim().split(" ").filter(Boolean);
    const first = rest[0] || "";
    const middle = rest.slice(1).join(" ");
    return { firstName: capName(first), middleName: capName(middle), lastName: capName(last) };
  }

  // else pick the best-looking 2-4 word line
  const best = candidates
    .map((l) => ({ l, words: l.split(" ").filter(Boolean) }))
    .filter((x) => x.words.length >= 2 && x.words.length <= 4)
    .sort((a, b) => b.words.join(" ").length - a.words.join(" ").length)[0];

  if (!best) return null;

  const w = best.words;
  const first = w[0];
  const last = w[w.length - 1];
  const middle = w.slice(1, -1).join(" ");
  return { firstName: capName(first), middleName: capName(middle), lastName: capName(last) };
}

function capName(s) {
  const x = String(s || "").trim();
  if (!x) return "";
  // Keep ALL CAPS acronyms but title-case normal
  if (x === x.toUpperCase()) {
    return x
      .split(" ")
      .map((p) => (p.length <= 2 ? p : p[0] + p.slice(1).toLowerCase()))
      .join(" ");
  }
  return x;
}

function scoreFields(fields) {
  let score = 0;
  if (fields?.birthdate) score += 2;
  const nameParts = [fields?.firstName, fields?.lastName].filter(Boolean).length;
  if (nameParts >= 2) score += 2;
  if (fields?.middleName) score += 1;
  return score;
}

// OCR one buffer; returns { text, fields, score }
async function ocrBuffer(buffer) {
  console.log("⚙️ OCR processing started...");

  let img = buffer;

  if (sharp) {
    try {
      console.log("🛠 Preprocessing image with sharp...");
      img = await sharp(buffer)
        .rotate()
        .resize({ width: 1400, withoutEnlargement: true })
        .grayscale()
        .normalize()
        .toBuffer();
      console.log("✅ Image preprocessing done");
    } catch (_) {
      console.log("⚠️ Sharp preprocessing failed, using original buffer");
      img = buffer;
    }
  }

  const worker = await getOcrWorker();
  console.log("🤖 Tesseract worker ready");

  const result = await worker.recognize(img);
  console.log("📝 Raw OCR text length:", result?.data?.text?.length);

  const text = cleanText(result?.data?.text || "");
  const birthdate = extractBirthdate(text);
  const name = extractName(text);

  const fields = {
    ...(name || {}),
    ...(birthdate ? { birthdate } : {}),
  };

  console.log("📌 OCR extracted fields:", fields);

  return { text, fields, score: scoreFields(fields) };
}

// ✅ NEW: scan route (does NOT save anything to cloudinary or DB)
router.post("/scan-id",
  upload.fields([
    { name: "votersIDImage", maxCount: 1 },
    { name: "driversLicenseImage", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("📥 /scan-id route triggered");

      const voterBuf = req.files?.votersIDImage?.[0]?.buffer || null;
      const licBuf = req.files?.driversLicenseImage?.[0]?.buffer || null;

      console.log("🖼 Voter ID received:", !!voterBuf);
      console.log("🪪 License received:", !!licBuf);

      if (!voterBuf && !licBuf) {
        console.log("❌ No images uploaded");
        return res.status(400).json({ ok: false, error: "No ID images uploaded" });
      }

      const results = [];

      if (voterBuf) {
        console.log("🔍 Scanning Voter ID...");
        try {
          const r = await ocrBuffer(voterBuf);
          console.log("✅ Voter ID OCR result:", r.fields);
          results.push({ source: "votersIDImage", ...r });
        } catch (e) {
          console.log("❌ Voter ID OCR failed:", e?.message);
          results.push({ source: "votersIDImage", text: "", fields: {}, score: 0, error: e?.message });
        }
      }

      if (licBuf) {
        console.log("🔍 Scanning Driver License...");
        try {
          const r = await ocrBuffer(licBuf);
          console.log("✅ License OCR result:", r.fields);
          results.push({ source: "driversLicenseImage", ...r });
        } catch (e) {
          console.log("❌ License OCR failed:", e?.message);
          results.push({ source: "driversLicenseImage", text: "", fields: {}, score: 0, error: e?.message });
        }
      }

      results.sort((a, b) => (b.score || 0) - (a.score || 0));
      const best = results[0] || { source: null, fields: {}, score: 0 };

      console.log("🏆 Best OCR source:", best.source);
      console.log("📊 Confidence score:", best.score);
      console.log("📌 Extracted fields:", best.fields);

      return res.json({
        ok: true,
        source: best.source,
        confidence: best.score / 5,
        fields: best.fields || {},
      });
    } catch (e) {
      console.error("❌ scan-id error:", e);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  }
);
module.exports = router;
