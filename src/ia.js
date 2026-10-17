// Integración con Google Gemini mediante su API REST (sin SDK).
// La API key solo se lee de GEMINI_API_KEY y nunca se envía al frontend.

const MODELO_POR_DEFECTO = 'gemini-3.5-flash-lite';

export function iaDisponible() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Error de la IA con el código HTTP que debe ver el cliente (400, 429, 502 o 503).
export class ErrorIA extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.estado = estado;
  }
}

const TIEMPO_MAXIMO_MS = 60_000;
const ESPERA_REINTENTO_MS = 1500;

// Pide a Gemini una respuesta en modo JSON y devuelve el texto tal cual (se valida después).
// Si Gemini está ocupado (503, "high demand", suele durar segundos), reintenta una vez.
export async function llamarGeminiJson({ esperaReintentoMs = ESPERA_REINTENTO_MS, ...opciones }) {
  try {
    return await llamarUnaVez(opciones);
  } catch (err) {
    if (!(err instanceof ErrorOcupado)) throw err;
    await new Promise((r) => setTimeout(r, esperaReintentoMs));
    try {
      return await llamarUnaVez(opciones);
    } catch (otro) {
      if (otro instanceof ErrorOcupado) {
        throw new ErrorIA('La IA está muy solicitada en este momento. Espera unos segundos y pulsa «Corregir más».', 503);
      }
      throw otro;
    }
  }
}

class ErrorOcupado extends Error {}

async function llamarUnaVez({ sistema, usuario, fetchImpl = fetch, tiempoMaximoMs = TIEMPO_MAXIMO_MS }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ErrorIA('La IA no está configurada en el servidor.', 503);

  const modelo = process.env.GEMINI_MODEL || MODELO_POR_DEFECTO;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
  const signal = AbortSignal.timeout(tiempoMaximoMs);

  let respuesta;
  try {
    respuesta = await fetchImpl(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: 'user', parts: [{ text: usuario }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
  } catch (err) {
    if (signal.aborted) throw new ErrorIA('La IA tardó demasiado en responder. Inténtalo de nuevo.', 502);
    throw new ErrorIA(`No se pudo consultar a la IA: ${err.message}`, 502);
  }

  const datos = await respuesta.json().catch(() => ({}));
  if (respuesta.status === 429) {
    throw new ErrorIA('La IA está saturada en este momento. Espera un minuto y vuelve a intentarlo.', 429);
  }
  if (respuesta.status === 503) throw new ErrorOcupado();
  if (!respuesta.ok) {
    throw new ErrorIA(`No se pudo consultar a la IA: ${datos?.error?.message || `código ${respuesta.status}`}`, 502);
  }
  const texto = datos?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!texto) throw new ErrorIA('La IA no devolvió ninguna respuesta.', 502);
  return texto;
}
