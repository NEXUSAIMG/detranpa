# Acordo de Nível de Serviço (SLA) — MINUTA

Anexo técnico ao contrato do Assistente DETRAN. Versão 22/11/2026, para negociação entre a MG Inteligência Artificial (Ayio) e o DETRAN.

## 1. Disponibilidade
- **Meta:** 99,5% ao mês (até 3 h 39 min fora do ar no mês), medida pelo monitor externo a cada 10 minutos em `/api/saude`.
- **Não contam:** manutenção avisada com 48 h de antecedência fora do horário de atendimento (máx. 4 h/mês); falhas do WhatsApp (Meta) ou do portal do DETRAN; casos de força maior.
- **Relatório mensal:** disponibilidade, incidentes, tempo de resposta e taxa de acerto da avaliação oficial.

## 2. Atendimento a incidentes

| Gravidade | Exemplo | Primeira resposta | Solução ou contorno |
| --- | --- | --- | --- |
| Crítica | Site e WhatsApp fora; vazamento suspeito | 1 h (24×7) | 4 h |
| Alta | WhatsApp fora; resposta errada sobre prazo/valor em tema frequente | 4 h úteis | 1 dia útil |
| Média | Funcionalidade secundária com falha; lentidão | 1 dia útil | 5 dias úteis |
| Baixa | Ajuste de texto, visual | 3 dias úteis | próxima versão |

Canal: e-mail e telefone do responsável técnico; incidentes críticos também por WhatsApp.

## 3. Qualidade das respostas
- **Avaliação oficial mensal** com o conjunto de perguntas validado pelo DETRAN: meta de **95%** de acerto e **100%** de "não inventar" nas perguntas sem resposta na base.
- Abaixo da meta: plano de correção em 5 dias úteis (ensinar pela Tutoria, ajustar a base) e nova avaliação.

## 4. Desempenho
- 95% das respostas completas em até **8 segundos**, medido pelo próprio sistema (Admin → Saúde).

## 5. Segurança e dados
- Notificação de incidente de segurança com dados pessoais ao encarregado do DETRAN em até **24 h** da ciência (para o DETRAN cumprir o prazo da ANPD).
- Cópia de segurança mensal com teste de restauração registrado.
- Teste de invasão independente anual, com reteste.

## 6. Créditos por descumprimento (sugestão)

| Disponibilidade no mês | Crédito na mensalidade |
| --- | --- |
| 99,0% a 99,49% | 5% |
| 98,0% a 98,99% | 10% |
| abaixo de 98,0% | 20% |

## 7. Treinamento
- Treinamento inicial de 4 h para servidores (Balcão, Gestão, Tutoria), com lista de presença e material (Guia de Testes e manuais).
- Reciclagem semestral de 1 h ou a cada mudança relevante.
