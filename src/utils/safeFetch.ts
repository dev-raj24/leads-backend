import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net4, prefix, "ipv4");
for (const [net6, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net6, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  const family = net.isIP(ip);
  if (family === 0) return true;
  return blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

export class FetchBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export interface SafeGetOptions {
  allowPrivate: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export interface SafeGetResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  finalUrl: string;
  ms: number;
}

const PUBLIC_PORTS = new Set(["", "80", "443"]);

export function assertFetchable(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError("unsupported_protocol");
  if (url.username || url.password) throw new FetchBlockedError("credentials_in_url");
  if (!allowPrivate && !PUBLIC_PORTS.has(url.port)) throw new FetchBlockedError("port_not_allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    if (net.isIP(host) && isPrivateAddress(host)) throw new FetchBlockedError("private_address");
    if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new FetchBlockedError("private_address");
  }
  return url;
}

function request(url: URL, opts: Required<SafeGetOptions>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const lookup = ((hostname: string, options: dns.LookupOptions, cb: (...args: unknown[]) => void) => {
      dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return cb(err);
        const list = addresses as dns.LookupAddress[];
        if (!opts.allowPrivate && list.some((a) => isPrivateAddress(a.address))) return cb(new FetchBlockedError("private_address"));
        if (options.all) return cb(null, list);
        cb(null, list[0].address, list[0].family);
      });
    }) as net.LookupFunction;

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      { method: "GET", lookup, timeout: opts.timeoutMs, headers: { "user-agent": opts.userAgent, accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.5" } },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            req.destroy(new FetchBlockedError("response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new FetchBlockedError("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** GET a user-supplied URL without letting it reach internal networks: every redirect and every resolved address is checked. */
export async function safeGet(rawUrl: string, options: SafeGetOptions): Promise<SafeGetResult> {
  const opts: Required<SafeGetOptions> = {
    timeoutMs: 8000,
    maxBytes: 1_500_000,
    maxRedirects: 4,
    userAgent: "LeadworksSEOBot/1.0 (+site audit requested by the site owner)",
    ...options,
  };
  const started = Date.now();
  let url = assertFetchable(rawUrl, opts.allowPrivate);

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const res = await request(url, opts);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      url = assertFetchable(new URL(location, url).toString(), opts.allowPrivate);
      continue;
    }
    return { ...res, finalUrl: url.toString(), ms: Date.now() - started };
  }
  throw new FetchBlockedError("too_many_redirects");
}
