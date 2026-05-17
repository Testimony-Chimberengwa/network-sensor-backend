# Network Sensor Backend

Real-time system and network monitoring API built with FastAPI. Part of a larger infrastructure monitoring project.

## Features

- **CPU & RAM monitoring** — real-time utilization percentages
- **Network I/O tracking** — per-NIC and aggregate bandwidth deltas
- **Open port detection** — all listening and active ports with process info
- **Active connections** — remote IPs, ports, protocols, and owning processes
- **Remote site resolution** — deduplicated list of connected endpoints with DNS caching
- **WebSocket live stream** — push updates every 2 seconds for real-time dashboards

## Quick Start

```bash
pip install -r requirements.txt
uvicorn sensor:app --host 0.0.0.0 --port 8001
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/metrics` | GET | Full system snapshot (CPU, RAM, network I/O, ports, processes, sites) |
| `/connections` | GET | Active network connections with remote details |
| `/sites` | GET | Deduplicated list of remote sites being connected to |
| `/live` | WebSocket | Live data stream pushed every 2 seconds |

## Tech Stack

- **FastAPI** — async web framework
- **Uvicorn** — ASGI server
- **psutil** — system and process utilities

## Architecture

```
sensor.py ── FastAPI app
├── /metrics        → CPU, RAM, net I/O, ports, processes, sites
├── /connections    → active network connections
├── /sites          → unique remote endpoints
└── /live (WS)      → real-time push stream

Data collection functions:
├── get_network_io_delta()  → per-NIC bandwidth deltas
├── get_processes()         → all running processes
├── get_connections()       → active inet connections
├── get_open_ports()        → listening/active ports
├── get_sites()             → deduplicated remote sites
├── resolve_hostname()      → DNS resolution with 5min TTL cache
└── get_process_info()      → PID → process name lookup
```

## Notes

- DNS lookups are cached for 5 minutes (max 500 entries) to avoid repeated resolution overhead
- Blocking `psutil` calls are wrapped with `asyncio.to_thread()` to keep the event loop non-blocking
- CORS is wide-open (`*`) for local development — restrict for production use
