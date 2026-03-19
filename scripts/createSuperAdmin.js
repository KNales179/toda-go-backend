// scripts/createSuperAdmin.js
require("dotenv").config();
const mongoose = require("mongoose");
const Admin = require("../models/Admin");

async function run() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("Missing MONGO_URI in environment");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const existingSuperAdmin = await Admin.findOne({ role: "super_admin" });
    if (existingSuperAdmin) {
      console.log("Super admin already exists.");
      process.exit(0);
    }

    const admin = await Admin.create({
      name: "Super Admin",
      username: "superadmin",
      email: "superadmin@example.com",
      password: "ChangeThisNow123!",
      role: "super_admin",
      isActive: true,
      twoFactorEnabled: false,
      mustSetup2FA: true,
    });

    console.log("Super admin created:");
    console.log({
      id: admin._id.toString(),
      username: admin.username,
      email: admin.email,
      role: admin.role,
    });

    console.log("IMPORTANT: Change the password immediately and set up 2FA.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to create super admin:", err);
    process.exit(1);
  }
}

run();