'use strict';

const twilio = require('twilio');

function mountSMSForwardRoutes(app) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const forwardTo = process.env.SMS_FORWARD_TO;

  app.post('/sms/incoming', (req, res) => {
    const sig = req.headers['x-twilio-signature'];
    const url = process.env.SMS_WEBHOOK_URL;

    if (!twilio.validateRequest(authToken, sig, url, req.body)) {
      return res.status(403).send('Forbidden');
    }

    const from = req.body.From;
    const body = req.body.Body;

    const client = twilio(accountSid, authToken);

    client.messages.create({
      body: `FWD from ${from}: ${body}`,
      from: fromNumber,
      to: forwardTo
    }).catch(err => console.error('[SMS_FORWARD] Error:', err));

    const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    res.type('text/xml').send(twiml);
  });

  console.log('[SMS_FORWARD] Route mounted at POST /sms/incoming');
}

module.exports = mountSMSForwardRoutes;
