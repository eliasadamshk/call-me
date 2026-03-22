# CallMe

**Minimal plugin that lets Claude Code call you on the phone.**

Start a task, walk away. Your phone/watch rings when Claude is done, stuck, or needs a decision.

<img src="./call-me-comic-min.png" width="800" alt="CallMe comic strip">

- **Minimal plugin** - Does one thing: call you on the phone. No crazy setups.
- **Multi-turn conversations** - Talk through decisions naturally.
- **Works anywhere** - Smartphone, smartwatch, or even landline!
- **Tool-use composable** - Claude can e.g. do a web search while on a call with you.

---

## Quick Start

### 1. Get Required Accounts

You'll need:
- **Phone provider**: [Telnyx](https://telnyx.com) or [Twilio](https://twilio.com)
- **OpenAI API key**: For speech-to-text and text-to-speech
- **ngrok account**: Free at [ngrok.com](https://ngrok.com) (for webhook tunneling)

### 2. Set Up Phone Provider

Choose **one** of the following:

<details>
<summary><b>Option A: Telnyx (Recommended - 50% cheaper)</b></summary>

1. Create account at [portal.telnyx.com](https://portal.telnyx.com) and verify your identity
2. [Buy a phone number](https://portal.telnyx.com/#/numbers/buy-numbers) (~$1/month)
3. [Create a Voice API application](https://portal.telnyx.com/#/call-control/applications):
   - Set webhook URL to `https://your-ngrok-url/twiml` and API version to v2
     - You can see your ngrok URL on the ngrok dashboard
   - Note your **Application ID** and **API Key**
4. [Verify the phone number](https://portal.telnyx.com/#/numbers/verified-numbers) you want to receive calls at
5. (Optional but recommended) Get your **Public Key** from Account Settings > Keys & Credentials for webhook signature verification

**Environment variables for Telnyx:**
```bash
CALLME_PHONE_PROVIDER=telnyx
CALLME_PHONE_ACCOUNT_SID=<Application ID>
CALLME_PHONE_AUTH_TOKEN=<API Key>
CALLME_TELNYX_PUBLIC_KEY=<Public Key>  # Optional: enables webhook security
```

</details>

<details>
<summary><b>Option B: Twilio (Not recommended - need to buy $20 of credits just to start and more expensive overall)</b></summary>

1. Create account at [twilio.com/console](https://www.twilio.com/console)
2. Use the free number your account comes with or [buy a new phone number](https://www.twilio.com/console/phone-numbers/incoming) (~$1.15/month)
3. Find your **Account SID** and **Auth Token** on the [Console Dashboard](https://www.twilio.com/console)

**Environment variables for Twilio:**
```bash
CALLME_PHONE_PROVIDER=twilio
CALLME_PHONE_ACCOUNT_SID=<Account SID>
CALLME_PHONE_AUTH_TOKEN=<Auth Token>
```

</details>

### 3. Set Environment Variables

Add these to `~/.claude/settings.json` (recommended) or export them in your shell:

```json
{
  "env": {
    "CALLME_PHONE_PROVIDER": "telnyx",
    "CALLME_PHONE_ACCOUNT_SID": "your-connection-id-or-account-sid",
    "CALLME_PHONE_AUTH_TOKEN": "your-api-key-or-auth-token",
    "CALLME_PHONE_NUMBER": "+15551234567",
    "CALLME_USER_PHONE_NUMBER": "+15559876543",
    "CALLME_OPENAI_API_KEY": "sk-...",
    "CALLME_NGROK_AUTHTOKEN": "your-ngrok-token"
  }
}
```

#### Required Variables

| Variable | Description |
|----------|-------------|
| `CALLME_PHONE_PROVIDER` | `telnyx` (default) or `twilio` |
| `CALLME_PHONE_ACCOUNT_SID` | Telnyx Connection ID or Twilio Account SID |
| `CALLME_PHONE_AUTH_TOKEN` | Telnyx API Key or Twilio Auth Token |
| `CALLME_PHONE_NUMBER` | Phone number Claude calls from (E.164 format) |
| `CALLME_USER_PHONE_NUMBER` | Your phone number to receive calls |
| `CALLME_OPENAI_API_KEY` | OpenAI API key (for TTS and realtime STT) |
| `CALLME_NGROK_AUTHTOKEN` | ngrok auth token for webhook tunneling. Required unless `CALLME_PUBLIC_URL` is set |

#### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLME_TTS_VOICE` | `onyx` | OpenAI voice: alloy, echo, fable, onyx, nova, shimmer |
| `CALLME_PORT` | `3333` | Local HTTP server port |
| `CALLME_PUBLIC_URL` | - | Public base URL for a hosted deployment. When set, CallMe skips ngrok |
| `CALLME_MCP_TRANSPORT` | `stdio` | MCP transport: `stdio`, `streamable-http`, or `both` |
| `CALLME_MCP_HTTP_PATH` | `/mcp` | Streamable HTTP endpoint path when using `streamable-http` or `both` |
| `CALLME_API_AUTH_TOKEN` | - | Optional shared API token for MCP HTTP requests |
| `CALLME_NGROK_DOMAIN` | - | Custom ngrok domain (paid feature) |
| `CALLME_TRANSCRIPT_TIMEOUT_MS` | `180000` | Timeout for user speech (3 minutes) |
| `CALLME_STT_SILENCE_DURATION_MS` | `800` | Silence duration to detect end of speech |
| `CALLME_TELNYX_PUBLIC_KEY` | - | Telnyx public key for webhook signature verification (recommended) |

### 4. Install Plugin

```bash
/plugin marketplace add ZeframLou/call-me
/plugin install callme@callme
```

Restart Claude Code. Done!

---

## How It Works

```
Claude Code                    CallMe MCP Server (local)
    │                                    │
    │  "I finished the feature..."       │
    ▼                                    ▼
Plugin ────stdio──────────────────► MCP Server
                                         │
                                         ├─► ngrok tunnel
                                         │
                                         ▼
                                   Phone Provider (Telnyx/Twilio)
                                         │
                                         ▼
                                   Your Phone rings
                                   You speak
                                   Text returns to Claude
```

The MCP server runs locally and automatically creates an ngrok tunnel for phone provider webhooks.

If you set `CALLME_PUBLIC_URL`, the server uses that URL instead and does not start ngrok. This is the intended mode for hosting behind your own web server or reverse proxy.

If you set `CALLME_API_AUTH_TOKEN`, clients must send `Authorization: Bearer <token>` when calling the MCP HTTP endpoint. Phone provider webhooks and media-stream connections continue to use their existing signature/token checks.

## Streamable HTTP Transport

By default CallMe exposes MCP over `stdio`, which is what Claude Code expects for local plugins. You can also expose MCP over Streamable HTTP for a hosted deployment:

```bash
CALLME_MCP_TRANSPORT=streamable-http \
CALLME_PUBLIC_URL=https://callme.example.com \
bun run src/index.ts
```

This starts the normal webhook server plus `POST/GET/DELETE /mcp` for MCP over Streamable HTTP.

Use `CALLME_MCP_TRANSPORT=both` if you want to keep the local `stdio` transport while also exposing Streamable HTTP.

### Twilio + Streamable HTTP + ngrok Script

If you want a single local launcher for Twilio with Streamable HTTP exposed over ngrok:

1. Fill in `.env.example` or edit the local gitignored `.env`
2. Run:

```bash
./run-twilio-streamable-http-ngrok.sh
```

That script forces the Twilio provider, loads your `.env`, starts ngrok, and exposes:

- Twilio voice webhook at `<ngrok-url>/twiml`
- MCP endpoint at `<ngrok-url>/mcp`

If you keep `CALLME_MCP_TRANSPORT=both`, stdio remains available alongside Streamable HTTP.

---

## Docker

- Local/build stack: `docker-compose.yml`
- Production/GHCR stack: `docker-compose.prod.yml`
- Environment template: `.env.example`

### Local image build

1. Create an env file:

```bash
cp .env.example .env
```

2. Fill in the required secrets and runtime values in `.env`
3. Start the container:

```bash
docker compose up --build
```

This builds the local image from `Dockerfile` and exposes the app on `CALLME_PORT` (default `3333`).

### Production

`docker-compose.prod.yml` pulls the prebuilt GHCR image by default:

- `ghcr.io/<owner>/call-me:latest`

Deploy with:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Required production runtime values:

- `CALLME_PUBLIC_URL`
- `CALLME_PHONE_PROVIDER`
- `CALLME_PHONE_ACCOUNT_SID`
- `CALLME_PHONE_AUTH_TOKEN`
- `CALLME_PHONE_NUMBER`
- `CALLME_USER_PHONE_NUMBER`
- `CALLME_OPENAI_API_KEY`

If you are not setting `CALLME_PUBLIC_URL`, you also need `CALLME_NGROK_AUTHTOKEN`.

Set `CALLME_IMAGE` only if you want to pin a specific SHA tag instead of `latest`.

## CI/CD

- `.github/workflows/deploy.yml` publishes a Docker image to GHCR on pushes to `main`
- Tags published: `latest` and the commit SHA


---

## Tools

### `initiate_call`
Start a phone call.

```typescript
const { callId, response } = await initiate_call({
  message: "Hey! I finished the auth system. What should I work on next?"
});
```

### `continue_call`
Continue with follow-up questions.

```typescript
const response = await continue_call({
  call_id: callId,
  message: "Got it. Should I add rate limiting too?"
});
```

### `speak_to_user`
Speak to the user without waiting for a response. Useful for acknowledging requests before time-consuming operations.

```typescript
await speak_to_user({
  call_id: callId,
  message: "Let me search for that information. Give me a moment..."
});
// Continue with your long-running task
const results = await performSearch();
// Then continue the conversation
const response = await continue_call({
  call_id: callId,
  message: `I found ${results.length} results...`
});
```

### `end_call`
End the call.

```typescript
await end_call({
  call_id: callId,
  message: "Perfect, I'll get started. Talk soon!"
});
```

---

## Costs

| Service | Telnyx | Twilio |
|---------|--------|--------|
| Outbound calls | ~$0.007/min | ~$0.014/min |
| Phone number | ~$1/month | ~$1.15/month |

Plus OpenAI costs (same for both providers):
- **Speech-to-text**: ~$0.006/min (Whisper)
- **Text-to-speech**: ~$0.02/min (TTS)

**Total**: ~$0.03-0.04/minute of conversation

---

## Troubleshooting

### Claude doesn't use the tool
1. Check all required environment variables are set (ideally in `~/.claude/settings.json`)
2. Restart Claude Code after installing the plugin
3. Try explicitly: "Call me to discuss the next steps when you're done."

### Call doesn't connect
1. Check the MCP server logs (stderr) with `claude --debug`
2. Verify your phone provider credentials are correct
3. Make sure ngrok can create a tunnel

### Audio issues
1. Ensure your phone number is verified with your provider
2. Check that the webhook URL in your provider dashboard matches your ngrok URL

### ngrok errors
1. Verify your `CALLME_NGROK_AUTHTOKEN` is correct
2. Check if you've hit ngrok's free tier limits
3. Try a different port with `CALLME_PORT=3334`

---

## Development

```bash
cd server
bun install
bun run dev
```

---

## License

MIT
