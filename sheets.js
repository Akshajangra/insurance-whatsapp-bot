// Writes every completed lead to a Google Sheet so data survives Render restarts
// and is easy for advisors to view/sort/export. Uses a Service Account (no OAuth
// login flow needed) - see README for the one-time setup steps.
const { google } = require("googleapis");

let sheetsClient = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null; // not configured yet

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// Appends one row per lead to the "Leads" tab: CreatedAt, Name, Phone, Product, Details, Advisor
async function appendLeadToSheet(lead) {
  const sheets = getSheetsClient();
  if (!sheets || !process.env.LEADS_SHEET_ID) {
    console.log("[SHEETS] Not configured (missing env vars) - skipping, lead is still in db.json.");
    return;
  }
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.LEADS_SHEET_ID,
      range: "Leads!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[lead.createdAt, lead.name, lead.phone, lead.product, lead.details, lead.advisor]],
      },
    });
    console.log(`[SHEETS OK] Lead for ${lead.name} written to Google Sheets.`);
  } catch (err) {
    console.error("[SHEETS FAILED]", err.response?.data || err.message);
    // Deliberately don't throw - a Sheets hiccup should never stop the customer's WhatsApp reply.
  }
}

module.exports = { appendLeadToSheet };
