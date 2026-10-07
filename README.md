# DILO

> Tu dillo. DILO ci pensa.

Assistente personale AI in italiano: l'utente dice o scrive liberamente ciò che ha in testa e DILO lo trasforma in attività, promemoria, eventi, note e routine.

**PARLI → DILO CAPISCE → DILO RICORDA → DILO AGISCE**

Questo repository contiene il motore che capisce le frasi (DILO CAPISCE), la memoria locale (DILO RICORDA) e la web app mobile-first.

## Provalo

```bash
pnpm install
cp .env.example .env          # inserisci ANTHROPIC_API_KEY
pnpm dilo "Domani alle 15 prenota il dentista e ricordami di chiamare Marco"
# 1. Attività: Prenotare il dentista — domani alle 15:00
# 2. Promemoria: Chiamare Marco — domani

pnpm dilo                     # modalità conversazione: DILO fa domande e tu rispondi
pnpm dilo --json "..."        # output strutturato completo
```

## La web app

```bash
pnpm install
cp .env.example .env          # inserisci ANTHROPIC_API_KEY (resta sul server)
pnpm web                      # http://localhost:3000, aprila anche dal telefono sulla stessa rete
```

Home "Cosa hai in testa?": il pulsante **Parla con DILO** usa il riconoscimento vocale del browser in italiano (Chrome, Edge, Safari su iPhone); dove non c'è, si scrive nel campo "Oppure scrivi qui...". DILO mostra cosa ha capito, lo salva subito (con "Annulla"), e se manca qualcosa fa una domanda breve a cui si risponde lì. Sotto: **Oggi** (in programma, in giornata, scadenze, rimasto indietro, da chiarire), **Prossimi** (7 giorni, routine, senza data) e **Note**. Gli elementi si spuntano o si eliminano.

Per ora la memoria sta nel browser (localStorage): ogni dispositivo ha la sua. Senza chiave l'app si apre, ma l'API risponde "manca la chiave API sul server".

### Online (Vercel)

1. Importa il repository su [vercel.com/new](https://vercel.com/new) e scegli **Root Directory** `apps/web` (Vercel riconosce Next.js e pnpm).
2. In **Environment Variables** aggiungi `ANTHROPIC_API_KEY` e `DILO_PASSWORD` (così solo chi ha la password usa la tua chiave).
3. **Deploy**. Sul telefono apri l'indirizzo, inserisci la password e, da Safari o Chrome, "Aggiungi a schermata Home".

### Google Calendar

Ogni elemento con una data ha "Aggiungi a Google Calendar" (link precompilato, nessuna configurazione). Per il salvataggio automatico: crea un OAuth Client ID di tipo *Web application* su Google Cloud (Google Calendar API attiva, origine `https://<tuo-dominio>`), mettilo in `NEXT_PUBLIC_GOOGLE_CLIENT_ID` e rifai il deploy. Nell'app compare "Collega Google Calendar": da lì ciò che ha una data viene scritto nel calendario, e ciò che annulli o elimini viene tolto. Il permesso dura circa un'ora; poi basta un tocco su "Ricollega".

### WhatsApp

DILO risponde anche su WhatsApp, come una chat: gli scrivi o gli mandi un vocale, lui risponde con quello che ha capito e lo ricorda. Scrivendo *oggi* o *domani* mostra cosa c'è in programma, *annulla* toglie l'ultimo messaggio. Se manca qualcosa fa una domanda e legge il messaggio successivo come risposta.

Come funziona: Meta chiama `POST /api/whatsapp` (firmato con la chiave segreta dell'app; escluso dalla password), DILO risponde subito 200 e poi trascrive il vocale, capisce, salva e risponde con l'API WhatsApp Cloud. La memoria di ogni numero sta in un database Redis sul server (`src/server/whatsapp`), separata da quella del browser.

1. **Meta**: su [developers.facebook.com](https://developers.facebook.com/apps) crea un'app di tipo *Business* e aggiungi il prodotto **WhatsApp**. Meta dà un numero di prova gratuito: in *Configurazione API* aggiungi il tuo cellulare tra i destinatari. Copia l'*ID del numero di telefono*. Per un token che non scade crea un *utente di sistema* in Business Manager con il permesso `whatsapp_business_messaging`.
2. **Database**: su Vercel, *Storage* → *Create* → **Upstash Redis** (piano gratuito) e collegalo al progetto: crea `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
3. **Variabili su Vercel**: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (una parola a scelta), `WHATSAPP_ALLOWED_NUMBERS` (il tuo numero; senza, DILO non risponde a nessuno) e, per i vocali, `OPENAI_API_KEY`. Poi rifai il deploy.
4. **Webhook**: in Meta, *WhatsApp* → *Configurazione* → URL `https://<tuo-dominio>/api/whatsapp`, token di verifica uguale a `WHATSAPP_VERIFY_TOKEN`; poi attiva il campo **messages**.

**Google Calendar da WhatsApp**: scrivendo *calendario* DILO manda un link per collegare Google una volta; da lì scrive, aggiorna e toglie gli eventi da solo (il server conserva un refresh token per numero). Serve `GOOGLE_CLIENT_SECRET` dello stesso OAuth Client della web app, con l'URI di reindirizzamento `https://<tuo-dominio>/api/google/callback`. Con la schermata di consenso in modalità *Test* Google fa scadere il permesso dopo 7 giorni: pubblicala ("In produzione") per tenerlo.

Costi: rispondere ai messaggi dell'utente è gratis su WhatsApp; i vocali costano circa 0,3 centesimi al minuto con `gpt-4o-mini-transcribe`. Per ora DILO risponde soltanto: i promemoria inviati da DILO all'ora giusta richiedono un modello di messaggio approvato da Meta e arriveranno in un secondo passo.

## Test

```bash
pnpm test          # test deterministici, senza rete (date, orari, ricorrenze, vista Oggi, motore)
pnpm test:live     # frasi italiane reali contro Claude (serve ANTHROPIC_API_KEY)
```

## Come funziona

Il motore separa due problemi molto diversi:

1. **Capire la lingua** (Claude, output strutturato). Il modello individua gli elementi, il tipo, il titolo, le persone, e *descrive* i riferimenti temporali così come sono stati detti, con una notazione compatta (`d+1` = domani, `wd:5@1` = venerdì della settimana prossima, `cal:03-03`, `+20m`, `weekly:1,4`, vedi `packages/core/src/spec.ts`). Non calcola mai una data.
2. **Calcolare le date** (codice deterministico, `@dilo/core`). Le espressioni vengono risolte nel fuso orario dell'utente (default `Europe/Rome`, ora legale inclusa). Qui vivono anche i controlli che evitano di inventare: date impossibili (31 novembre), orari già passati, promemoria senza un quando, routine senza frequenza. In questi casi l'elemento resta in stato `needs_clarification` con una domanda breve.

Quando DILO fa una domanda, `engine.answer(elementi, risposta)` combina la richiesta originale con la risposta e restituisce gli elementi aggiornati.

```ts
import { createDilo } from "@dilo/nlu";
import { buildAgenda, todayIso } from "@dilo/core";

const dilo = createDilo(); // legge ANTHROPIC_API_KEY
const { items, questions } = await dilo.understand("Venerdì sera cena con Giulia, ricordamelo");
const oggi = buildAgenda(itemsSalvati, todayIso());
```

## Architettura

```
apps/
  web/    @dilo/web    Next.js. UI React (src/ui) + API /api/understand e /api/answer (src/server, indipendenti
                       dal framework). La chiave API vive solo qui, lato server.
                       /api/whatsapp: DILO come chat su WhatsApp (src/server/whatsapp), memoria in Redis.
packages/
  core/   @dilo/core   Dominio + tempo. TypeScript puro, nessuna rete: gira su web, server e React Native.
                       Tipi degli elementi, risoluzione di date/orari/ricorrenze, vista "Oggi", testi in italiano.
  nlu/    @dilo/nlu    Comprensione. Prompt, schema e chiamata a Claude dietro l'interfaccia ExtractionModel
                       (sostituibile nei test o con un altro fornitore). Gira lato server: la chiave API
                       non deve mai finire sul telefono.
  memory/ @dilo/memory Memoria: interfaccia ItemStore (salva, elimina, segna fatto, per giorno per le routine) e
                       implementazione su un key-value (localStorage oggi, AsyncStorage su Expo, server domani).
  actions/@dilo/actions Azioni (DILO AGISCE): Google Calendar API e CalendarSyncedStore, che tiene il calendario
                       allineato alla memoria.
  client/ @dilo/client Contratto dell'API (richieste validate, errori in italiano), client HTTP e DiloAssistant:
                       dice → capisce → ricorda, senza UI. Lo riuserà l'app Expo così com'è.
```

Prossimi livelli, già previsti dalla struttura:

- `apps/mobile`: app Expo (iOS/Android) che riusa `@dilo/core` e chiama la stessa API.
- Memoria sul server (account, sincronizzazione tra dispositivi) come nuova implementazione di `ItemStore`.
- `packages/actions` (DILO AGISCE): notifiche, calendario e azioni autorizzate dall'utente.

Modello di default: `claude-opus-5-5` con effort `medium`; configurabili con `DILO_MODEL` e `DILO_EFFORT`.
