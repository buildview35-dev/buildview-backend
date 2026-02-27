// Minimal backend mailer for dev/staging
// Do not commit real credentials. Use a .env file.
const express = require('express')
const cors = require('cors')
const nodemailer = require('nodemailer')
require('dotenv').config()

const app = express()
const allow = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({
  origin: function (origin, cb) {
    if (!origin || allow.length === 0 || allow.includes('*') || allow.includes(origin)) cb(null, true)
    else cb(null, false)
  }
}))
app.use(express.json())

const PORT = process.env.PORT || process.env.MAIL_PORT || 5174

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

app.get('/healthz', (_req, res) => res.json({ ok: true }))

app.post('/api/send-code', async (req, res) => {
  try {
    const { email, code } = req.body || {}
    if (!email || !code) return res.status(400).json({ ok: false, error: 'Missing email or code' })
    const info = await transporter.sendMail({
      from: `"BuildView" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'BuildView verification code',
      text: `Your BuildView verification code is: ${code}`,
      html: `<p>Your BuildView verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:2px">${code}</p>`,
    })
    res.json({ ok: true, id: info.messageId })
  } catch (e) {
    console.error('[mailer] send error:', e.message)
    res.status(500).json({ ok: false, error: 'Failed to send email' })
  }
})

app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`)
})
