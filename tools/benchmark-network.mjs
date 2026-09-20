// Fixed delayed-ACK receiver: measures the bridge independently of an internet
// radio server's pacing and the simulated CPU. --baseline uses the git HEAD bridge.
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { EthernetNatSession as CurrentSession } from '../network-bridge.mjs';
import { buildIpv4Frame, buildTcpPacket, parseIpv4Frame, parseTcpPacket, GATEWAY_MAC } from '../network-packets.mjs';
let Session = CurrentSession;
if (process.argv.includes('--baseline')) {
  const source = execFileSync('git', ['show', 'HEAD:network-bridge.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
    .replaceAll('"./logging.mjs"', JSON.stringify(new URL('../logging.mjs', import.meta.url).href))
    .replaceAll('"./network-packets.mjs"', JSON.stringify(new URL('../network-packets.mjs', import.meta.url).href));
  Session = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).EthernetNatSession;
}
const sourceIp = Uint8Array.of(192,168,4,2), destinationIp = Uint8Array.of(93,184,216,34);
const sourceMac = Uint8Array.of(2,3,4,5,6,7);
class Socket extends EventEmitter { setNoDelay() {} setTimeout() {} pause() {} resume() {} destroy() {} }
const socket = new Socket();
let received = 0, acknowledgment = 9001, timer, resolve;
const complete = new Promise(yes => resolve = yes);
const total = 128 * 1024;
function guest(flags, ack = 0) {
  return buildIpv4Frame({ sourceMac, destinationMac: GATEWAY_MAC, sourceIp, destinationIp, protocol: 6,
    payload: buildTcpPacket({ sourceIp, destinationIp, sourcePort: 50000, destinationPort: 80,
      sequence: flags === 2 ? 1000 : 1001, acknowledgment: ack, flags, window: 10400 }) });
}
const session = new Session({ randomUint32: () => 9000, createTcpConnection: () => socket,
  sendFrame(frame) {
    const tcp = parseTcpPacket(parseIpv4Frame(frame).payload);
    if (!tcp.payload.length) return;
    received += tcp.payload.length;
    acknowledgment = tcp.sequence + tcp.payload.length;
    if (!timer) timer = setTimeout(() => {
      timer = null;
      session.receive(guest(16, acknowledgment));
      if (received >= total) resolve();
    }, 40);
  } });
session.receive(guest(2)); socket.emit('connect'); session.receive(guest(16, 9001));
const start = performance.now();
socket.emit('data', Buffer.alloc(total, 42));
await complete;
const elapsedMs = performance.now() - start;
session.close(); clearTimeout(timer);
console.log(JSON.stringify({ bytes: received, ackDelayMs: 40, elapsedMs, KiBPerSecond: received / 1024 / (elapsedMs / 1000) }, null, 2));
