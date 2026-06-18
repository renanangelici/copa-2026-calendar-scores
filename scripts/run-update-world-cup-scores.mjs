import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourcePath = path.resolve("scripts/update-world-cup-scores.mjs");
let source = fs.readFileSync(sourcePath, "utf8");

source = source.replace(
  `function validateEnv() {
  if (CONFIG.useApiFootballFallback && !CONFIG.apiFootballKey) {
    throw new Error("Falta secret API_FOOTBALL_KEY.");
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Falta secret GOOGLE_SERVICE_ACCOUNT_JSON.");
  }
}`,
  `function validateEnv() {
  if (CONFIG.useApiFootballFallback && !CONFIG.apiFootballKey) {
    throw new Error("Falta secret API_FOOTBALL_KEY.");
  }
  if (
    !process.env.GOOGLE_SERVICE_ACCOUNT_JSON &&
    (!process.env.GOOGLE_OAUTH_CLIENT_JSON || !process.env.GOOGLE_OAUTH_REFRESH_TOKEN)
  ) {
    throw new Error(
      "Faltam secrets do Google. Use GOOGLE_SERVICE_ACCOUNT_JSON ou GOOGLE_OAUTH_CLIENT_JSON + GOOGLE_OAUTH_REFRESH_TOKEN."
    );
  }
}`
);

source = source.replace(
  /async function getGoogleAccessToken\(\) \{[\s\S]*?\n\}\n\nfunction getTitleParts/,
  `async function getGoogleAccessToken() {
  if (process.env.GOOGLE_OAUTH_CLIENT_JSON && process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return getGoogleAccessTokenWithRefreshToken();
  }

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const unsigned = \`${"${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}"}\`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(serviceAccount.private_key);
  const assertion = \`${"${unsigned}.${base64url(signature)}"}\`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(\`Google OAuth HTTP ${"${response.status}"}: ${"${JSON.stringify(data).slice(0, 800)}"}\`);
  }
  return data.access_token;
}

async function getGoogleAccessTokenWithRefreshToken() {
  const client = parseOAuthClient(process.env.GOOGLE_OAUTH_CLIENT_JSON);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(\`Google OAuth refresh HTTP ${"${response.status}"}: ${"${JSON.stringify(data).slice(0, 800)}"}\`);
  }
  return data.access_token;
}

function parseOAuthClient(rawJson) {
  const parsed = JSON.parse(rawJson);
  const client = parsed.installed || parsed.web || parsed;
  if (!client.client_id || !client.client_secret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_JSON nao contem client_id/client_secret.");
  }
  return client;
}

function getTitleParts`
);

const outPath = path.join(os.tmpdir(), `update-world-cup-scores-${Date.now()}.mjs`);
fs.writeFileSync(outPath, source);
await import(outPath);
