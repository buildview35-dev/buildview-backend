const express = require('express')
const cors = require('cors')
const nodemailer = require('nodemailer')
const bodyParser = require('body-parser')

const app = express()
app.use(cors())
app.use(bodyParser.json())

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
})

app.post('/api/send-code', async (req, res) => {
  const { email, code } = req.body

  if (!email || !code) {
    return res.status(400).json({ error: 'Missing email or code' })
  }

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your Verification Code',
      text: `Your verification code is: ${code}`,
      html: `<p>Your verification code is:</p><h2>${code}</h2>`
    })

    return res.json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to send email' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
