const express = require("express");
const { protect } = require("../middleware/auth.js");
const {
  createRazorpayOrder,
  verifyRazorpayPayment,
  markRazorpayPaymentFailed,
  listCoupons,
} = require("../controller/paymentController.js");

const router = express.Router();

router.post("/razorpay/order", protect, createRazorpayOrder);
router.post("/razorpay/verify", protect, verifyRazorpayPayment);
router.post("/razorpay/fail", protect, markRazorpayPaymentFailed);
router.get("/coupons", protect, listCoupons);

module.exports = router;
