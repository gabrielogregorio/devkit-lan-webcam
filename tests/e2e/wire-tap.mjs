import net from 'node:net';

/*
 * An eavesdropper between the browser and the plain-HTTP server: a TCP relay that records every byte and
 * reads the WebSocket messages inside (unmasked). It removes the permessage-deflate offer from the upgrade,
 * so the payloads it reads are exactly what the encryption produced; compression would only hide more.
 * The Python twin (tests/backend/wire_tap.py) keeps the compression and inflates it instead.
 */
const HEADER_END = Buffer.from('\r\n\r\n');
const EXTENSIONS_HEADER = /^Sec-WebSocket-Extensions:.*\r\n/gim;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;

// Where the WebSocket starts: after the upgrade request (client) or the 101 answer (server), even when the
// browser first reused the connection for plain HTTP.
const UPGRADE_MARKERS = { 'client->server': 'Sec-WebSocket-Key:', 'server->client': 'HTTP/1.1 101' };

function parseWebSocket(direction, stream) {
  const upgrade = stream.indexOf(UPGRADE_MARKERS[direction]);
  const start = upgrade < 0 ? -1 : stream.indexOf(HEADER_END, upgrade);
  if (start < 0) {
    return [];
  }
  const data = stream.subarray(start + HEADER_END.length);
  const messages = [];
  let offset = 0;
  while (offset + 2 <= data.length) {
    const first = data[offset];
    const second = data[offset + 1];
    offset += 2;
    let length = second & 0x7f;
    if (length === 126) {
      length = data.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      length = Number(data.readBigUInt64BE(offset));
      offset += 8;
    }
    let mask = null;
    if (second & 0x80) {
      mask = data.subarray(offset, offset + 4);
      offset += 4;
    }
    if (offset + length > data.length) {
      break;
    }
    const payload = Buffer.from(data.subarray(offset, offset + length));
    offset += length;
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    const opcode = first & 0x0f;
    if (opcode === OPCODE_TEXT || opcode === OPCODE_BINARY) {
      messages.push({ direction, opcode, payload });
    }
  }

  return messages;
}

export async function startWireTap(targetUrl) {
  const target = new URL(targetUrl);
  const connections = [];
  const sockets = new Set();
  const server = net.createServer((client) => {
    const connection = { clientToServer: [], serverToClient: [] };
    connections.push(connection);
    const upstream = net.connect(Number(target.port), target.hostname);
    sockets.add(client).add(upstream);
    let upgraded = false;
    client.on('data', (chunk) => {
      let data = chunk;
      if (!upgraded && data.includes('Sec-WebSocket-Key:')) {
        data = Buffer.from(chunk.toString('latin1').replace(EXTENSIONS_HEADER, ''), 'latin1');
        upgraded = true;
      }
      connection.clientToServer.push(data);
      upstream.write(data);
    });
    upstream.on('data', (chunk) => {
      connection.serverToClient.push(chunk);
      client.write(chunk);
    });
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  // Same address as the server (the LAN IP), so the page stays a plain-HTTP, non-secure context.
  await new Promise((resolve) => server.listen(0, target.hostname, resolve));

  return {
    url: `http://${target.hostname}:${server.address().port}`,
    bytes: () => Buffer.concat(connections.flatMap((c) => [...c.clientToServer, ...c.serverToClient])),
    messages: () =>
      connections
        .filter((c) => Buffer.concat(c.serverToClient).includes(UPGRADE_MARKERS['server->client']))
        .flatMap((c) => [
          ...parseWebSocket('client->server', Buffer.concat(c.clientToServer)),
          ...parseWebSocket('server->client', Buffer.concat(c.serverToClient)),
        ]),
    close: () =>
      new Promise((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(resolve);
      }),
  };
}

export { OPCODE_BINARY, OPCODE_TEXT };
