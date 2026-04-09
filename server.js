const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

let tokens = {};

let licenses = {
  "GZN-TESTE-1234": {
    hwid: null,
    discordId: null,
    active: true,
    createdAt: new Date().toISOString()
  }
};

const CLIENT_ID = process.env.CLIENT_ID || "1491183348167475322";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "f4UmFHkGEq3oD2Ea_LwEmnpEV_ceWTcv";
const REDIRECT_URI = "https://painel-hwid-production.up.railway.app/callback";

// SENHA DO ADMIN
const ADMIN_PASSWORD = "Gzn@Admin#9482";

// ========= SITE =========
app.get("/", (req, res) => {
  res.send("API ONLINE 🔥");
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ========= LOGIN DISCORD =========
app.get("/login", (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    const user = userRes.data;
    const loginToken = Math.random().toString(36).substring(2);

    tokens[loginToken] = {
      discordId: user.id,
      expires: Date.now() + 1000 * 60 * 5
    };

    res.send(`
      <html>
        <body style="background:#0b1020;color:white;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="text-align:center">
            <h2>Logado com sucesso</h2>
            <p>Abrindo o aplicativo...</p>
          </div>
          <script>
            setTimeout(() => {
              window.location.href = "gzn://login?token=${loginToken}";
            }, 1000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    if (err.response) {
      console.log("Erro Discord:", err.response.status, err.response.data);
      res.send(`<pre>${JSON.stringify(err.response.data, null, 2)}</pre>`);
    } else {
      console.log("Erro:", err.message);
      res.send(`<pre>${err.message}</pre>`);
    }
  }
});

// ========= KEY SYSTEM =========
app.post("/auth", (req, res) => {
  const { token, hwid, key } = req.body;

  const data = tokens[token];
  if (!data) return res.json({ success: false, error: "Token inválido" });

  if (Date.now() > data.expires) {
    delete tokens[token];
    return res.json({ success: false, error: "Token expirado" });
  }

  const discordId = data.discordId;
  const license = licenses[key];

  if (!license) {
    return res.json({ success: false, error: "Key inválida" });
  }

  if (!license.active) {
    return res.json({ success: false, error: "Key desativada" });
  }

  if (!license.hwid) {
    license.hwid = hwid;
    license.discordId = discordId;
    return res.json({ success: true, firstBind: true });
  }

  if (license.hwid !== hwid) {
    return res.json({ success: false, error: "HWID diferente" });
  }

  return res.json({ success: true });
});

// ========= ADMIN =========
function checkAdmin(req, res, next) {
  const password = req.headers["x-admin-password"];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: "Senha admin inválida" });
  }
  next();
}

function generateKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const part = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `GZN-${part()}-${part()}-${part()}`;
}

app.get("/api/licenses", checkAdmin, (req, res) => {
  const list = Object.entries(licenses).map(([key, value]) => ({
    key,
    ...value
  }));
  res.json(list);
});

app.post("/api/licenses/create", checkAdmin, (req, res) => {
  const key = generateKey();

  licenses[key] = {
    hwid: null,
    discordId: null,
    active: true,
    createdAt: new Date().toISOString()
  };

  res.json({ success: true, key });
});

app.post("/api/licenses/toggle", checkAdmin, (req, res) => {
  const { key } = req.body;

  if (!licenses[key]) {
    return res.json({ success: false, error: "Key não encontrada" });
  }

  licenses[key].active = !licenses[key].active;
  res.json({ success: true, active: licenses[key].active });
});

app.post("/api/licenses/reset-hwid", checkAdmin, (req, res) => {
  const { key } = req.body;

  if (!licenses[key]) {
    return res.json({ success: false, error: "Key não encontrada" });
  }

  licenses[key].hwid = null;
  licenses[key].discordId = null;

  res.json({ success: true });
});

app.post("/api/licenses/delete", checkAdmin, (req, res) => {
  const { key } = req.body;

  if (!licenses[key]) {
    return res.json({ success: false, error: "Key não encontrada" });
  }

  delete licenses[key];
  res.json({ success: true });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("rodando na porta " + PORT);
});
