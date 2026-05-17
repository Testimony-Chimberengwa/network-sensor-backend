import asyncio
import time
import socket
from datetime import datetime, timezone
from contextlib import asynccontextmanager

import psutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from typing import Optional, List, Dict

MAX_DNS_CACHE_SIZE = 500
dns_cache: dict = {}
last_net_io: Optional[Dict] = None
last_net_time: Optional[float] = None


def get_network_io_delta() -> Dict:
    global last_net_io, last_net_time

    current_total = psutil.net_io_counters()
    current_per_nic = psutil.net_io_counters(pernic=True)
    current_time = time.time()

    nic_data = {}
    bytes_sent_delta = 0
    bytes_recv_delta = 0

    if last_net_io is not None and last_net_time is not None:
        time_delta = current_time - last_net_time
        if time_delta > 0:
            for nic, io in current_per_nic.items():
                last_io = last_net_io.get(nic)
                if last_io:
                    nic_data[nic] = {
                        "bytes_sent_per_sec": round((io.bytes_sent - last_io.bytes_sent) / time_delta, 2),
                        "bytes_recv_per_sec": round((io.bytes_recv - last_io.bytes_recv) / time_delta, 2),
                        "packets_sent_per_sec": round((io.packets_sent - last_io.packets_sent) / time_delta, 2),
                        "packets_recv_per_sec": round((io.packets_recv - last_io.packets_recv) / time_delta, 2),
                    }
                else:
                    nic_data[nic] = {
                        "bytes_sent_per_sec": 0,
                        "bytes_recv_per_sec": 0,
                        "packets_sent_per_sec": 0,
                        "packets_recv_per_sec": 0,
                    }

            bytes_sent_delta = current_total.bytes_sent - last_net_io.get("_total_bytes_sent", 0)
            bytes_recv_delta = current_total.bytes_recv - last_net_io.get("_total_bytes_recv", 0)

    last_net_io = {
        **current_per_nic,
        "_total_bytes_sent": current_total.bytes_sent,
        "_total_bytes_recv": current_total.bytes_recv,
    }
    last_net_time = current_time

    elapsed = current_time - last_net_time if last_net_time else 1
    return {
        "total_bytes_sent_per_sec": round(bytes_sent_delta / elapsed, 2) if elapsed > 0 else 0,
        "total_bytes_recv_per_sec": round(bytes_recv_delta / elapsed, 2) if elapsed > 0 else 0,
        "per_nic": nic_data,
    }


def _update_dns_cache(ip: str, hostname: str, current_time: float) -> None:
    if len(dns_cache) >= MAX_DNS_CACHE_SIZE:
        oldest_key = min(dns_cache, key=lambda k: dns_cache[k][1])
        del dns_cache[oldest_key]
    dns_cache[ip] = (hostname, current_time)


def resolve_hostname(ip: str) -> str:
    current_time = time.time()
    if ip in dns_cache:
        cached_hostname, cached_time = dns_cache[ip]
        if current_time - cached_time < 300:
            return cached_hostname

    try:
        hostname, _, _ = socket.gethostbyaddr(ip)
    except (socket.herror, socket.gaierror, OSError):
        hostname = ip

    _update_dns_cache(ip, hostname, current_time)
    return hostname


def get_process_info(pid) -> Dict:
    if pid is None:
        return {"name": "Unknown", "access_denied": False}
    try:
        proc = psutil.Process(pid)
        return {"name": proc.name(), "access_denied": False}
    except psutil.AccessDenied:
        return {"name": "Unknown", "access_denied": True}
    except (psutil.NoSuchProcess, psutil.ZombieProcess):
        return {"name": "Unknown", "access_denied": False}


def get_processes() -> List:
    processes = []
    for proc in psutil.process_iter(["name", "pid", "cpu_percent", "memory_percent"]):
        try:
            processes.append({
                "name": proc.info["name"],
                "pid": proc.info["pid"],
                "cpu_percent": proc.info["cpu_percent"] or 0,
                "memory_percent": round(proc.info["memory_percent"] or 0, 2),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return processes


def _build_connection_entry(conn) -> Dict:
    process_info = get_process_info(conn.pid)
    return {
        "local_address": f"{conn.laddr.ip}:{conn.laddr.port}" if conn.laddr else "N/A",
        "remote_address": f"{conn.raddr.ip}:{conn.raddr.port}" if conn.raddr else "N/A",
        "remote_ip": conn.raddr.ip if conn.raddr else "N/A",
        "remote_port": conn.raddr.port if conn.raddr else "N/A",
        "local_port": conn.laddr.port if conn.laddr else "N/A",
        "status": conn.status,
        "protocol": "TCP" if conn.type == 1 else "UDP",
        "pid": conn.pid,
        "process": process_info["name"],
        "hostname": resolve_hostname(conn.raddr.ip) if conn.raddr else "N/A",
        "access_denied": process_info["access_denied"],
    }


def get_open_ports() -> List:
    ports = []
    try:
        for conn in psutil.net_connections(kind="inet"):
            if conn.status:
                entry = _build_connection_entry(conn)
                ports.append({
                    "local_address": entry["local_address"],
                    "remote_address": entry["remote_address"],
                    "status": entry["status"],
                    "protocol": entry["protocol"],
                    "pid": entry["pid"],
                    "process": entry["process"],
                    "access_denied": entry["access_denied"],
                })
    except psutil.AccessDenied:
        pass
    return ports


def get_connections() -> List:
    connections = []
    try:
        for conn in psutil.net_connections(kind="inet"):
            if conn.raddr:
                entry = _build_connection_entry(conn)
                connections.append({
                    "remote_ip": entry["remote_ip"],
                    "remote_port": entry["remote_port"],
                    "local_port": entry["local_port"],
                    "status": entry["status"],
                    "protocol": entry["protocol"],
                    "process": entry["process"],
                    "hostname": entry["hostname"],
                    "access_denied": entry["access_denied"],
                })
    except psutil.AccessDenied:
        pass
    return connections


def get_sites() -> List:
    sites_dict = {}
    try:
        for conn in psutil.net_connections(kind="inet"):
            if conn.raddr:
                ip = conn.raddr.ip
                key = f"{ip}:{conn.raddr.port}"
                if key not in sites_dict:
                    process_info = get_process_info(conn.pid)
                    sites_dict[key] = {
                        "hostname": resolve_hostname(ip),
                        "remote_ip": ip,
                        "local_port": conn.laddr.port if conn.laddr else "N/A",
                        "remote_port": conn.raddr.port,
                        "process": process_info["name"],
                        "access_denied": process_info["access_denied"],
                    }
                else:
                    existing = sites_dict[key]
                    if existing["process"] == "Unknown" and process_info["name"] != "Unknown":
                        existing["process"] = process_info["name"]
                        existing["access_denied"] = process_info["access_denied"]
    except psutil.AccessDenied:
        pass
    return list(sites_dict.values())


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Network Sensor", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/metrics")
async def metrics():
    cpu_percent = await asyncio.to_thread(psutil.cpu_percent, interval=1)
    ram = await asyncio.to_thread(psutil.virtual_memory)
    network_io = get_network_io_delta()
    ports = get_open_ports()
    processes = get_processes()
    sites = get_sites()

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cpu_percent": cpu_percent,
        "ram_percent": ram.percent,
        "network_io": network_io,
        "open_ports": ports,
        "processes": processes,
        "sites": sites,
    }


@app.get("/connections")
async def connections():
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "connections": get_connections(),
    }


@app.get("/sites")
async def sites():
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sites": get_sites(),
    }


@app.websocket("/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            cpu_percent = await asyncio.to_thread(psutil.cpu_percent, interval=1)
            ram = await asyncio.to_thread(psutil.virtual_memory)
            network_io = get_network_io_delta()
            processes = get_processes()
            conns = get_connections()
            sites = get_sites()
            open_ports = get_open_ports()

            payload = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "cpu_percent": cpu_percent,
                "ram_percent": ram.percent,
                "network_io": network_io,
                "processes": processes[:20],
                "connections": conns[:30],
                "open_ports": open_ports[:30],
                "sites": sites,
            }
            print("[WS] Sending:", payload)
            await websocket.send_json(payload)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass
