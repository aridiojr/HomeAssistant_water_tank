#!/usr/bin/env python3
"""Registra (ou atualiza) um recurso do Lovelace no Home Assistant.

O registro de recursos só existe na WebSocket API do HA — não há endpoint REST
para isso. Este script fala WebSocket usando apenas a biblioteca padrão do
Python 3, então roda em qualquer Mac/Linux sem instalar nada.

Uso:
    export HA_TOKEN='...'          # token de acesso de longa duração
    python3 scripts/register-resource.py --host 192.168.1.50
    python3 scripts/register-resource.py --host 192.168.1.50 --bump
    python3 scripts/register-resource.py --host ha.exemplo.com --ssl --list

O token é lido de HA_TOKEN (ou --token-file). Crie o seu em:
    perfil do usuário → Segurança → Tokens de acesso de longa duração
Nunca cole esse token em chat: ele dá acesso total à sua instância.
"""

import argparse
import base64
import hashlib
import json
import os
import socket
import ssl as ssl_mod
import struct
import sys

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
DEFAULT_RESOURCES = ["/local/screensaver-card.js", "/local/caixa-dagua-card.js"]


class WSError(RuntimeError):
    pass


class WebSocket:
    """Cliente WebSocket mínimo: handshake, frames mascarados, texto/ping."""

    def __init__(self, host, port, path="/api/websocket", use_ssl=False, timeout=15):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        if use_ssl:
            ctx = ssl_mod.create_default_context()
            self.sock = ctx.wrap_socket(self.sock, server_hostname=host)
        self.buf = b""
        self._handshake(host, port, path)

    def _handshake(self, host, port, path):
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self.sock.sendall(request.encode())

        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WSError("conexão fechada durante o handshake")
            self.buf += chunk
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        if "101" not in lines[0]:
            raise WSError(f"handshake recusado pelo servidor: {lines[0]}")

        headers = {}
        for line in lines[1:]:
            if ":" in line:
                name, _, value = line.partition(":")
                headers[name.strip().lower()] = value.strip()
        expected = base64.b64encode(
            hashlib.sha1((key + WS_GUID).encode()).digest()
        ).decode()
        if headers.get("sec-websocket-accept") != expected:
            raise WSError("Sec-WebSocket-Accept inválido (proxy no caminho?)")

    # ---- frames -------------------------------------------------------
    def _recv_exactly(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise WSError("conexão fechada pelo servidor")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _read_frame(self):
        b1, b2 = self._recv_exactly(2)
        fin = b1 & 0x80
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        length = b2 & 0x7F
        if length == 126:
            (length,) = struct.unpack(">H", self._recv_exactly(2))
        elif length == 127:
            (length,) = struct.unpack(">Q", self._recv_exactly(8))
        mask = self._recv_exactly(4) if masked else None
        payload = self._recv_exactly(length) if length else b""
        if mask:
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        return fin, opcode, payload

    def _send_frame(self, opcode, payload=b""):
        mask = os.urandom(4)
        masked = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(header + mask + masked)

    def send_json(self, obj):
        self._send_frame(0x1, json.dumps(obj).encode())

    def recv_json(self):
        """Devolve a próxima mensagem de texto, tratando ping e fragmentos."""
        parts = []
        while True:
            fin, opcode, payload = self._read_frame()
            if opcode == 0x9:  # ping
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:  # pong
                continue
            if opcode == 0x8:  # close
                raise WSError("servidor encerrou a conexão")
            if opcode in (0x1, 0x0):
                parts.append(payload)
                if fin:
                    return json.loads(b"".join(parts).decode())
                continue
            raise WSError(f"opcode inesperado: {opcode}")

    def close(self):
        try:
            self._send_frame(0x8)
        except OSError:
            pass
        self.sock.close()


class HAClient:
    def __init__(self, ws, token):
        self.ws = ws
        self._id = 0
        hello = ws.recv_json()
        if hello.get("type") != "auth_required":
            raise WSError(f"resposta inesperada do HA: {hello}")
        ws.send_json({"type": "auth", "access_token": token})
        result = ws.recv_json()
        if result.get("type") != "auth_ok":
            raise WSError(
                "autenticação falhou — verifique o token "
                f"({result.get('message', result)})"
            )
        self.version = result.get("ha_version", "?")

    def command(self, payload):
        self._id += 1
        message = dict(payload)
        message["id"] = self._id
        self.ws.send_json(message)
        while True:
            reply = self.ws.recv_json()
            if reply.get("id") != self._id or reply.get("type") != "result":
                continue  # eventos/mensagens de outros ids
            if not reply.get("success", False):
                error = reply.get("error", {})
                raise WSError(
                    f"{payload['type']} falhou: "
                    f"{error.get('code', '?')} {error.get('message', '')}"
                )
            return reply.get("result")

    def resources(self):
        return self.command({"type": "lovelace/resources"}) or []


def base_url(url):
    return url.split("?", 1)[0]


def next_version(url):
    query = url.split("?", 1)[1] if "?" in url else ""
    current = 0
    for part in query.split("&"):
        if part.startswith("v="):
            try:
                current = int(part[2:])
            except ValueError:
                current = 0
    return f"{base_url(url)}?v={current + 1}"


def main():
    parser = argparse.ArgumentParser(
        description="Registra recursos do Lovelace via WebSocket API do HA."
    )
    parser.add_argument("--host", required=True, help="host/IP do Home Assistant")
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument("--ssl", action="store_true", help="usar wss:// (HTTPS)")
    parser.add_argument(
        "--resource",
        action="append",
        dest="resources",
        metavar="URL",
        help=f"recurso a registrar (padrão: {' '.join(DEFAULT_RESOURCES)})",
    )
    parser.add_argument(
        "--bump",
        action="store_true",
        help="se o recurso já existe, incrementa o ?v= para furar o cache",
    )
    parser.add_argument("--list", action="store_true", help="só listar os recursos")
    parser.add_argument(
        "--token-file", help="arquivo com o token (alternativa a HA_TOKEN)"
    )
    args = parser.parse_args()

    token = os.environ.get("HA_TOKEN", "").strip()
    if args.token_file:
        with open(os.path.expanduser(args.token_file)) as handle:
            token = handle.read().strip()
    if not token:
        print(
            "erro: defina HA_TOKEN (ou --token-file) com um token de acesso de\n"
            "      longa duração do HA: perfil → Segurança → Tokens.",
            file=sys.stderr,
        )
        return 2

    wanted = args.resources or DEFAULT_RESOURCES

    try:
        ws = WebSocket(args.host, args.port, use_ssl=args.ssl)
    except (OSError, WSError) as exc:
        print(f"erro: não foi possível conectar em {args.host}:{args.port} — {exc}",
              file=sys.stderr)
        return 1

    try:
        client = HAClient(ws, token)
        print(f"conectado ao Home Assistant {client.version}")
        existing = client.resources()

        if args.list:
            if not existing:
                print("nenhum recurso registrado")
            for item in existing:
                print(f"  [{item.get('type')}] {item.get('url')}")
            return 0

        by_base = {base_url(item.get("url", "")): item for item in existing}
        for url in wanted:
            found = by_base.get(base_url(url))
            if found is None:
                client.command(
                    {
                        "type": "lovelace/resources/create",
                        "res_type": "module",
                        "url": url,
                    }
                )
                print(f"registrado: {url}")
            elif args.bump:
                updated = next_version(found.get("url", url))
                client.command(
                    {
                        "type": "lovelace/resources/update",
                        "resource_id": found["id"],
                        "res_type": "module",
                        "url": updated,
                    }
                )
                print(f"atualizado: {found.get('url')} -> {updated}")
            else:
                print(f"já existe: {found.get('url')}  (use --bump para furar o cache)")

        print("\nrecarregue o navegador com cache limpo (Cmd+Shift+R).")
        return 0
    except WSError as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 1
    finally:
        ws.close()


if __name__ == "__main__":
    sys.exit(main())
