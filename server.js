const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/login-test", (req, res) => {
  res.send("LOGIN TESTE OK 123");
});

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("rodando na porta " + PORT);
});
