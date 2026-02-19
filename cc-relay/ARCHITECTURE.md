# cc-relay Architecture

## Overview

Claude Code Web sandboxes have **no inbound connectivity** — you can't open a port.
But they **can make outbound HTTP**. cc-relay exploits this via a polling bridge.

```
                        INTERNET
                           │
                    ┌──────▼──────┐
                    │  Your Phone  │
                    │  / Browser   │
                    └──────┬──────┘
                           │  GET /proxy/hello
                           │  (waits up to 25s)
                    ┌──────▼──────────────────┐
                    │   Cloudflare Worker      │
                    │  cc-relay.*.workers.dev  │
                    │                          │
                    │  KV store:               │
                    │  • queue: [req1, req2]   │
                    │  • resp:{id}: {...}      │
                    └──────┬──────────────────┘
                           │  (long-poll waits here
                           │   for sandbox response)
          ─ ─ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ─ ─
          SANDBOX BOUNDARY │  outbound only
                    ┌──────▼──────────────────┐
                    │   bridge_loop()          │
                    │   polls every 1s         │
                    │   GET /proxy/_poll       │
                    │   POST /proxy/_respond   │
                    └──────┬──────────────────┘
                           │  localhost
                    ┌──────▼──────────────────┐
                    │   FastAPI server         │
                    │   localhost:8000         │
                    │                          │
                    │   GET  /hello            │
                    │   POST /echo             │
                    │   ...                    │
                    └─────────────────────────┘
```

## Request lifecycle

```
Phone                  Cloudflare Worker           Sandbox bridge        FastAPI
  │                          │                           │                  │
  │  GET /proxy/hello        │                           │                  │
  │─────────────────────────►│                           │                  │
  │                          │  enqueue req {id, GET,    │                  │
  │                          │  /hello}                  │                  │
  │                          │  ┌──────────────┐         │                  │
  │         (waiting…)       │  │ KV: queue [] │         │                  │
  │                          │  └──────────────┘         │                  │
  │                          │                    poll   │                  │
  │                          │◄──────────────────────────│                  │
  │                          │  GET /proxy/_poll         │                  │
  │                          │                           │                  │
  │                          │  { requests: [{id, ...}] }│                  │
  │                          │──────────────────────────►│                  │
  │                          │                           │  GET /hello      │
  │                          │                           │─────────────────►│
  │                          │                           │  {"message":"hi"}│
  │                          │                           │◄─────────────────│
  │                          │                           │                  │
  │                          │◄──────────────────────────│                  │
  │                          │  POST /proxy/_respond     │                  │
  │                          │  {id, status:200, body}   │                  │
  │                          │                           │                  │
  │  {"message": "hi"}       │                           │                  │
  │◄─────────────────────────│                           │                  │
  │  200 OK                  │                           │                  │
```

## File map

```
cc-relay/
├── src/
│   └── index.js          ← Cloudflare Worker (deployed once)
│       ├── GET  /ping                   health check (no auth)
│       ├── *    /proxy/{path}           public-facing proxy endpoint
│       ├── GET  /proxy/_poll            sandbox polls for requests (token required)
│       └── POST /proxy/_respond         sandbox posts responses   (token required)
│
└── sandbox/
    └── server.py         ← runs inside Claude Code Web sandbox
        ├── bridge_loop()   polls relay, forwards to local FastAPI
        └── FastAPI app     your actual endpoints (GET /hello, POST /echo, …)
```

## Timing

```
t=0s    Phone hits /proxy/hello
t=0s    Worker enqueues request, starts 25s timeout
t=1s    Sandbox poll fires (every 1s)
t=1s    Sandbox gets request, forwards to FastAPI
t=1s    FastAPI responds ~instantly
t=1s    Sandbox POSTs response back
t=1s    Worker resolves long-poll → phone gets response
        Total round-trip: ~1-2s
```

## Limitations (current POC)

```
• Queue is global (one request at a time, no per-user isolation)
• No streaming — full response buffered before relay
• Poll interval = 1s adds minimum latency
• Sandbox session must stay alive (no persistence)
• Token is shared (no per-user namespacing yet)
```
