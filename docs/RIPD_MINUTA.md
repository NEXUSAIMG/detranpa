# Relatório de Impacto à Proteção de Dados Pessoais (RIPD) — MINUTA

**Tratamento:** Assistente virtual de atendimento ao cidadão (site e WhatsApp), Copiloto do Balcão e Central de Gestão.
**Controlador:** Departamento de Trânsito do Estado (DETRAN-__) — preencher.
**Operador:** MG Inteligência Artificial (Ayio) — preencher CNPJ.
**Encarregado (DPO) do controlador:** preencher nome e contato.
**Base legal principal:** art. 7º, III e art. 23 da LGPD (execução de políticas públicas e atribuições legais do órgão), com o art. 7º, V quando o cidadão pede um serviço.
**Versão:** minuta técnica de 22/11/2026, elaborada pelo operador para revisão do encarregado e da assessoria jurídica do DETRAN.

> Esta minuta descreve o que o sistema faz hoje, com base no código e nos testes. As partes marcadas "DETRAN decide" dependem do controlador.

## 1. Descrição do tratamento

| Etapa | O que acontece | Dados pessoais |
| --- | --- | --- |
| Conversa no site | O cidadão pergunta; o assistente responde pela base oficial do DETRAN | Texto que o cidadão escrever; identificador de sessão aleatório do navegador |
| Conversa no WhatsApp | Igual, pelo número oficial do DETRAN | Número de telefone, nome de perfil do WhatsApp, texto, áudio (transcrito e descartado) |
| Foto de documento (conferência) | A foto é analisada na hora para dizer o que falta | Imagem do documento (não é guardada — ver 4.3) |
| Atendimento humano | O servidor assume a conversa | Os mesmos da conversa + notas internas |
| Chamados | Pendência com protocolo | Nome, telefone, descrição |
| Copiloto do Balcão | Triagem de documentos no balcão presencial | Dados do caso informados pelo servidor |
| Lembretes | Aviso de prazo (CNH, defesa, licenciamento) | Telefone, tipo e data do prazo |
| Meu DETRAN (opcional, se ligado) | Consulta aos dados do próprio cidadão após login gov.br | CPF e dados do sistema do DETRAN, só durante a sessão |
| Indicadores | Estatísticas de uso | Nenhum dado pessoal (só contagens e temas) |

## 2. Necessidade e proporcionalidade

- **Mínimo necessário:** o sistema não pede CPF, endereço ou documento para responder dúvidas. O aviso inicial orienta a não enviar senhas nem dados bancários.
- **Finalidade única:** atendimento ao cidadão e melhoria do serviço. Não há venda, perfilamento comercial nem uso para publicidade.
- **Fotos:** usadas só no momento da análise.

## 3. Ciclo de vida e retenção

| Dado | Prazo | Como sai |
| --- | --- | --- |
| Conversas e mensagens | 180 dias sem atividade (configurável — DETRAN decide) | Apagamento automático diário, com relatório |
| Fichas de cidadão sem conversa | Mesmo prazo | Apagamento automático |
| Registros do balcão | Mesmo prazo | Apagamento automático |
| Chamados resolvidos/cancelados | 365 dias (configurável) | Anonimização (some nome, telefone, descrição e comentários; fica o protocolo para estatística) |
| Lembretes concluídos/cancelados | Prazo das conversas | Apagamento |
| Indicadores | Indeterminado | Não têm dado pessoal |
| Trilha de auditoria dos servidores | 1 ano | Expiração automática |
| Histórico das eliminações (só contagens) | 5 anos | Expiração automática |
| Cópias de segurança | até 180 dias | Rotação manual cifrada (Manual de Operação, seção 6) |

## 4. Medidas de segurança (técnicas)

1. **Acesso:** login individual por servidor, com perfis (Balcão, Tutor, Gestor, Admin); cada DETRAN só vê os próprios dados (testado).
2. **Verificação em duas etapas** (aplicativo autenticador) disponível para todos e obrigatória para os perfis definidos em `EXIGIR_2FA`.
3. **Trilha de auditoria:** logins, tentativas falhas, alterações e consultas a dados de cidadãos, com usuário, data e IP parcial.
4. **Fotos não são guardadas:** teste automático confirma que, após enviar fotos pelo chat e pela conferência, nenhuma tabela contém a imagem.
5. **Criptografia:** HTTPS em todo o tráfego (HSTS); segredos das integrações e das 2 etapas cifrados no banco (AES); senhas com hash.
6. **Cabeçalhos de segurança:** proteção contra embutir o site em outro (clickjacking), MIME sniffing e vazamento de referência.
7. **Limite de tentativas:** login (10/min por IP), perguntas e rotas sensíveis.
8. **Registro de falhas sem dado pessoal:** números longos e endereços são mascarados.
9. **Monitoramento:** checagem a cada 10 minutos com alerta por e-mail.
10. **Cópia de segurança** com procedimento de restauração testado.

## 5. Direitos do titular

- **Informação:** aviso no primeiro contato (site e WhatsApp) e página de privacidade do DETRAN.
- **Eliminação:** o cidadão escreve "apagar meus dados" no WhatsApp (com confirmação) ou apaga a conversa no site; o gestor também pode apagar a pedido. Cada eliminação entra no histórico (só contagens).
- **Acesso e correção:** pelo encarregado do DETRAN (DETRAN decide o canal).

## 6. Compartilhamento e operadores

| Quem | O que recebe | Onde | Observação |
| --- | --- | --- | --- |
| Vercel (hospedagem do app) | Tráfego da aplicação | EUA/Brasil (edge) | Contrato padrão com cláusulas de proteção — confirmar |
| Railway (banco e BotAyio) | Banco de dados e processamento das respostas | EUA | Transferência internacional (art. 33) — DETRAN decide se aceita ou exige hospedagem nacional |
| Provedor de IA (DeepSeek/Anthropic) | Texto da pergunta para gerar a resposta; foto na conferência | Exterior | Sem armazenamento para treinamento conforme contrato do provedor — confirmar |
| Zapayio (WhatsApp) | Mensagens do WhatsApp | Brasil | Operador de mensagens |
| Groq/OpenAI (opcional) | Áudio para transcrição | Exterior | Só se ligado |

## 7. Riscos e tratamento

| Risco | Probabilidade | Impacto | Medida | Risco residual |
| --- | --- | --- | --- | --- |
| Acesso indevido de servidor a conversas | Baixa | Alto | Perfis, auditoria, 2 etapas | Baixo |
| Vazamento por senha fraca/roubada | Média | Alto | 2 etapas obrigatória para Admin/Gestor; limite de tentativas | Baixo |
| Cidadão enviar dado sensível sem necessidade | Alta | Médio | Aviso inicial; retenção de 180 dias; eliminação a pedido | Médio |
| Transferência internacional | Certa | Médio | Contratos com provedores; mínimo de dados; DETRAN avalia | Médio — DETRAN decide |
| Golpista se passar pelo assistente | Média | Alto | Antigolpe; o sistema nunca cobra; orientação ao portal oficial | Médio |
| Indisponibilidade | Baixa | Médio | Monitor, plano B de IA, procedimento de recuperação | Baixo |

## 8. Pendências para o DETRAN

- [ ] Nomear o encarregado e publicar o contato na página de privacidade (Central → Configurações).
- [ ] Confirmar os prazos de retenção (180/365 dias) ou definir outros.
- [ ] Decidir sobre a transferência internacional (aceitar com cláusulas ou exigir hospedagem no Brasil).
- [ ] Definir os perfis com 2 etapas obrigatória (recomendado: Admin e Gestor).
- [ ] Aprovar esta minuta e arquivar a versão assinada.
