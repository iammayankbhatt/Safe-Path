const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const rateLimit = require('express-rate-limit');

// Heavy rate limit for panic endpoint (prevent abuse)
const panicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'Too many panic requests' },
});

// Police email map by district (from data.gov.in)
const POLICE_EMAIL_MAP = {
  meerut: process.env.POLICE_EMAIL_MEERUT || 'meerutpolice@up.gov.in',
  default: process.env.POLICE_EMAIL_DEFAULT || 'up100@up.gov.in',
};

// POST /api/panic — Trigger panic alert
router.post('/', panicLimiter, async (req, res) => {
  const { lat, lng, contacts } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (isNaN(latNum) || isNaN(lngNum)) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  try {
    // Create panic alert record
    const alertResult = await pool.query(
      `INSERT INTO panic_alerts (initial_location, location_updates, contacts_notified)
       VALUES (ST_MakePoint($1, $2)::GEOGRAPHY, '[]'::jsonb, $3)
       RETURNING alert_id, created_at`,
      [lngNum, latNum, Array.isArray(contacts) ? contacts.length : 0]
    );

    const alert = alertResult.rows[0];
    const alertId = alert.alert_id;
    const timestamp = alert.created_at;

    // Send SMS to trusted contacts
    let smsSent = 0;
    const smsResults = [];

    if (Array.isArray(contacts) && contacts.length > 0) {
      const validContacts = contacts.slice(0, 3); // max 3 contacts

      for (const contact of validContacts) {
        try {
          await sendSMS(
            contact.phone,
            contact.name,
            latNum,
            lngNum,
            alertId,
            timestamp
          );
          smsSent++;
          smsResults.push({ name: contact.name, status: 'sent' });
        } catch (smsError) {
          console.error(`SMS failed to ${contact.name}:`, smsError.message);
          smsResults.push({ name: contact.name, status: 'failed', error: smsError.message });
        }
      }
    }

    // Send email to police
    let policEmailSent = false;
    try {
      await sendPoliceEmail(latNum, lngNum, alertId, timestamp);
      policEmailSent = true;

      await pool.query(
        'UPDATE panic_alerts SET police_email_sent = true WHERE alert_id = $1',
        [alertId]
      );
    } catch (emailError) {
      console.error('Police email failed:', emailError.message);
    }

    // Update contacts_notified count
    await pool.query(
      'UPDATE panic_alerts SET contacts_notified = $1 WHERE alert_id = $2',
      [smsSent, alertId]
    );

    res.status(201).json({
      success: true,
      alert_id: alertId,
      contacts_notified: smsSent,
      police_alerted: policEmailSent,
      sms_results: smsResults,
      message: `Alert activated. ${smsSent} contact(s) notified.`,
      timestamp: timestamp,
    });

  } catch (error) {
    console.error('Error triggering panic:', error.message);
    res.status(500).json({ error: 'Failed to trigger panic alert' });
  }
});

// PATCH /api/panic/:id/location — Update live location during panic
router.patch('/:id/location', async (req, res) => {
  const { id } = req.params;
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  try {
    const update = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      timestamp: new Date().toISOString(),
    };

    const result = await pool.query(
      `UPDATE panic_alerts
       SET location_updates = location_updates || $1::jsonb
       WHERE alert_id = $2 AND resolved_at IS NULL
       RETURNING alert_id, location_updates`,
      [JSON.stringify(update), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found or already resolved' });
    }

    res.json({
      success: true,
      alert_id: id,
      location_updated: true,
      update_count: result.rows[0].location_updates.length,
    });

  } catch (error) {
    console.error('Error updating location:', error.message);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// DELETE /api/panic/:id — Cancel/resolve panic
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE panic_alerts
       SET resolved_at = NOW()
       WHERE alert_id = $1 AND resolved_at IS NULL
       RETURNING alert_id, resolved_at`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found or already resolved' });
    }

    res.json({
      success: true,
      alert_id: id,
      resolved_at: result.rows[0].resolved_at,
      message: 'Alert cancelled. Stay safe.',
    });

  } catch (error) {
    console.error('Error cancelling panic:', error.message);
    res.status(500).json({ error: 'Failed to cancel alert' });
  }
});

// GET /api/panic/:id — Get alert status
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         alert_id,
         ST_Y(initial_location::GEOMETRY) as initial_lat,
         ST_X(initial_location::GEOMETRY) as initial_lng,
         location_updates,
         contacts_notified,
         police_email_sent,
         created_at,
         resolved_at
       FROM panic_alerts
       WHERE alert_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching alert:', error.message);
    res.status(500).json({ error: 'Failed to fetch alert' });
  }
});

// ─── Helper: Send SMS via Twilio ──────────────────────────────
async function sendSMS(phone, name, lat, lng, alertId, timestamp) {
  const twilio = require('twilio');
  
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromPhone) {
    console.warn('⚠️  Twilio not configured. SMS simulation mode.');
    console.log(`📱 [SIM] SMS to ${name} (${phone}):`);
    console.log(`   🆘 SafePath EMERGENCY ALERT`);
    console.log(`   📍 Location: https://maps.google.com/?q=${lat},${lng}`);
    console.log(`   🕐 Time: ${new Date(timestamp).toLocaleString('en-IN')}`);
    console.log(`   🆔 Incident ID: ${alertId.substring(0, 8)}`);
    return { simulated: true };
  }

  const client = twilio(accountSid, authToken);
  
  const mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
  const message = `🆘 SAFEPATH EMERGENCY ALERT\n\nSomeone in your trusted contacts needs help!\n\nLocation: ${mapsLink}\nTime: ${new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\nIncident ID: ${alertId.substring(0, 8).toUpperCase()}\n\nPlease call them or contact police immediately.\n\nSafetyPath - Women's Safety App`;

  return await client.messages.create({
    body: message,
    from: fromPhone,
    to: phone,
  });
}

// ─── Helper: Send email to police station ─────────────────────
async function sendPoliceEmail(lat, lng, alertId, timestamp) {
  const nodemailer = require('nodemailer');

  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;

  // Determine police email based on location (simplified for Meerut area)
  const policeEmail = POLICE_EMAIL_MAP.meerut;
  const mapsLink = `https://maps.google.com/?q=${lat},${lng}`;

  if (!host || !user || !pass) {
    console.warn('⚠️  Email not configured. Police email simulation mode.');
    console.log(`📧 [SIM] Police Email to: ${policeEmail}`);
    console.log(`   Subject: 🆘 EMERGENCY: SafePath Panic Alert - ${alertId.substring(0, 8)}`);
    console.log(`   Location: ${mapsLink}`);
    console.log(`   Time: ${new Date(timestamp).toLocaleString('en-IN')}`);
    return { simulated: true };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.EMAIL_PORT || 587),
    secure: false,
    auth: { user, pass },
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM || `SafePath Alert <${user}>`,
    to: policeEmail,
    subject: `🆘 EMERGENCY: SafePath Panic Alert - ID ${alertId.substring(0, 8).toUpperCase()}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #E63946; color: white; padding: 20px; text-align: center;">
          <h1>🆘 EMERGENCY ALERT — SAFEPATH</h1>
        </div>
        <div style="padding: 20px; background: #fff3f3; border: 2px solid #E63946;">
          <h2>A woman has triggered an emergency SOS alert</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; font-weight: bold;">Incident ID:</td>
                <td style="padding: 8px;">${alertId.substring(0, 8).toUpperCase()}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Timestamp:</td>
                <td style="padding: 8px;">${new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">GPS Coordinates:</td>
                <td style="padding: 8px;">${lat.toFixed(6)}, ${lng.toFixed(6)}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Google Maps:</td>
                <td style="padding: 8px;"><a href="${mapsLink}" style="color: #E63946;">${mapsLink}</a></td></tr>
          </table>
          <div style="margin-top: 20px; padding: 15px; background: #ffe0e0; border-radius: 8px;">
            <strong>⚡ Immediate action required.</strong> Please dispatch nearest patrol unit to this location.
          </div>
        </div>
        <div style="padding: 10px; text-align: center; color: #666; font-size: 12px;">
          SafePath — Women's Safety Navigation Platform | Team HAWKS, GEHU Haldwani
        </div>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
}

module.exports = router;
