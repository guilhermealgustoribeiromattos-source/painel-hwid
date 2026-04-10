const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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
const tokens = {};

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

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

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
    if (!code) return res.status(400).send("Code não Recebido.");

    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
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
        <head><title>Verificando Discord</title></head>
        <body style="margin:0;background:#08111f;color:white;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="text-align:center;padding:30px;border-radius:18px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">
            <h2>Discord verificado com sucesso</h2>
            <div style="color:#8ea0c8;margin-top:10px;">Redirecionando... Não Atualize a Página.</div>
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
    return res.status(500).send("Erro Interno no Callback.");
  }
});

app.get("/session", (req, res) => {
  const token = req.query.token;
  if (!token || !tokens[token]) {
    return res.json({ success: false, error: "Sessão não Encontrada" });
  }

  const data = tokens[token];
  if (Date.now() > data.expires) {
    delete tokens[token];
    return res.json({ success: false, error: "Sessão Expirada" });
  }

  res.json({
    success: true,
    username: data.username,
    avatar: data.avatar,
    discordId: data.discordId
  });
});

app.post("/auth", async (req, res) => {
  try {
    const { token, key, hwid } = req.body;

    if (!token || !key) {
      return res.json({ success: false, error: "Token ou Key Ausente" });
    }

    const tokenData = tokens[token];
    if (!tokenData) {
      return res.json({ success: false, error: "Token Inválido" });
    }

    if (Date.now() > tokenData.expires) {
      delete tokens[token];
      return res.json({ success: false, error: "Token Expirado" });
    }

    const license = await License.findOne({ key });
    if (!license) {
      return res.json({ success: false, error: "Key Inválida" });
    }

    if (!license.active) {
      return res.json({ success: false, error: "Key Desativada" });
    }

    const isWeb = !hwid || String(hwid).startsWith("WEB-");
    if (isWeb) {
      return res.json({ success: true, webOnly: true, message: "Login Web Validado" });
    }

    if (!license.hwid) {
      license.hwid = hwid;
      license.discordId = tokenData.discordId;
      license.discordUsername = tokenData.username;
      await license.save();

      return res.json({ success: true, firstBind: true, message: "HWID Vinculado com Sucesso" });
    }

    if (license.hwid !== hwid) {
      return res.json({ success: false, error: "HWID Diferente" });
    }

    if (license.discordId && license.discordId !== tokenData.discordId) {
      return res.json({ success: false, error: "Discord Diferente do Vinculado" });
    }

    return res.json({ success: true, message: "Login Autorizado" });
  } catch (err) {
    console.error("ERRO /auth:", err);
    return res.status(500).json({ success: false, error: "Erro Interno" });
  }
});

app.get("/api/licenses", checkAdmin, async (req, res) => {
  try {
    const list = await License.find().sort({ createdAt: -1 });
    res.json(list);
  } catch {
    res.status(500).json({ success: false, error: "Erro ao Buscar Keys" });
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
    res.status(500).json({ success: false, error: "Erro ao Criar Key" });
  }
});

app.post("/api/licenses/toggle", checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    const license = await License.findOne({ key });

    if (!license) {
      return res.json({ success: false, error: "Key não Encontrada" });
    }

    license.active = !license.active;
    await license.save();
    res.json({ success: true, active: license.active });
  } catch {
    res.status(500).json({ success: false, error: "Erro ao Alterar Key" });
  }
});

app.post("/api/licenses/reset-hwid", checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    const license = await License.findOne({ key });

    if (!license) {
      return res.json({ success: false, error: "Key não Encontrada" });
    }

    license.hwid = null;
    license.discordId = null;
    license.discordUsername = null;
    await license.save();
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: "Erro ao Resetar HWID" });
  }
});

app.post("/api/licenses/delete", checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    const result = await License.deleteOne({ key });

    if (result.deletedCount === 0) {
      return res.json({ success: false, error: "Key não Encontrada" });
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: "Erro ao Excluir Key" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("rodando na porta " + PORT);
});
