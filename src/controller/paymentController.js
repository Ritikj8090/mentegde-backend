const crypto = require("crypto");
const Razorpay = require("razorpay");
const db = require("../config/db");

const getRazorpayClient = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay keys are not configured");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
};

const createRazorpayOrder = async (req, res) => {
  try {
    const internId = req.user?.id;
    const { internshipId, domainId, coupon_code } = req.body;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!internshipId || !domainId) {
      return res
        .status(400)
        .json({ message: "internshipId and domainId are required" });
    }

    const internshipRes = await db.query(
      `
      SELECT i.id, i.price, d.id AS domain_id
      FROM mentedge.internships i
      JOIN mentedge.internship_domains d ON d.internship_id = i.id
      WHERE i.id = $1 AND d.id = $2
      `,
      [internshipId, domainId]
    );

    if (internshipRes.rowCount === 0) {
      return res.status(404).json({ message: "Internship domain not found" });
    }

    const originalAmount = Number(internshipRes.rows[0].price || 0);
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      return res.status(400).json({ message: "Invalid internship price" });
    }

    const gstPercent = 18;
    let discountPercent = null;
    let discountAmount = null;
    let appliedCouponCode = null;

    if (coupon_code) {
      const couponRes = await db.query(
        `
        SELECT id, code, percent_off, max_uses, used_count, expires_at, is_active
        FROM mentedge.coupons
        WHERE code = $1
        `,
        [String(coupon_code).trim().toUpperCase()]
      );

      if (couponRes.rowCount === 0) {
        return res.status(400).json({ message: "Invalid coupon code" });
      }

      const coupon = couponRes.rows[0];
      if (!coupon.is_active) {
        return res.status(400).json({ message: "Coupon is inactive" });
      }

      if (coupon.expires_at && coupon.expires_at < new Date()) {
        return res.status(400).json({ message: "Coupon has expired" });
      }

      if (
        coupon.max_uses !== null &&
        Number(coupon.used_count) >= Number(coupon.max_uses)
      ) {
        return res.status(400).json({ message: "Coupon usage limit reached" });
      }

      discountPercent = Number(coupon.percent_off);
      discountAmount = Number(
        ((originalAmount * discountPercent) / 100).toFixed(2)
      );
      appliedCouponCode = coupon.code;
    }

    const baseAmount = originalAmount - (discountAmount || 0);
    const gstAmount = Number(((baseAmount * gstPercent) / 100).toFixed(2));
    const amount = Number((baseAmount + gstAmount).toFixed(2));
    if (amount <= 0) {
      return res.status(400).json({ message: "Discount exceeds amount" });
    }

    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `internship_123`,
      payment_capture: 1,
    });

    const paymentRes = await db.query(
      `
      INSERT INTO mentedge.internship_payments (
        intern_id, internship_id, domain_id, amount, original_amount,
        discount_percent, discount_amount, coupon_code, gst_percent,
        gst_amount, subtotal, currency, status, provider,
        provider_reference, raw_response
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, 'pending', 'razorpay', $13, $14
      )
      RETURNING id
      `,
      [
        internId,
        internshipId,
        domainId,
        amount,
        originalAmount,
        discountPercent,
        discountAmount,
        appliedCouponCode,
        gstPercent,
        gstAmount,
        Number(baseAmount.toFixed(2)),
        "INR",
        order.id,
        order,
      ]
    );

    return res.status(201).json({
      key_id: process.env.RAZORPAY_KEY_ID,
      order,
      payment_id: paymentRes.rows[0].id,
      gst_percent: gstPercent,
      gst_amount: gstAmount,
      subtotal: Number(baseAmount.toFixed(2)),
    });
  } catch (err) {
    console.error("createRazorpayOrder error:", err);
    return res.status(500).json({ message: "Failed to create order" });
  }
};

const verifyRazorpayPayment = async (req, res) => {
  const client = await db.connect();
  try {
    const internId = req.user?.id;
    const {
      internshipId,
      domainId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (
      !internshipId ||
      !domainId ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({ message: "Missing payment fields" });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({ message: "Razorpay keys not configured" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    await client.query("BEGIN");

    const domainRes = await client.query(
      `
      SELECT id, join_count, max_seats
      FROM mentedge.internship_domains
      WHERE id = $1 AND internship_id = $2
      FOR UPDATE
      `,
      [domainId, internshipId]
    );

    if (domainRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Domain not found" });
    }

    const { join_count, max_seats } = domainRes.rows[0];
    if (max_seats !== null && join_count >= max_seats) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "No seats left" });
    }

    const joinedRes = await client.query(
      `
      INSERT INTO mentedge.internship_joined (intern_id, internship_id, domain_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (intern_id, domain_id) DO UPDATE
      SET updated_at = NOW()
      RETURNING id
      `,
      [internId, internshipId, domainId]
    );

    await client.query(
      `
      UPDATE mentedge.internship_domains
      SET join_count = join_count + 1, updated_at = NOW()
      WHERE id = $1
      `,
      [domainId]
    );

    const paymentRes = await client.query(
      `
      UPDATE mentedge.internship_payments
      SET status = 'paid',
          provider_reference = $1,
          paid_at = NOW(),
          internship_joined_id = $2,
          updated_at = NOW()
      WHERE provider = 'razorpay'
        AND provider_reference = $3
        AND intern_id = $4
        AND internship_id = $5
        AND domain_id = $6
      RETURNING id
      `,
      [
        razorpay_payment_id,
        joinedRes.rows[0].id,
        razorpay_order_id,
        internId,
        internshipId,
        domainId,
      ]
    );

    if (paymentRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Payment record not found" });
    }

    await client.query(
      `
      UPDATE mentedge.coupons
      SET used_count = used_count + 1, updated_at = NOW()
      WHERE code = (
        SELECT coupon_code
        FROM mentedge.internship_payments
        WHERE provider_reference = $1
          AND intern_id = $2
          AND internship_id = $3
          AND domain_id = $4
          AND coupon_code IS NOT NULL
      )
      `,
      [razorpay_payment_id, internId, internshipId, domainId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Payment verified",
      joined_id: joinedRes.rows[0].id,
      payment_id: paymentRes.rows[0].id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("verifyRazorpayPayment error:", err);
    return res.status(500).json({ message: "Failed to verify payment" });
  } finally {
    client.release();
  }
};

const markRazorpayPaymentFailed = async (req, res) => {
  try {
    const internId = req.user?.id;
    const { internshipId, domainId, razorpay_order_id, reason, status } = req.body;

    if (!internId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!internshipId || !domainId || !razorpay_order_id) {
      return res.status(400).json({ message: "Missing payment fields" });
    }

    const normalizedStatus =
      status && String(status).toLowerCase() === "failed" ? "failed" : "cancelled";

    const result = await db.query(
      `
      UPDATE mentedge.internship_payments
      SET status = $6,
          raw_response = jsonb_set(
            COALESCE(raw_response, '{}'::jsonb),
            '{failure_reason}',
            to_jsonb($1::text),
            true
          ),
          updated_at = NOW()
      WHERE provider = 'razorpay'
        AND provider_reference = $2
        AND intern_id = $3
        AND internship_id = $4
        AND domain_id = $5
      RETURNING id
      `,
      [
        reason ?? null,
        razorpay_order_id,
        internId,
        internshipId,
        domainId,
        normalizedStatus,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Payment record not found" });
    }

    return res.status(200).json({ message: "Payment marked failed" });
  } catch (err) {
    console.error("markRazorpayPaymentFailed error:", err);
    return res.status(500).json({ message: "Failed to mark payment failed" });
  }
};

const listCoupons = async (req, res) => {
  try {
    const isActive =
      req.query.active === undefined ? null : req.query.active === "true";
    const code = req.query.code ? String(req.query.code).trim().toUpperCase() : null;

    const conditions = [];
    const values = [];

    if (isActive !== null) {
      values.push(isActive);
      conditions.push(`is_active = $${values.length}`);
    }

    if (code) {
      values.push(code);
      conditions.push(`code = $${values.length}`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await db.query(
      `
      SELECT
        id,
        code,
        percent_off,
        is_active,
        max_uses,
        used_count,
        expires_at,
        created_at,
        updated_at
      FROM mentedge.coupons
      ${whereClause}
      ORDER BY created_at DESC
      `,
      values
    );

    return res.status(200).json({ coupons: result.rows });
  } catch (err) {
    console.error("listCoupons error:", err);
    return res.status(500).json({ message: "Failed to fetch coupons" });
  }
};

module.exports = {
  createRazorpayOrder,
  verifyRazorpayPayment,
  markRazorpayPaymentFailed,
  listCoupons,
};
