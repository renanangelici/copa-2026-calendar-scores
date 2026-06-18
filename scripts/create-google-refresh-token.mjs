import http from "node:http";
import fs from "node:fs";
import { execFile } from "node:child_process";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
const PORT = Number(process.env.OAUTH_PORT || 42813);
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  const clientPath = process.argv[2];
  if (!clientPath) {
    throw new Error("Arraste o arquivo JSON do cliente OAuth para este comando.");
  }

  const client = parseOAuthClient(fs.readFileSync(clientPath, "utf8"));
  const code = await getAuthorizationCode(client);
  const token = await exchangeCodeForToken(client, code);

  if (!token.refresh_token) {
    throw new Error("O Google nao retornou refresh_token. Remova o acesso do app na sua conta Google e tente de novo.");
  }

  console.log("\nCOPIE ESTE VALOR PARA O SECRET GOOGLE_OAUTH_REFRESH_TOKEN:\n");
  console.log(token.refresh_token);
  console.log("\nCOPIE O CONTEUDO INTEIRO DO JSON BAIXADO PARA O SECRET GOOGLE_OAUTH_CLIENT_JSON.\n");
}

function parseOAuthClient(rawJson) {
  const parsed = JSON.parse(rawJson);
  const client = parsed.installed || parsed.web || parsed;
  if (!client.client_id || !client.client_secret) {
    throw new Error("JSON nao contem client_id/client_secret.");
  }
  return client;
}

function getAuthorizationCode(client) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, REDIRECT_URI);
      if (url.pathname !== "/callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(`Erro na autorizacao: ${error || "codigo ausente"}`);
        server.close();
        reject(new Error(error || "Codigo ausente"));
        return;
      }

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>Autorizacao concluida.</h1><p>Pode voltar para o Codex.</p>");
      server.close();
      resolve(code);
    });

    server.listen(PORT, "127.0.0.1", () => {
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", client.client_id);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", SCOPES.join(" "));
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");

      console.log("Abrindo autorizacao do Google no navegador...");
      openUrl(authUrl.toString());
      console.log(`Se o navegador nao abrir, acesse:\n${authUrl.toString()}\n`);
    });

    server.on("error", reject);
  });
}

async function exchangeCodeForToken(client, code) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google OAuth HTTP ${response.status}: ${JSON.stringify(data).slice(0, 800)}`);
  }
  return data;
}

function openUrl(url) {
  if (process.platform === "darwin") {
    execFile("open", [url]);
  } else if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", url]);
  } else {
    execFile("xdg-open", [url]);
  }
}
