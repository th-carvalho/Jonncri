const crypto = require('crypto');
const {httpError, getCatalog} = require('./_lib/lucromais');
const {PARCELAS_MAX, UFS, calcularFrete, configPublica} = require('./_lib/loja');
const {createPreference} = require('./_lib/mercadopago');

const MAX_ITENS = 20;
const MAX_POR_ITEM = 10;

const digits = value => String(value ?? '').replace(/\D/g, '');
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function cpfValido(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    const check = (sum * 10) % 11 % 10;
    if (check !== Number(cpf[size])) return false;
  }
  return true;
}

function validarCliente(body) {
  const cliente = body.cliente || {};
  const endereco = body.endereco || {};
  const dados = {
    nome: text(cliente.nome, 120),
    email: text(cliente.email, 120).toLowerCase(),
    cpf: digits(cliente.cpf),
    telefone: digits(cliente.telefone),
    cep: digits(endereco.cep),
    rua: text(endereco.rua, 120),
    numero: text(endereco.numero, 20),
    complemento: text(endereco.complemento, 60),
    bairro: text(endereco.bairro, 80),
    cidade: text(endereco.cidade, 80),
    uf: text(endereco.uf, 2).toUpperCase(),
  };
  if (dados.nome.split(' ').length < 2) throw httpError(400, 'Informe seu nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dados.email)) throw httpError(400, 'Informe um email válido.');
  if (!cpfValido(dados.cpf)) throw httpError(400, 'Informe um CPF válido.');
  if (dados.telefone.length < 10 || dados.telefone.length > 11) throw httpError(400, 'Informe um celular com DDD.');
  if (dados.cep.length !== 8) throw httpError(400, 'Informe um CEP válido.');
  if (!dados.rua || !dados.numero || !dados.bairro || !dados.cidade) throw httpError(400, 'Preencha o endereço de entrega completo.');
  if (!UFS.includes(dados.uf)) throw httpError(400, 'Selecione o estado de entrega.');
  return dados;
}

// Recalcula tudo no servidor com o estoque e os preços atuais: o navegador só informa variação e quantidade.
async function montarItens(itensPedido) {
  if (!Array.isArray(itensPedido) || !itensPedido.length) throw httpError(400, 'Sua sacola está vazia.');
  if (itensPedido.length > MAX_ITENS) throw httpError(400, 'Pedido com itens demais.');

  const catalogo = await getCatalog({fresh: true});
  const porVariacao = new Map();
  catalogo.forEach(produto => produto.variacoes.forEach(variacao => porVariacao.set(Number(variacao.id), {produto, variacao})));

  const quantidades = new Map();
  for (const item of itensPedido) {
    const id = Number(item.variacao_id);
    const quantidade = Number(item.quantidade);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(quantidade) || quantidade < 1) throw httpError(400, 'Item inválido na sacola.');
    quantidades.set(id, (quantidades.get(id) || 0) + quantidade);
  }

  const indisponiveis = [];
  const itens = [];
  for (const [id, quantidade] of quantidades) {
    const encontrado = porVariacao.get(id);
    if (!encontrado) {
      indisponiveis.push({variacao_id: id, disponivel: 0});
      continue;
    }
    const {produto, variacao} = encontrado;
    const limite = Math.min(MAX_POR_ITEM, variacao.estoque === null ? MAX_POR_ITEM : variacao.estoque);
    if (quantidade > limite) {
      indisponiveis.push({variacao_id: id, disponivel: limite});
      continue;
    }
    const detalhe = [variacao.cor, variacao.tamanho].filter(Boolean).join(' / ');
    itens.push({
      variacao_id: id,
      roupa_id: produto.id,
      quantidade,
      preco: produto.preco,
      nome: detalhe ? `${produto.nome} — ${detalhe}` : produto.nome,
      foto: variacao.fotos[0] || produto.foto_url || '',
    });
  }

  if (indisponiveis.length) {
    const error = httpError(409, 'Algumas peças da sua sacola acabaram de esgotar ou têm menos unidades disponíveis. Revise sua sacola.');
    error.indisponiveis = indisponiveis;
    throw error;
  }
  if (itens.some(item => !(item.preco > 0))) throw httpError(409, 'Uma das peças está sem preço cadastrado. Fale conosco pelo WhatsApp.');
  return itens;
}

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') return res.status(200).json(configPublica());
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({error: 'Método não permitido.'});
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const cliente = validarCliente(body);
    const itens = await montarItens(body.itens);
    const subtotal = Math.round(itens.reduce((sum, item) => sum + item.preco * item.quantidade, 0) * 100) / 100;
    const frete = calcularFrete(cliente.uf, subtotal);
    const pedido = `JNC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const base = siteUrl(req);
    const [primeiroNome, ...sobrenome] = cliente.nome.split(' ');
    const enderecoTexto = [
      `${cliente.rua}, ${cliente.numero}`, cliente.complemento, cliente.bairro,
      `${cliente.cidade}/${cliente.uf}`, `CEP ${cliente.cep.replace(/(\d{5})(\d{3})/, '$1-$2')}`,
    ].filter(Boolean).join(' - ');

    const preference = await createPreference({
      external_reference: pedido,
      statement_descriptor: 'JONNCRI',
      items: itens.map(item => ({
        id: String(item.variacao_id),
        title: item.nome.slice(0, 250),
        quantity: item.quantidade,
        unit_price: item.preco,
        currency_id: 'BRL',
        category_id: 'fashion',
        ...(item.foto ? {picture_url: item.foto} : {}),
      })),
      shipments: {mode: 'not_specified', cost: frete.valor},
      payer: {
        name: primeiroNome,
        surname: sobrenome.join(' '),
        email: cliente.email,
        phone: {area_code: cliente.telefone.slice(0, 2), number: cliente.telefone.slice(2)},
        identification: {type: 'CPF', number: cliente.cpf},
        address: {zip_code: cliente.cep, street_name: cliente.rua, street_number: cliente.numero},
      },
      payment_methods: {installments: PARCELAS_MAX},
      back_urls: {
        success: `${base}/?pedido=aprovado&ref=${pedido}`,
        pending: `${base}/?pedido=pendente&ref=${pedido}`,
        failure: `${base}/?pedido=recusado&ref=${pedido}`,
      },
      auto_return: 'approved',
      notification_url: `${base}/api/mp-webhook?source_news=webhooks`,
      expires: true,
      expiration_date_to: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      date_of_expiration: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      // Dados lidos pelo webhook para lançar a venda no LucroMais depois da aprovação.
      metadata: {
        pedido,
        frete: frete.valor,
        endereco: enderecoTexto,
        cliente: `${cliente.nome} · CPF ${cliente.cpf} · Tel ${cliente.telefone} · ${cliente.email}`,
        itens: itens.map(item => ({v: item.variacao_id, r: item.roupa_id, q: item.quantidade, p: item.preco, n: item.nome.slice(0, 120)})),
      },
    }, pedido);

    return res.status(200).json({pedido, url: preference.init_point});
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('[Checkout]', error);
    return res.status(status).json({
      error: status >= 500 && !error.status ? 'Não foi possível iniciar o pagamento. Tente novamente.' : error.message,
      ...(error.indisponiveis ? {indisponiveis: error.indisponiveis} : {}),
    });
  }
};
