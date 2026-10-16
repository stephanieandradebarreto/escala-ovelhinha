// API da escala da Casa da Ovelhinha.
// Guarda as vagas num banco Redis (Upstash) conectado pela Vercel.
// GET    -> lista todas as vagas preenchidas
// POST   -> preenche uma vaga livre   { chave, data, turma, nome }
// DELETE -> libera uma vaga            { chave }

const URL_DB = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = "escala";
const VAGAS = ["bercario1", "bercario2", "maternal", "juniores", "volante"];

async function redis(...comando) {
  const r = await fetch(URL_DB, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(comando),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function chaveValida(chave) {
  const m = /^(\d{4}-\d{2}-\d{2})_([a-z0-9]+)$/.exec(String(chave || ""));
  return m && VAGAS.includes(m[2]) ? m : null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_DB || !TOKEN) {
    return res.status(500).json({ erro: "Banco de dados não conectado no projeto da Vercel." });
  }
  try {
    if (req.method === "GET") {
      const lista = (await redis("HGETALL", HASH)) || [];
      const vagas = {};
      for (let i = 0; i < lista.length; i += 2) {
        try { vagas[lista[i]] = JSON.parse(lista[i + 1]); } catch (e) {}
      }
      return res.status(200).json({ vagas });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const m = chaveValida(body.chave);
    if (!m) return res.status(400).json({ erro: "Vaga inválida." });

    if (req.method === "POST") {
      const nome = String(body.nome || "").trim().slice(0, 40);
      if (!nome) return res.status(400).json({ erro: "Nome vazio." });
      const valor = JSON.stringify({ nome, data: m[1], turma: String(body.turma || "").slice(0, 20), criadoEm: new Date().toISOString() });
      // HSETNX só grava se a vaga ainda estiver livre: duas pessoas nunca ficam com a mesma vaga
      const gravou = await redis("HSETNX", HASH, body.chave, valor);
      if (gravou === 1) return res.status(200).json({ ok: true });
      const atual = JSON.parse((await redis("HGET", HASH, body.chave)) || "{}");
      return res.status(409).json({ erro: "Vaga já preenchida.", nome: atual.nome || "" });
    }

    if (req.method === "DELETE") {
      await redis("HDEL", HASH, body.chave);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ erro: "Método não permitido." });
  } catch (e) {
    return res.status(500).json({ erro: "Erro ao acessar o banco de dados." });
  }
};
