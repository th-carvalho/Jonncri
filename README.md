# JONNCRI

O catálogo do site consulta o estoque atual da API LucroMais por meio da função server-side `GET /api/catalogo`. O navegador não recebe a senha nem o token da API. A função devolve somente dados públicos e omite produtos/variações sem estoque.

## Configuração de produção

Este projeto deve ser publicado na Vercel para que a função em `api/catalogo.js` seja executada junto com a página. No projeto da Vercel, cadastre estas variáveis de ambiente (Production e, se necessário, Preview):

- `LM_EMAIL`: email do usuário exclusivo de integração criado no LucroMais.
- `LM_SENHA`: senha desse usuário. Não coloque credenciais em arquivos do site nem em variáveis `VITE_*`/`NEXT_PUBLIC_*`.
- `LM_EMPRESA_ID`: identificador numérico da empresa Jonncriim, obrigatório se o login retornar `multiEmpresa: true`.

Depois de configurar as variáveis, faça um novo deploy. A página fica disponível na raiz e também em `/jonncri-landing.html`. Para conferir a integração, abra `/api/catalogo`: a resposta deve ser um array com peças atualmente disponíveis. O catálogo é armazenado em cache por aproximadamente três minutos.

O site pode ser testado sem credenciais, mas a consulta retornará erro de configuração até essas variáveis serem definidas no ambiente de deploy.
## Checkout (Mercado Pago)

O site tem página de produto, sacola e checkout. O pagamento é feito no Checkout Pro do Mercado Pago (Pix, cartão em até 6x e boleto).

Fluxo:

1. `POST /api/checkout` confere preço e estoque atuais no LucroMais, calcula o frete pela UF e cria a preferência de pagamento no Mercado Pago.
2. O cliente paga no ambiente do Mercado Pago e volta para o site (`/?pedido=aprovado|pendente|recusado`).
3. O Mercado Pago avisa `POST /api/mp-webhook`. Quando o pagamento é aprovado, a venda é lançada no LucroMais (`POST /api/vendas`), o que dá baixa no estoque. A observação da venda leva `Pedido site <nº> · MP <id do pagamento>` e os dados do cliente; o endereço vai em "endereço de entrega".
4. Se a peça esgotou entre o checkout e a aprovação (ex.: Pix pago horas depois), o pagamento é estornado automaticamente.

Variáveis de ambiente adicionais na Vercel:

- `MP_ACCESS_TOKEN`: Access Token de **produção** da aplicação no painel de desenvolvedor do Mercado Pago. Sem ele, o botão do checkout envia o pedido pelo WhatsApp.
- `MP_WEBHOOK_SECRET` (recomendado): assinatura secreta dos webhooks, gerada no mesmo painel em "Webhooks". Configure lá a URL `https://<domínio>/api/mp-webhook` com o evento "Pagamentos".
- `SITE_URL` (opcional): domínio público, ex. `https://jonncri.com.br`. Sem ele, usa o domínio da requisição.

Valores de frete por região, parcelas e frete grátis ficam em `api/_lib/loja.js`. O número do WhatsApp fica na constante `WHATSAPP` em `jonncri-landing.html` e no botão flutuante.
