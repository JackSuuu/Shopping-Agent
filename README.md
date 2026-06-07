# Shopping Agent

<img width="1053" height="797" alt="banner" src="https://github.com/user-attachments/assets/6ca096ee-76d4-473b-92fa-48b65f4a1343"/>

A grocery shopping agent that reads a Chinese weekly meal-plan table, extracts ingredients with Gemini AI, then autonomously adds them to a Morrisons online basket using Stagehand browser automation.

## How it works

1. Paste a Markdown meal-plan table into the web UI
2. Gemini (`gemini-2.5-flash`) extracts and translates each ingredient to English
3. A Stagehand v3 agent opens `groceries.morrisons.com`, searches for each item by URL, and clicks **Add to basket**
4. Real-time progress is streamed back to the UI via SSE
5. A fixed breakfast kit (sliced cooked meat, mixed salad leaves, bread) is appended automatically every run

## Stack

| Layer | Technology |
|---|---|
| Browser automation | [Stagehand v3](https://github.com/browserbasehq/stagehand) + Playwright |
| AI model | Google Gemini 2.5 Flash (via Stagehand + direct REST) |
| Backend | Node.js / Express |
| Frontend | Vanilla JS, Notion-style dark UI |

## Prerequisites

- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/) API key

## Setup

```bash
git clone https://github.com/JackSuuu/Shopping-Agent.git
cd Shopping-Agent
npm install
```

Create a `.env` file:

```
GEMINI_API_KEY=your_key_here
```

## Run

```bash
npm start
# or for auto-reload during development:
npm run dev
```

Open `http://localhost:3000` in your browser.

## Usage

1. Paste a Markdown table in the format below and click **开始购物**
2. Log in to your Morrisons account in the browser that opens, then click **继续**
3. The agent adds every ingredient — confirm and pay on the Morrisons site

### Example input

```
| 本周菜单 | 在家人数 | 菜单 |
| --- | --- | --- |
| 周日 | 2 | 卤鸡腿 → 鸡腿，鸡蛋，葱，姜，蒜 |
| 周一 | 2 | 日式咖喱 → 鸡肉、土豆、胡萝卜、洋葱、咖喱块 |
```

## Project structure

```
.
├── server.js        # Express server — Gemini extraction, SSE log stream
├── agent.js         # Stagehand agent — URL navigation + act() Add clicks
└── public/
    ├── index.html   # Notion-style UI
    ├── style.css    # Notion dark theme
    └── app.js       # Frontend logic (SSE, preview table, status)
```
