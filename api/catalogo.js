const {getCatalog} = require('./_lib/lucromais');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Método não permitido.'});
  }

  try {
    const catalog = await getCatalog();
    res.setHeader('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=60');
    return res.status(200).json(catalog);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 502;
    return res.status(status).json({error: error.message || 'Falha ao consultar o estoque.'});
  }
};
