# Atualizador de placares da Copa 2026

Este repositório atualiza automaticamente os placares dos eventos da agenda Google **Copa do Mundo 2026** usando GitHub Actions e a API aberta `worldcup26.ir` como fonte principal.

## Como funciona

- O GitHub Actions acorda a cada 5 minutos.
- O script sai imediatamente se não houver jogo em janela ativa.
- Durante uma janela de jogo, ele consulta a API aberta `worldcup26.ir`.
- Ele só atualiza quando as seleções da API batem com as seleções do evento da agenda.
- Se encontrar placar ao vivo ou final, atualiza o evento correspondente no Google Calendar.

## Segredos necessários no GitHub

Em `Settings > Secrets and variables > Actions > Secrets`, crie:

- `GOOGLE_CALENDAR_ID`: ID da agenda Copa do Mundo 2026.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: JSON completo da service account do Google.

O `GOOGLE_CALENDAR_ID` atual é:

```text
5876f101afb64371650d9ac4ab8c39c59dfacae79cbe4f29be21a4312daa860f@group.calendar.google.com
```

## Como criar a credencial do Google

1. Entre no Google Cloud Console.
2. Crie um projeto ou use um existente.
3. Ative a **Google Calendar API**.
4. Crie uma **Service Account**.
5. Crie uma chave JSON para essa service account.
6. Copie o JSON inteiro para o secret `GOOGLE_SERVICE_ACCOUNT_JSON`.
7. Copie o e-mail da service account.
8. No Google Calendar, compartilhe a agenda **Copa do Mundo 2026** com esse e-mail.
9. Dê permissão **Fazer alterações em eventos**.

Sem o passo 8/9, o GitHub consegue autenticar no Google, mas não consegue editar a agenda.

## Teste manual

No GitHub, abra:

`Actions > Atualizar placares da Copa 2026 > Run workflow`

O teste manual força a execução mesmo fora da janela de jogo.

## Arquivos importantes

- `.github/workflows/update-world-cup-scores.yml`: agenda o robô.
- `scripts/update-world-cup-scores.mjs`: consulta `worldcup26.ir` e atualiza o Google Calendar.
- `copa-do-mundo-2026-todos-os-jogos.csv`: calendário-base usado para decidir janelas de execução.

## Observações

- O GitHub Actions não roda cron a cada 1 minuto de forma confiável; o mínimo prático é 5 minutos.
- Em repositório público, Actions em runner padrão é grátis.
- Em repositório privado, a conta grátis tem cota mensal de minutos.
- A API-Football não é usada por padrão. Ela só entra se `USE_API_FOOTBALL_FALLBACK=1` for configurado explicitamente.
