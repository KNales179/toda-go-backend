const express = require('express');
const router = express.Router();
const DriverStatus = require("../models/DriverStatus");
const Passenger = require("../models/Passenger");

let bookings = [];

router.post('/book', async (req, res) => {
  try {
    const {
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      fare,
      paymentMethod,
      notes,
      passengerId,
    } = req.body;

    // Get passenger name for record-keeping
    let passengerName = "Anonymous";
    try {
      const passenger = await Passenger.findById(passengerId).select("firstName middleName lastName");
      if (passenger) {
        passengerName = `${passenger.firstName} ${passenger.middleName} ${passenger.lastName}`;
      }
    } catch (err) {
      console.warn("⚠️ Could not fetch passenger name, defaulting to Anonymous.");
    }

    // Create the booking record even if no driver yet
    const bookingId = bookings.length + 1;
    const bookingData = {
      id: bookingId,
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      fare,
      paymentMethod,
      notes,
      passengerName,
      driverId: null,
      status: "pending",
      createdAt: new Date(),
      passengerId,
    };
    bookings.push(bookingData);

    // Function to find the nearest driver
    const getNearestDriver = async () => {
      const onlineDrivers = await DriverStatus.find({ isOnline: true });
      if (onlineDrivers.length === 0) return null;

      let nearestDriver = null;
      let shortestDistance = Infinity;

      const toRad = (v) => (v * Math.PI) / 180;
      const R = 6371;
      const getDistance = (lat1, lon1, lat2, lon2) => {
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      for (const driver of onlineDrivers) {
        const dist = getDistance(
          pickupLat,
          pickupLng,
          driver.location.latitude,
          driver.location.longitude
        );
        if (dist < shortestDistance) {
          shortestDistance = dist;
          nearestDriver = driver;
        }
      }

      return nearestDriver;
    };

    // Wait up to 10 minutes for an online driver
    const startTime = Date.now();
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes

    const pollForDriver = async () => {
      const driver = await getNearestDriver();
      if (driver) {
        // Assign the driver to the booking
        bookingData.driverId = driver.driverId;
        console.log("✅ Driver found and assigned:", driver.driverId);
        return res.status(200).json({
          message: "Booking matched with driver!",
          booking: {
            ...bookingData,
            driverId: driver.driverId,
          }
        });
      }

      if (Date.now() - startTime < maxWaitTime) {
        // No driver yet, wait 5 seconds and try again
        setTimeout(pollForDriver, 5000);
      } else {
        // No driver found after 10 minutes
        console.log("❌ No drivers found after 10 minutes.");
        return res.status(200).json({
          message: "No drivers found within 10 minutes. Please try again.",
          booking: bookingData,
        });
      }
    };

    // Start polling
    pollForDriver();

  } catch (error) {
    console.error("❌ Error during booking:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Other endpoints (unchanged):
router.get('/bookings', (req, res) => res.status(200).json(bookings));

router.get('/driver-requests/:driverId', (req, res) => {
  const { driverId } = req.params;
  const driverBookings = bookings.filter(
    (b) => String(b.driverId) === driverId && (b.status === "pending" || b.status === "accepted")
  );
  res.status(200).json(driverBookings);
});

router.post('/accept-booking', (req, res) => {
  const { bookingId } = req.body;
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  booking.status = "accepted";
  return res.status(200).json({ message: "Booking accepted", booking });
});

router.post('/driver-confirmed', (req, res) => {
  const { bookingId } = req.body;
  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  booking.driverConfirmed = true;
  return res.status(200).json({ message: "Passenger notified!", booking });
});


router.post('/cancel-booking', (req, res) => {
  const { bookingId } = req.body;
  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  booking.status = "cancelled";
  booking.cancelledBy = "passenger";
  console.log("❌ Booking cancelled by passenger:", bookingId);
  res.status(200).json({ message: "Booking cancelled" });
});

router.post('/clear-bookings', (req, res) => {
  bookings = [];
  console.log("🧹 All bookings cleared.");
  res.status(200).json({ message: "All bookings cleared." });
});


module.exports = router;
