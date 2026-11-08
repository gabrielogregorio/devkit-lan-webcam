"""
Who is connected, who streams, who may watch, and the network panel every page shows.

Every page holds one encrypted session (crypto_channel.py). One session at a time is the camera.
A Watch tab makes a random key and asks to watch; the request is identified by SHA-256(ip + key), so the
same key from another machine is another request and every tab is its own request. The camera session
approves or denies each request; frames reach approved requests only, and the key never leaves the
server. Approvals belong to the current camera: when it stops, every request goes back to pending.
"""
import asyncio
import hashlib
import json
import re
import subprocess
from dataclasses import dataclass, field

from aiohttp import web

from crypto_channel import KIND_FRAME, MessageCipher

# 128 bits or more, as lowercase hex: what crypto.getRandomValues gives on the Watch page.
VIEWER_KEY = re.compile(r"^[0-9a-f]{32,128}$")
CODE_LENGTH = 8
# Bounds the memory a flood of requests from the network can take.
MAX_REQUESTS = 32
DEVICE_MAX_LENGTH = 160

PENDING = "pending"
APPROVED = "approved"
DENIED = "denied"
DECISIONS: dict[str, str] = {"approve": APPROVED, "deny": DENIED, "revoke": DENIED}


def request_id(ip: str, key: str) -> str:
    return hashlib.sha256(f"{ip}|{key}".encode()).hexdigest()


def parse_json_object(text: str | bytes) -> dict[str, object] | None:
    try:
        message = json.loads(text)
    except ValueError:
        return None
    return message if isinstance(message, dict) else None


def parse_viewer_key(message: dict[str, object]) -> str | None:
    """{"type": "request", "key": "<hex>"} from a Watch tab."""
    key = message.get("key")
    if message.get("type") != "request" or not isinstance(key, str) or not VIEWER_KEY.fullmatch(key):
        return None
    return key


def parse_decision(message: dict[str, object]) -> tuple[str, str] | None:
    """{"type": "decide", "id": "<request id>", "decision": "approve"|"deny"|"revoke"} from the camera."""
    target = message.get("id")
    decision = message.get("decision")
    if message.get("type") != "decide" or not isinstance(target, str) or not isinstance(decision, str):
        return None
    state = DECISIONS.get(decision)
    return (target, state) if state else None


@dataclass(eq=False)
class Session:
    """One open page: its socket, its keys and where it comes from."""

    websocket: web.WebSocketResponse
    cipher: MessageCipher
    device_id: str
    ip: str
    device: str
    ffmpeg: subprocess.Popen[bytes] | None = None

    async def send_json(self, payload: dict[str, object]) -> None:
        if self.websocket.closed:
            return
        try:
            await self.websocket.send_bytes(self.cipher.encrypt_json(payload))
        except (ConnectionError, RuntimeError):
            pass

    async def send_frame(self, jpeg_frame: bytes) -> None:
        if self.websocket.closed:
            return
        try:
            await self.websocket.send_bytes(self.cipher.encrypt(KIND_FRAME, jpeg_frame))
        except (ConnectionError, RuntimeError):
            pass


@dataclass
class AccessRequest:
    id: str
    ip: str
    device: str
    state: str = PENDING
    sessions: set[Session] = field(default_factory=set)

    @property
    def code(self) -> str:
        return self.id[:CODE_LENGTH]

    def summary(self) -> dict[str, object]:
        return {
            "id": self.id,
            "code": self.code,
            "ip": self.ip,
            "device": self.device,
            "state": self.state,
            "connected": bool(self.sessions),
        }


@dataclass
class NetworkInfo:
    """What the panel needs that does not change per session: this PC and the router.

    Never the pairing code: every paired page shows the panel, and a code on a screen (or a shared screen in a
    call) would let anyone nearby pair. The code lives only in the top bar icon and in ./run.sh code.
    """

    server_ip: str
    router_ip: str | None


@dataclass
class Broadcast:
    camera: Session | None = None
    # Every open page, with the watch request it made (None until it asks).
    sessions: dict[Session, str | None] = field(default_factory=dict)
    requests: dict[str, AccessRequest] = field(default_factory=dict)
    # A viewer still receiving the previous frame skips this one: a slow viewer never holds the camera back.
    busy_viewers: set[Session] = field(default_factory=set)
    send_tasks: set[asyncio.Task[None]] = field(default_factory=set)

    def request_of(self, session: Session) -> AccessRequest | None:
        return self.requests.get(self.sessions.get(session) or "")

    def viewer_status(self, session: Session) -> dict[str, object]:
        access_request = self.request_of(session)
        return {
            "type": "status",
            "camera": self.camera is not None,
            "streaming": self.camera is session,
            "access": access_request.state if access_request else "none",
            "code": access_request.code if access_request else None,
        }

    def requests_status(self) -> dict[str, object]:
        return {"type": "requests", "requests": [item.summary() for item in self.requests.values()]}

    def network_status(self, session: Session, info: NetworkInfo) -> dict[str, object]:
        camera = self.camera
        peers = []
        for other in self.sessions:
            access_request = self.request_of(other)
            peers.append(
                {
                    "ip": other.ip,
                    "device": other.device,
                    "role": self._role(other, access_request),
                    "you": other is session,
                }
            )
        return {
            "type": "network",
            "you": session.ip,
            "server": info.server_ip,
            "router": info.router_ip,
            "camera": {"ip": camera.ip, "device": camera.device} if camera else None,
            "peers": peers,
        }

    def _role(self, session: Session, access_request: AccessRequest | None) -> str:
        if session is self.camera:
            return "camera"
        if access_request is None:
            return "idle"
        if access_request.state == APPROVED:
            return "watching"

        return access_request.state

    def join(self, session: Session) -> None:
        self.sessions[session] = None

    def ask(self, session: Session, key: str) -> bool:
        """Links the session to the request of (ip, key), creating it as pending. False when the list is full."""
        identifier = request_id(session.ip, key)
        if self.sessions.get(session) == identifier:
            return True
        access_request = self.requests.get(identifier)
        if access_request is None:
            if len(self.requests) >= MAX_REQUESTS:
                return False
            access_request = AccessRequest(identifier, session.ip, session.device[:DEVICE_MAX_LENGTH])
            self.requests[identifier] = access_request
        self._unlink(session)
        access_request.sessions.add(session)
        self.sessions[session] = identifier
        return True

    def decide(self, identifier: str, state: str) -> bool:
        access_request = self.requests.get(identifier)
        if access_request is None:
            return False
        access_request.state = state
        return True

    def leave(self, session: Session) -> None:
        self._unlink(session)
        self.sessions.pop(session, None)
        self.busy_viewers.discard(session)
        if self.camera is session:
            self.camera_left()

    def camera_left(self) -> None:
        self.camera = None
        for access_request in self.requests.values():
            access_request.state = PENDING

    def approved_viewers(self) -> list[Session]:
        return [
            session
            for session, identifier in self.sessions.items()
            if identifier is not None and self.requests[identifier].state == APPROVED
        ]

    def _unlink(self, session: Session) -> None:
        """Drops the session from its request; a request nobody holds is forgotten unless it was approved."""
        access_request = self.request_of(session)
        if access_request is None:
            return
        access_request.sessions.discard(session)
        if not access_request.sessions and access_request.state != APPROVED:
            del self.requests[access_request.id]


async def announce(broadcast: Broadcast, info: NetworkInfo) -> None:
    """Tells every page its own state and the network; the camera also gets the list of requests."""
    for session in list(broadcast.sessions):
        await session.send_json(broadcast.viewer_status(session))
        await session.send_json(broadcast.network_status(session, info))
    if broadcast.camera is not None:
        await broadcast.camera.send_json(broadcast.requests_status())


async def send_frame_to_viewer(broadcast: Broadcast, viewer: Session, jpeg_frame: bytes) -> None:
    try:
        await viewer.send_frame(jpeg_frame)
    finally:
        broadcast.busy_viewers.discard(viewer)


def relay_frame(broadcast: Broadcast, jpeg_frame: bytes) -> None:
    for viewer in broadcast.approved_viewers():
        if viewer in broadcast.busy_viewers or viewer.websocket.closed:
            continue
        broadcast.busy_viewers.add(viewer)
        task = asyncio.create_task(send_frame_to_viewer(broadcast, viewer, jpeg_frame))
        broadcast.send_tasks.add(task)
        task.add_done_callback(broadcast.send_tasks.discard)


def router_ip(route_table: str | None = None) -> str | None:
    """The default gateway from /proc/net/route (little-endian hex), or None when there is none."""
    if route_table is None:
        try:
            with open("/proc/net/route") as handle:
                route_table = handle.read()
        except OSError:
            return None
    for line in route_table.splitlines()[1:]:
        fields = line.split()
        if len(fields) > 2 and fields[1] == "00000000" and fields[2] != "00000000":
            gateway = bytes.fromhex(fields[2])[::-1]
            return ".".join(str(octet) for octet in gateway)
    return None
