import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorSsrf, esIpPrivada, validarUrl } from '../src/paginas/direcciones.js';

const privadas = [
  '127.0.0.1', '127.255.0.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
  '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
  '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1',
  '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::7f00:1',
];
const publicas = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111', '2001:4860:4860::8888'];

for (const ip of privadas) {
  test(`${ip} es privada o reservada`, () => assert.equal(esIpPrivada(ip), true));
}
for (const ip of publicas) {
  test(`${ip} es pública`, () => assert.equal(esIpPrivada(ip), false));
}

test('un texto que no es IP se trata como no permitido', () => {
  assert.equal(esIpPrivada('no-es-ip'), true);
});

function rechaza(texto, patron) {
  assert.throws(() => validarUrl(texto), (err) => {
    assert.ok(err instanceof ErrorSsrf, String(err));
    assert.match(err.message, patron);
    return true;
  });
}

test('acepta una URL https pública', () => {
  assert.equal(validarUrl('https://ejemplo.org/a?b=1').hostname, 'ejemplo.org');
  assert.equal(validarUrl('  http://ejemplo.org  ').protocol, 'http:');
});

test('solo http y https', () => {
  rechaza('ftp://ejemplo.org', /http o https/);
  rechaza('file:///etc/passwd', /http o https/);
  rechaza('javascript:alert(1)', /http o https/);
});

test('rechaza usuario y contraseña en la URL', () => rechaza('https://ana:clave@ejemplo.org', /usuario/));
test('solo puertos 80 y 443', () => rechaza('https://ejemplo.org:8080/', /puerto/));
test('rechaza localhost', () => {
  rechaza('http://localhost/', /internas/);
  rechaza('http://api.localhost/', /internas/);
});
test('rechaza IPs privadas escritas en la URL', () => {
  rechaza('http://127.0.0.1/', /internas/);
  rechaza('http://[::1]/', /internas/);
  rechaza('http://169.254.169.254/latest/meta-data', /internas/);
});
test('rechaza texto que no es URL', () => rechaza('no soy una url', /no es una URL/));
