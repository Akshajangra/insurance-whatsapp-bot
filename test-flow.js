// Verifies the conversation state machine end-to-end without hitting the real
// WhatsApp API (mocks axios.post so this can run anywhere, including CI).
const axios = require("axios");
const sentMessages = [];
axios.post = async (url, body) => {
  if (url.includes("graph.facebook.com")) {
    const text = body.type === "interactive"
      ? `[LIST] ${body.interactive.body.text} -> options: ${body.interactive.action.sections[0].rows.map(r => r.title).join(", ")}`
      : body.text.body;
    sentMessages.push(text);
    return { data: { messages: [{ id: "wamid.mock" }] } };
  }
  return { data: {} }; // telegram etc.
};

const fs = require("fs");
const path = require("path");
const DB_FILE = path.join(__dirname, "db.json");
if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE); // clean slate

const app = require("./server");
const server = app.listen(0); // random free port

function fakeMessage(from, text) {
  return {
    entry: [{ changes: [{ value: { messages: [{ from, type: "text", text: { body: text } }] } }] }],
  };
}

function fakeListTap(from, id, title) {
  return {
    entry: [{
      changes: [{
        value: {
          messages: [{ from, type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } }],
        },
      }],
    }],
  };
}

const http = require("http");
function post(port, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      { hostname: "localhost", port, path: "/webhook", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => { res.on("data", () => {}); res.on("end", resolve); }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const port = server.address().port;
  const phone = "919876543210";
  const turns = [
    { type: "text", value: "Hi" },
    { type: "list", value: { id: "1", title: "Health" } }, // simulates tapping "Health" in the list
    { type: "text", value: "Rohit Sharma" },
    { type: "text", value: "Pune, 34" },
    { type: "text", value: "yes" },
  ];

  for (const turn of turns) {
    const payload = turn.type === "text" ? fakeMessage(phone, turn.value) : fakeListTap(phone, turn.value.id, turn.value.title);
    await post(port, payload);
    await new Promise((r) => setTimeout(r, 150)); // let async handler finish
  }

  console.log("\n=== Bot replies sent, in order ===");
  sentMessages.forEach((m, i) => console.log(`${i + 1}. ${m.replace(/\n/g, " | ")}`));

  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  console.log("\n=== Final session state ===");
  console.log(db.sessions[phone].state); // should be HUMAN_TAKEOVER

  console.log("\n=== Lead created ===");
  console.log(JSON.stringify(db.leads[0], null, 2));

  const pass =
    db.sessions[phone].state === "HUMAN_TAKEOVER" &&
    db.leads.length === 1 &&
    db.leads[0].name === "Rohit Sharma" &&
    db.leads[0].product === "Health" &&
    !!db.leads[0].advisor;

  console.log(pass ? "\n✅ PASS - full flow completed correctly" : "\n❌ FAIL - check output above");
  server.close();
  process.exit(pass ? 0 : 1);
})();
