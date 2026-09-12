# Debounce Translation Lab - Commands

Open Git Bash and run:

```bash
cd /d/4_1/Cloud_Technologies/Lab_2
```

## 1. Install dependencies

```bash
npm install
```

## 2. Configure the DeepL key

Create a `.env` file based on `.env.example`:

```bash
copy .env.example .env
```

Then add your key:

```env
DEEPL_API_KEY=your_api_key_here
```

## 3. Start the app

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

Then open:

```text
http://localhost:3000
```

## 4. Manual experiments in the browser

### Experiment 1 — Standard trailing debounce
- Delay: `500` ms
- Leading: off
- Trailing: on
- Type quickly: `Hello`
- Expected: several `CALL` entries, one `EXECUTION`, one HTTP request

### Experiment 2 — Leading
- Delay: `500` ms
- Leading: on
- Trailing: off
- Type a burst quickly
- Expected: first call executes immediately, later calls are suppressed

### Experiment 3 — Leading + trailing
- Delay: `500` ms
- Leading: on
- Trailing: on
- Type several characters fast
- Expected: first call is immediate and latest value is sent after pause

### Experiment 4 — Dispose
- Leave trailing enabled
- Start typing
- Click `Dispose` before the timer finishes
- Expected: pending execution does not happen

## 5. What the app demonstrates

- A user types text into the input area.
- Every keystroke triggers a `CALL` event.
- The Debounce wrapper starts one timer from the first call in the burst.
- Further keystrokes update the latest value without moving that timer.
- When the original delay expires, the latest value available at that moment is sent to the backend.
- The backend sends the request to DeepL in one final API call.

## 6. Backend endpoint

```http
POST /api/translate
```

Body:

```json
{
  "text": "Hello",
  "sourceLanguage": "EN",
  "targetLanguage": "UK"
}
```

## 7. Important note

This project is intentionally a manual demonstration project. It does not use automated tests as requested in the laboratory assignment.
