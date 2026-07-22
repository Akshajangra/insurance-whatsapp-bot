// Insurance Agency WhatsApp Lead Bot
// Flow: Greeting -> Identify Intent -> Collect Details -> Summarize ->
//       Create Lead -> Assign Advisor -> Notify Customer -> Human Takeover
//
// Runs on the free Meta WhatsApp Cloud API directly (no BSP subscription).
// Session + leads are persisted to a local JSON file so no database is needed.

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const {
  VERIFY_TOKEN,          // any string you choose, entered again in Meta App dashboard
  WHATSAPP_TOKEN,        // permanent/temp access token from Meta App dashboard
  PHONE_NUMBER_ID,       // from Meta App dashboard > WhatsApp > API Setup
  ADVISOR_NAMES,         // comma-separated, e.g. "Rohit,Priya,Aman"
  TELEGRAM_BOT_TOKEN,    // optional - free way to notify advisors, see README
  TELEGRAM_CHAT_ID,      // optional
  PORT,
} = process.env;

const DB_FILE = path.join(__dirname, "db.json");

// ---------- tiny file-based store (sessions + leads + round-robin index) ----------
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { sessions: {}, leads: [], nextAdvisorIndex: 0 };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---------- WhatsApp send helper ----------
async function sendWhatsAppMessage(to, body) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  console.log(`[SEND] Attempting to message ${to}: "${body.slice(0, 50)}..."`);
  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
  console.log(`[SEND OK] Meta accepted message, id: ${res.data?.messages?.[0]?.id}`);
}

// ---------- optional free advisor notification via Telegram ----------
async function notifyAdvisor(advisorName, lead) {
  console.log(`[Lead assigned] ${advisorName} <- ${JSON.stringify(lead)}`);
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return; // Telegram optional, see README
  const text =
    `New lead assigned to *${advisorName}*\n` +
    `Name: ${lead.name}\nPhone: ${lead.phone}\nProduct: ${lead.product}\n` +
    `Details: ${lead.details}`;
  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" }
  );
}

function nextAdvisor(db) {
  const advisors = (ADVISOR_NAMES || "Advisor").split(",").map((s) => s.trim());
  const name = advisors[db.nextAdvisorIndex % advisors.length];
  db.nextAdvisorIndex += 1;
  return name;
}

// ---------- 1. Webhook verification (Meta calls this once when you connect) ----------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------- 2. Incoming messages ----------
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // ack Meta immediately; process after
  console.log("[WEBHOOK HIT]", JSON.stringify(req.body));

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message || message.type !== "text") {
      console.log("[WEBHOOK] No text message in payload (likely a status update) - ignoring.");
      return;
    }

    const from = message.from; // customer's phone number
    const text = message.text.body.trim();
    const db = loadDB();
    const session = db.sessions[from] || { state: "NEW", data: {} };

    await handleMessage(db, session, from, text);

    db.sessions[from] = session;
    saveDB(db);
  } catch (err) {
    console.error("Error handling message:", err);
  }
});

// ---------- the conversation state machine (mirrors your flow diagram) ----------
async function handleMessage(db, session, from, text) {
  const lower = text.toLowerCase();

  // "agent" / "human" always breaks out to human takeover, from any state
  if (["agent", "human", "talk to someone", "help"].includes(lower)) {
    session.state = "HUMAN_TAKEOVER";
    await sendWhatsAppMessage(
      from,
      "Connecting you to a human advisor now \uD83D\uDC64. They'll be with you shortly."
    );
    return;
  }

  switch (session.state) {
    case "NEW": {
      // Greeting
      await sendWhatsAppMessage(
        from,
        "Namaste! \uD83D\uDE4F Welcome to [Agency Name] Insurance Services.\n" +
          "Which insurance are you looking for?\n\n" +
          "1. Health\n2. Motor\n3. Life\n4. Term\n5. Travel\n6. Home"
      );
      session.state = "AWAITING_INTENT";
      break;
    }

    case "AWAITING_INTENT": {
      // Identify Customer Intent
      const map = { "1": "Health", "2": "Motor", "3": "Life", "4": "Term", "5": "Travel", "6": "Home" };
      const product = map[text] || text; // also accept free text like "health insurance"
      session.data.product = product;
      await sendWhatsAppMessage(from, `Great, ${product} insurance. What's your full name?`);
      session.state = "AWAITING_NAME";
      break;
    }

    case "AWAITING_NAME": {
      // Collect Basic Details (name)
      session.data.name = text;
      await sendWhatsAppMessage(
        from,
        `Thanks ${text}! And your city + age (e.g. "Pune, 34")?`
      );
      session.state = "AWAITING_DETAILS";
      break;
    }

    case "AWAITING_DETAILS": {
      // Collect Basic Details (rest) + Summarize
      session.data.details = text;
      const { product, name } = session.data;
      await sendWhatsAppMessage(
        from,
        `Here's what I have:\n- Product: ${product}\n- Name: ${name}\n- Details: ${text}\n\n` +
          `Reply YES to confirm and get matched with an advisor, or type corrections.`
      );
      session.state = "AWAITING_CONFIRM";
      break;
    }

    case "AWAITING_CONFIRM": {
      if (lower === "yes" || lower === "y") {
        // Create Lead
        const lead = { phone: from, ...session.data, createdAt: new Date().toISOString() };
        db.leads.push(lead);

        // Assign Sales Advisor
        const advisor = nextAdvisor(db);
        lead.advisor = advisor;

        // Notify advisor (internal) - free via Telegram, see README
        await notifyAdvisor(advisor, lead);

        // Notify Customer
        await sendWhatsAppMessage(
          from,
          `You're all set! \u2705 ${advisor} will reach out to you shortly with ${lead.product} options.\n` +
            `You can type 'agent' anytime to chat with them directly.`
        );

        // Human Advisor Takes Over
        session.state = "HUMAN_TAKEOVER";
      } else {
        // treat as a correction - go back one step
        session.data.details = text;
        await sendWhatsAppMessage(from, "Got it, updated. Reply YES when ready to confirm.");
      }
      break;
    }

    case "HUMAN_TAKEOVER": {
      // Bot stays silent - advisor is expected to reply from the shared inbox.
      // (If you want a gentle auto-ack here, uncomment below.)
      // await sendWhatsAppMessage(from, "Your advisor has this message and will reply shortly.");
      break;
    }

    default: {
      session.state = "NEW";
      await handleMessage(db, session, from, text);
    }
  }
}

if (require.main === module) {
  const port = PORT || 3000;
  app.listen(port, () => console.log(`WhatsApp bot listening on port ${port}`));
}

module.exports = app;
