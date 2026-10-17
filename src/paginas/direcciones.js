import { isIP } from 'node:net';

// Protección contra SSRF: el backend descarga páginas que indica el usuario, así que nunca debe
// conectarse a direcciones internas (la red de Render, el servicio de metadatos de la nube,
// localhost…). Ver docs/seguridad.md.

export class ErrorSsrf extends Error {}

// Rangos IPv4 privados, reservados o especiales: [red, bits de prefijo].
const RANGOS_V4 = [
  ['0.0.0.0', 8], // "esta red"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incluye 169.254.169.254, metadatos de la nube)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // asignaciones del IETF
  ['192.0.2.0', 24], // documentación
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // pruebas de rendimiento
  ['198.51.100.0', 24], // documentación
  ['203.0.113.0', 24], // documentación
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada (incluye 255.255.255.255)
];

function v4ANumero(ip) {
  return ip.split('.').reduce((n, parte) => n * 256 + Number(parte), 0);
}

function v4Privada(ip) {
  const n = v4ANumero(ip);
  return RANGOS_V4.some(([red, bits]) => {
    const tamano = 2 ** (32 - bits);
    return Math.floor(n / tamano) === Math.floor(v4ANumero(red) / tamano);
  });
}

// IPv6 → 8 grupos de 16 bits (admite "::" y una IPv4 al final, como ::ffff:127.0.0.1).
function v6AGrupos(ip) {
  let texto = ip.toLowerCase();
  const v4 = texto.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4ANumero(v4[1]);
    texto = texto.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [cabeza, cola = null] = texto.split('::');
  const izquierda = cabeza ? cabeza.split(':') : [];
  const derecha = cola === null ? [] : cola ? cola.split(':') : [];
  const relleno = cola === null ? [] : Array(8 - izquierda.length - derecha.length).fill('0');
  return [...izquierda, ...relleno, ...derecha].map((g) => parseInt(g, 16));
}

function v6Privada(ip) {
  const g = v6AGrupos(ip);
  const ceros = (desde, hasta) => g.slice(desde, hasta).every((x) => x === 0);
  if (ceros(0, 8)) return true; // ::
  if (ceros(0, 7) && g[7] === 1) return true; // ::1
  // IPv4 mapeada (::ffff:a.b.c.d) o traducida por NAT64 (64:ff9b::a.b.c.d): se revisa la IPv4.
  const mapeada = ceros(0, 5) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && ceros(2, 6);
  if (mapeada || nat64) return v4Privada(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7, únicas locales
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10, link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8, multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentación
  return false;
}

// true si la IP es privada, reservada o especial (o si ni siquiera es una IP).
export function esIpPrivada(ip) {
  const tipo = isIP(ip);
  if (tipo === 4) return v4Privada(ip);
  if (tipo === 6) return v6Privada(ip);
  return true;
}
