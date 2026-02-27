// Minimal backend mailer for dev/staging
// Do not commit real credentials in public repos.

const express = require('express')
const cors = require('cors')
const nodemailer = require('nodemailer')
require('dotenv').config()

const app = express()

// CORS allowed origins
const allow = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const isDevLocal = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)

const isLANDev = (origin) =>
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/i.test(origin)

const corsOptions = {
  origin: function (origin, cb) {
    if (!origin) return cb(null, true)
    if (allow.length === 0 || allow.includes('*')) return cb(null, true)
    if (allow.includes(origin)) return cb(null, true)
    if (isDevLocal(origin) || isLANDev(origin) || origin === 'capacitor://localhost') return cb(null, true)

    return cb(null, false)
  },
  optionsSuccessStatus: 200
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json())

const PORT = process.env.PORT || process.env.MAIL_PORT || 5174

// SMTP transporter (explicit Gmail settings)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
  connectionTimeout: 30000,
  greetingTimeout: 10000
})

// Optional SMTP verification (debug)
transporter.verify((err) => {
  if (err) console.error('[smtp] verify error:', err.message)
  else console.log('[smtp] ready')
})

app.get('/healthz', (_req, res) => res.json({ ok: true }))

app.post('/api/send-code', async (req, res) => {
  try {
    const { email, code } = req.body || {}

    if (!email || !code) {
      return res.status(400).json({ ok: false, error: 'Missing email or code' })
    }

    const info = await transporter.sendMail({
      from: `"BuildView" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'BuildView verification code',
      text: `Your BuildView verification code is: ${code}`,
      html: `<p>Your BuildView verification code is:</p>
             <p style="font-size:24px;font-weight:700;letter-spacing:2px">${code}</p>`,
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
