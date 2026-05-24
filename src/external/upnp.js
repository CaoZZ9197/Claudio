import dgram from "node:dgram";
import http from "node:http";
import { URL } from "node:url";

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const DISCOVER_TIMEOUT = 3000;

const DISCOVER_MSG = Buffer.from(
  [
    "M-SEARCH * HTTP/1.1",
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    "MX: 2",
    "ST: urn:schemas-upnp-org:device:MediaRenderer:1",
    "",
    "",
  ].join("\r\n")
);

export function discoverDevices() {
  return new Promise((resolve) => {
    const devices = [];
    const socket = dgram.createSocket("udp4");

    socket.on("message", (msg) => {
      const text = msg.toString();
      const location = text.match(/LOCATION:\s*(.+)/i)?.[1];
      const name = text.match(/SERVER:\s*(.+)/i)?.[1] || "Unknown";
      const usn = text.match(/USN:\s*(.+)/i)?.[1] || "";

      if (location && !devices.find((d) => d.location === location)) {
        devices.push({ friendlyName: name, location, usn });
      }
    });

    socket.on("error", () => {
      socket.close();
      resolve(devices);
    });

    socket.bind(() => {
      try {
        socket.addMembership(SSDP_ADDR);
        socket.send(DISCOVER_MSG, SSDP_PORT, SSDP_ADDR);
      } catch (err) {
        console.error("[upnp] socket bind callback error:", err.message);
        socket.close();
      }
    });

    setTimeout(() => {
      socket.close();
      resolve(devices);
    }, DISCOVER_TIMEOUT);
  });
}

async function soapRequest(host, port, soapBody) {
  return new Promise((resolve, reject) => {
    const body = [
      '<?xml version="1.0"?>',
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
      "<s:Body>",
      soapBody,
      "</s:Body>",
      "</s:Envelope>",
    ].join("\n");

    const req = http.request(
      { host, port, method: "POST", path: "/AVTransport/control", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPACTION: '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"' } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function castAudio(audioUrl, device) {
  if (!device?.location) {
    return { error: "No UPnP device specified" };
  }

  try {
    const url = new URL(device.location);
    const soapBody = [
      '<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">',
      "<InstanceID>0</InstanceID>",
      `<CurrentURI>${escapeXml(audioUrl)}</CurrentURI>`,
      "<CurrentURIMetaData></CurrentURIMetaData>",
      "</u:SetAVTransportURI>",
    ].join("");

    await soapRequest(url.hostname, parseInt(url.port) || 80, soapBody);

    return { ok: true, device: device.friendlyName || device.location };
  } catch (err) {
    return { error: `Failed to cast to device: ${err.message}` };
  }
}

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export default { discoverDevices, castAudio };
