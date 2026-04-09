const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

let tokens = {};
let users = {};

// 🔑 CONFIGURA AQUI
const CLIENT_ID = "1491183348167475322";
const CLIENT_SECRET = "f4UmFHkGEq3oD2Ea_LwEmnpEV_ceWTcv";
const REDIRECT_URI = "http://localhost:3000/callback";

// LOGIN DISCORD
app.get("/login", (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
  res.redirect(url);
});

// CALLBACK
app.get("/callback", async (req, res) => {
  const code = req.query.code;

  const tokenRes = await axios.post("https://discord.com/api/oauth2/token", new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI
  }), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

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
    <h2>Logado com sucesso</h2>
    <script>
      setTimeout(() => {
        window.location.href = "gzn://login?token=${loginToken}";
      }, 1000);
    </script>
  `);
});

// VALIDAR (HWID entra aqui depois)
app.post("/auth", (req, res) => {
  const { token, hwid } = req.body;

  const data = tokens[token];
  if (!data) return res.json({ success: false });

  if (Date.now() > data.expires) {
    delete tokens[token];
    return res.json({ success: false });
  }

  let user = users[data.discordId];

  if (!user) {
    users[data.discordId] = { hwid };
  } else {
    if (user.hwid !== hwid) {
      return res.json({ success: false, error: "HWID diferente" });
    }
  }

  res.json({ success: true });
});

app.listen(3000, () => {
  console.log("🔥 API rodando em http://localhost:3000");
});