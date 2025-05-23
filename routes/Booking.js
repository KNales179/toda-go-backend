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

    const onlineDrivers = await DriverStatus.find({ isOnline: true });

    if (onlineDrivers.length === 0) {
      return res.status(404).json({ message: "No available drivers right now." });
    }

    const getDistance = (lat1, lon1, lat2, lon2) => {
      const toRad = (v) => (v * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    let nearestDriver = null;
    let shortestDistance = Infinity;

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

    if (!nearestDriver) {
      return res.status(404).json({ message: "No nearby driver found." });
    }

    let passengerName = "Anonymous";
    try {
      const passenger = await Passenger.findById(passengerId).select("firstName middleName lastName");
      if (passenger) {
        passengerName = `${passenger.firstName} ${passenger.middleName} ${passenger.lastName}`;
      }
    } catch (err) {
      console.warn("⚠️ Could not fetch passenger name, defaulting to Anonymous.");
    }


    const bookingData = {
      id: bookings.length + 1,
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      fare,
      paymentMethod,
      notes,
      passengerName: passengerName || "Anonymous",
      driverId: nearestDriver.driverId,
      status: "pending",
      createdAt: new Date(),
      passengerId,
    };

    bookings.push(bookingData);
    return res.status(200).json({
        message: "Booking matched with driver!",
        booking: {
            ...bookingData,
            driverId: nearestDriver.driverId,
        },
        distance: shortestDistance.toFixed(2),
    });
  } catch (error) {
    console.error("❌ Error during booking:", error);
    return res.status(500).json({ message: "Server error" });
  }
});


router.get('/bookings', (req, res) => {
  return res.status(200).json(bookings);
});

router.get('/driver-requests/:driverId', (req, res) => {
  const { driverId } = req.params;

  const driverBookings = bookings.filter(
    (b) => String(b.driverId) === driverId && b.status === "pending"
  );

  res.status(200).json(driverBookings);
});


router.post('/accept-booking', (req, res) => {
  const { bookingId } = req.body;

  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return res.status(404).json({ message: "Booking not found" });
  }

  booking.status = "accepted";

  return res.status(200).json({ message: "Booking accepted", booking });
});

router.post('/confirm-driver', (req, res) => {
  const { bookingId } = req.body;
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  booking.passengerConfirmed = true;

  return res.status(200).json({ message: "Passenger confirmed driver", booking });
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


module.exports = router;
