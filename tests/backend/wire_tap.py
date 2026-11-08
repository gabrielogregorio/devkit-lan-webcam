"""An eavesdropper in the middle: a TCP relay that records every byte, reads the WebSockets inside and can tamper.

It sees what anyone on the LAN sees on plain HTTP (port 9080): the raw TCP stream. It undoes what is not
secret on the wire (the client's XOR mask and the permessage-deflate compression), so the tests check the
payloads exactly as the encryption left them.
"""
import asyncio
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field

import aiohttp

HEADER_END = b"\r\n\r\n"
SWITCHING_PROTOCOLS = b" 101 "
DEFLATE_TAIL = b"\x00\x00\xff\xff"
OPCODE_TEXT = 0x1
OPCODE_BINARY = 0x2
FIN_BIT = 0x80
RSV1_BIT = 0x40
MASK_BIT = 0x80
LENGTH_16_BITS = 126
LENGTH_64_BITS = 127
MASK_BYTES = 4
CHUNK_BYTES = 65536

CLIENT_TO_SERVER = "client->server"
SERVER_TO_CLIENT = "server->client"

# Gets each chunk read from one side before it is passed on; returns what is really sent.
Tamper = Callable[[str, bytes], bytes]


@dataclass
class WebSocketMessage:
    direction: str
    opcode: int
    payload: bytes


@dataclass
class Connection:
    client_to_server: bytearray = field(default_factory=bytearray)
    server_to_client: bytearray = field(default_factory=bytearray)

    @property
    def is_websocket(self) -> bool:
        return SWITCHING_PROTOCOLS in self.server_to_client.split(b"\r\n", 1)[0]

    def messages(self) -> list[WebSocketMessage]:
        """Every WebSocket message after the upgrade, unmasked and decompressed, in each direction."""
        if not self.is_websocket:
            return []
        return [
            *parse_websocket(CLIENT_TO_SERVER, bytes(self.client_to_server)),
            *parse_websocket(SERVER_TO_CLIENT, bytes(self.server_to_client)),
        ]


def parse_websocket(direction: str, stream: bytes) -> list[WebSocketMessage]:
    data = stream[stream.index(HEADER_END) + len(HEADER_END):]
    inflater = zlib.decompressobj(-zlib.MAX_WBITS)
    messages: list[WebSocketMessage] = []
    offset = 0
    while offset + 2 <= len(data):
        first, second = data[offset], data[offset + 1]
        offset += 2
        length = second & 0x7F
        if length == LENGTH_16_BITS:
            length = int.from_bytes(data[offset:offset + 2], "big")
            offset += 2
        elif length == LENGTH_64_BITS:
            length = int.from_bytes(data[offset:offset + 8], "big")
            offset += 8
        mask = b""
        if second & MASK_BIT:
            mask = data[offset:offset + MASK_BYTES]
            offset += MASK_BYTES
        payload = data[offset:offset + length]
        offset += length
        if len(payload) < length:
            break  # cut off by the end of the capture
        if mask:
            payload = bytes(byte ^ mask[index % MASK_BYTES] for index, byte in enumerate(payload))
        if first & RSV1_BIT:
            # Compression is not secrecy: the server's shared deflate context opens it for anyone.
            payload = inflater.decompress(payload + DEFLATE_TAIL)
        opcode = first & 0x0F
        if opcode in (OPCODE_TEXT, OPCODE_BINARY) and first & FIN_BIT:
            messages.append(WebSocketMessage(direction, opcode, payload))
    return messages


class WireTap:
    """Listens on 127.0.0.1 and relays every connection to the real server, recording both directions."""

    def __init__(self, target_port: int, tamper: Tamper | None = None) -> None:
        self.target_port = target_port
        self.tamper = tamper
        self.connections: list[Connection] = []
        self._server: asyncio.Server | None = None

    @property
    def port(self) -> int:
        assert self._server is not None
        return self._server.sockets[0].getsockname()[1]

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._relay, "127.0.0.1", 0)

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    def messages(self) -> list[WebSocketMessage]:
        return [message for connection in self.connections for message in connection.messages()]

    def all_bytes(self) -> bytes:
        """Everything that crossed the wire, raw and also unmasked and decompressed."""
        raw = b"".join(bytes(c.client_to_server) + bytes(c.server_to_client) for c in self.connections)
        return raw + b"".join(message.payload for message in self.messages())

    async def _relay(self, client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
        connection = Connection()
        self.connections.append(connection)
        server_reader, server_writer = await asyncio.open_connection("127.0.0.1", self.target_port)
        await asyncio.gather(
            self._pipe(CLIENT_TO_SERVER, client_reader, server_writer, connection.client_to_server),
            self._pipe(SERVER_TO_CLIENT, server_reader, client_writer, connection.server_to_client),
        )

    async def _pipe(
        self, direction: str, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, record: bytearray
    ) -> None:
        try:
            while chunk := await reader.read(CHUNK_BYTES):
                if self.tamper is not None:
                    chunk = self.tamper(direction, chunk)
                record.extend(chunk)
                writer.write(chunk)
                await writer.drain()
        except ConnectionError:
            pass
        finally:
            writer.close()


class TappedClient:
    """Looks like aiohttp's TestClient to secure_client.py, but every socket goes through the tap."""

    def __init__(self, tap: WireTap, compress: int) -> None:
        self._tap = tap
        self._compress = compress
        self._session = aiohttp.ClientSession()

    async def ws_connect(self, path: str) -> aiohttp.ClientWebSocketResponse:
        # compress=15 asks for permessage-deflate, like a browser does.
        return await self._session.ws_connect(f"http://127.0.0.1:{self._tap.port}{path}", compress=self._compress)

    async def close(self) -> None:
        await self._session.close()
