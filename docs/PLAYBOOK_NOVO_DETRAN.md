# Playbook: implantar o assistente em um novo DETRAN em 1 dia (Fase 4)

Público: equipe Ayio (super admin) e o ponto focal do DETRAN. Pré-requisito: contrato ou termo de cooperação assinado.

## Antes do dia (D-7 a D-1): o DETRAN envia

- [ ] Nome oficial, sigla, UF, domínio do site, logo (SVG ou PNG ≥ 512 px) e cores da identidade.
- [ ] Lista de serviços prioritários (10 a 20) e as normas/portarias de cada um (PDF ou link oficial).
- [ ] Endereços, horários e telefones das unidades.
- [ ] Número de WhatsApp oficial (chip dedicado) e quem vai escanear o QR de pareamento.
- [ ] Nomes e e-mails institucionais dos usuários: gestor, tutor(es), balcão. **Cada pessoa cria a própria senha** no primeiro acesso.
- [ ] Ponto focal de comunicação (para cartazes e QR).

## O dia (D0)

| Hora | Passo | Quem | Onde |
|---|---|---|---|
| 09:00 | Criar o DETRAN (slug = UF em minúsculas), nome, sigla, cores, logo | Ayio | Admin → DETRANs → Novo |
| 09:30 | Carregar a base de conhecimento (serviços, documentos, taxas, unidades) | Ayio + tutor | Admin → Base / Tutoria |
| 10:30 | Revisar identidade: página, cores com contraste AA, disclaimer de canal oficial | Ayio | `/<slug>` |
| 11:00 | Configurar o bot no BotAyio (somente bots do DETRAN) e a integração Zapayio | Ayio | Admin → Integrações |
| 11:30 | Pareamento do WhatsApp (o DETRAN escaneia o QR) | DETRAN | Admin → Integrações |
| 12:00 | Criar usuários (convite; senha criada pela própria pessoa) e ativar a verificação em 2 etapas dos gestores | Ayio + DETRAN | Admin → Usuários |
| 13:30 | Rodar a avaliação de respostas (perguntas do novo DETRAN) e corrigir lacunas | Tutor | `scripts/avaliar-respostas.mjs`, Tutoria |
| 15:00 | Teste de aceite (checklist abaixo) | Ayio + DETRAN | Site e WhatsApp |
| 16:00 | Treinamento rápido: Balcão (1 h) e Central (1 h) | Ayio | Online |
| 17:30 | Gerar QR e cartazes dos primeiros pontos; registrar a linha de base em *Antes e depois* | Comunicação + gestor | Central → Observatório |
| 18:00 | Publicar o link no site oficial | DETRAN | Site do DETRAN |

## Checklist de aceite (todos devem passar)

- [ ] `/api/saude` sem itens do novo DETRAN em `fora`.
- [ ] Site: pergunta sobre 3 serviços prioritários responde com documentos corretos.
- [ ] WhatsApp: mensagem de teste respondida em menos de 15 s; "atendente" faz transbordo.
- [ ] Verificação de golpe identifica um boleto falso de exemplo.
- [ ] Conferência de documentos chega ao fim e mostra a pesquisa "isso evitou uma ida?".
- [ ] Balcão recebe o transbordo; Central mostra o Observatório.
- [ ] Monitor (GitHub Actions) inclui o novo DETRAN e está verde.
- [ ] Acessibilidade: auditoria axe sem violações AA na página do DETRAN.
- [ ] Usuário de cada perfil entra só nas áreas dele.

## Depois do dia

- **D+1 a D+7:** tutor revisa as lacunas todos os dias.
- **D+7:** reunião de 30 min: lacunas, origens dos acessos, ajustes.
- **D+30:** primeira medição em *Antes e depois* e *Relatório do período (PDF)*.
- A partir daí: seguir o *Plano de divulgação e treinamento* e a *Metodologia de 90 dias*.

## Riscos comuns

| Risco | Como evitar |
|---|---|
| Base desatualizada (norma revogada) | Tutor confirma a data de cada norma antes do D0 |
| WhatsApp desconecta | Monitor avisa por e-mail a cada 10 min; ponto focal sabe re-parear |
| Página confundida com golpe | Domínio oficial, link no site do DETRAN, aviso antigolpe em todo material |
| Senhas fracas / compartilhadas | Cada pessoa cria a sua; 2 etapas obrigatória para gestores (EXIGIR_2FA) |
