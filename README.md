# Insurance Agency WhatsApp Lead Bot (Free Stack)

Implements this flow directly, using only free tools:

```
Customer Sends Message -> Greeting -> Identify Intent -> Collect Details
-> Summarize -> Create Lead -> Assign Advisor -> Notify Customer -> Human Takeover
```

Runs on Meta's own **WhatsApp Cloud API** - no BSP subscription fee (Gupshup/WATI/etc. not required).
Leads are stored in a local `db.json` file - no database needed to start.

## 1. One-time Meta setup (free)

1. Create a Meta App at developers.facebook.com > My Apps > Create App > "Business".
2. Add the "WhatsApp" product to the app.
3. Under WhatsApp > API Setup you'll get a **temporary access token** and a **Phone Number ID** -
   copy both into `.env` (see `.env.example`). A test number is provided free for development.
4. To go live with your own business number, verify your business (Meta Business Verification -
   can take a few days) and generate a **permanent token** under System Users.

## 2. Run locally to test

```bash
npm install
cp .env.example .env   # then fill in your real values
npm start
```

Test the logic without a real WhatsApp number at all:
```bash
node test-flow.js
```
This mocks the WhatsApp API call and proves the full flow (greeting through lead creation
and advisor assignment) works, printing every bot reply and the final lead record.

## 3. Expose your webhook to Meta

Meta needs a public HTTPS URL to send messages to. Free options:
- **Render.com** (free web service tier) - easiest for a small Node app like this.
- **Railway.app** (free trial credits, cheap after) - similarly simple.
- **ngrok** (free tier) - good for local testing only, URL changes each restart.

Once deployed, in Meta App dashboard > WhatsApp > Configuration:
- Callback URL: `https://your-deployed-url.com/webhook`
- Verify Token: whatever you set as `VERIFY_TOKEN` in `.env`
- Subscribe to the `messages` webhook field.

## 4. Optional: free advisor notifications via Telegram

Instead of paying for SMS/email alerts, this bot can ping your advisors on Telegram for free:
1. Message `@BotFather` on Telegram -> `/newbot` -> copy the token into `TELEGRAM_BOT_TOKEN`.
2. Message your new bot once, then open
   `https://api.telegram.org/bot<token>/getUpdates` in a browser to find your `chat_id`.
3. Put that in `TELEGRAM_CHAT_ID`. Leave both blank to skip - leads still get logged to
   `db.json` and the console either way.

## 5. What you'll still eventually pay for

- Nothing, while the flow stays reactive (customer messages first) - this fits inside
  WhatsApp's free 24-hour "service window."
- If you later send unprompted renewal reminders/marketing outside that window, Meta
  charges a small per-message fee (a few paise to a few rupees depending on category) -
  no way around this even with a BSP, since it's Meta's charge, not the BSP's.

## 6. Extending this

- Swap `db.json` for Google Sheets (via `googleapis` package) or Airtable once you outgrow
  a single JSON file - the `loadDB`/`saveDB` functions are the only place that would change.
- Add WhatsApp "List Messages" / buttons instead of plain numbered text for a nicer menu
  (see Meta's Cloud API docs for the `interactive` message type).
- Add more product-specific questions per the table in your chat flow design doc.
