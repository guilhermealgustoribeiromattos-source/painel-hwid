const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// =========================
// MongoDB
// =========================
mongoose.connect(MONGODB_URI)
  .then(() => console.log("MongoDB conectado"))
  .catch((err) => console.error("Erro MongoDB:", err));

const licenseSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  hwid: { type: String, default: null },
  discordId: { type: String, default: null },
  discordUsername: { type: String, default: null },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const License = mongoose.model("License", licenseSchema);

// token temporário pós login Discord
const tokens = {};

// =========================
// Helpers
// =========================
function generateKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const part = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `GZN-${part()}-${part()}-${part()}`;
}

function checkAdmin(req, res, next) {
  const password = req.headers["x-admin-password"];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: "Senha admin inválida" });
  }
  next();
}

// =========================
// Pages
// =========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// =========================
// Discord OAuth
// =========================
app.get("/login", (req, res) => {
  const url =
    `https://discord.com/api/oauth2/authorize` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=identify`;
  res.redirect(url);
});

app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send("Code não recebido.");
    }

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
    const loginToken = Math.random().toString(36).slice(2);

    let avatarUrl = "/img/default-avatar.png";
    if (user.avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
    }

    tokens[loginToken] = {
      discordId: user.id,
      username: user.username,
      avatar: avatarUrl,
      expires: Date.now() + 1000 * 60 * 5
    };

    res.send(`
      <html>
        <head>
          <title>Verificando Discord</title>
          <style>
            body {
              margin:0;
              background:#08111f;
              color:white;
              font-family:Arial,sans-serif;
              display:flex;
              align-items:center;
              justify-content:center;
              height:100vh;
            }
            .box {
              text-align:center;
              padding:30px;
              border-radius:18px;
              background:rgba(255,255,255,0.04);
              border:1px solid rgba(255,255,255,0.08);
            }
            .muted {
              color:#8ea0c8;
              margin-top:10px;
            }
          </style>
        </head>
        <body>
          <div class="box">
            <h2>Discord verificado com sucesso</h2>
            <div class="muted">Redirecionando... não atualize a página.</div>
          </div>
          <script>
            setTimeout(() => {
              window.location.href = "/?token=${loginToken}";
            }, 1200);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    if (err.response) {
      console.error("Erro Discord:", err.response.status, err.response.data);
      return res.status(500).json(err.response.data);
    }
    console.error(err);
    return res.status(500).send("Erro interno no callback.");
  }
});

app.get("/session", (req, res) => {
  const token = req.query.token;

  if (!token || !tokens[token]) {
    return res.json({ success: false, error: "Sessão não encontrada" });
  }

  const data = tokens[token];

  if (Date.now() > data.expires) {
    delete tokens[token];
    return res.json({ success: false, error: "Sessão expirada" });
  }

  res.json({
    success: true,
    username: data.username,
    avatar: data.avatar,
    discordId: data.discordId
  });
});

// =========================
// Auth final (KEY + HWID)
// =========================
app.post("/auth", async (req, res) => {
  try {
    const { token, key, hwid } = req.body;

    if (!token || !key) {
      return res.json({ success: false, error: "Token ou Key ausente" });
    }

    const tokenData = tokens[token];
    if (!tokenData) {
      return res.json({ success: false, error: "Token inválido" });
    }

    if (Date.now() > tokenData.expires) {
      delete tokens[token];
      return res.json({ success: false, error: "Token expirado" });
    }

    const license = await License.findOne({ key });

    if (!license) {
      return res.json({ success: false, error: "Key inválida" });
    }

    if (!license.active) {
      return res.json({ success: false, error: "Key desativada" });
    }

    const isWeb = !hwid || String(hwid).startsWith("WEB-");

    // SITE: só valida Discord + key
    if (isWeb) {
      return res.json({
        success: true,
        webOnly: true,
        message: "Login web validado"
      });
    }

    // APP: valida HWID real
    if (!license.hwid) {
      license.hwid = hwid;
      license.discordId = tokenData.discordId;
      license.discordUsername = tokenData.username;
      await license.save();

      return res.json({
        success: true,
        firstBind: true,
        message: "HWID vinculado com sucesso"
      });
    }

    if (license.hwid !== hwid) {
      return res.json({ success: false, error: "HWID diferente" });
    }

    if (license.discordId && license.discordId !== tokenData.discordId) {
      return res.json({ success: false, error: "Discord diferente do vinculado" });
    }

    return res.json({ success: true, message: "Login autorizado" });
  } catch (err) {
    console.error("ERRO /auth:", err);
    return res.status(500).json({ success: false, error: "Erro interno" });
  }
});

// =========================
// Admin API
// =========================
app.get("/api/licenses", checkAdmin, async (req, res) => {
  try {
    const list = await License.find().sort({ createdAt: -1 });
    res.json(list);
  } catch {
    res.status(500).json({ success: false, error: "Erro ao buscar keys" });
  }
});

app.post("/api/licenses/create", checkAdmin, async (req, res) => {
  try {
    const key = generateKey();

    await License.create({
      key,
      hwid: null,
      discordId: null,
      discordUsername: null,
      active: true
    });

    res.json({ success: true, key });
  } catch {
    res.status(500).json({ success: false, error: "Erro ao criar key" });
  }
});

app.post("/api/licenses/toggle", checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    const license = await License.findOne({ key });

    if (!license) {
      return res.json({ success: false, error: "Key não encontrada" });
    }

    license.active = !license.active;
    await license.save();

    res.json({ success: true, active: license.active });
  } catch {
    res.status(500).json({ success: false, error: "Erro ao alterar key" });
  }
});

app.post("/api/licenses/reset-hwid", checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    const license = await License.findOne({ key });

    if (!license) {
      return res.json({ success: false, error: "Key não encontrada" });
    }

    license.hwid = null;
    license.discordId = null;
    license.discordUsername = null;
    await license.save();

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: "Erro ao resetar HWID" });
  }
});

app.post("/api/licenses/delete", checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    const result = await License.deleteOne({ key });

    if (result.deletedCount === 0) {
      return res.json({ success: false, error: "Key não encontrada" });
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: "Erro ao excluir key" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("rodando na porta " + PORT);
});
