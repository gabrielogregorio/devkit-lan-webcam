/*
 * Page strings. English is the source text and the key; PT_BR holds the Brazilian Portuguese line.
 * The language comes from ?lang=en|pt-BR or else from the browser's first preferred language:
 * pt* shows pt-BR, anything else shows English. tests/frontend/i18n.test.mjs fails on a missing
 * line, on different {placeholders} or on a line that is no longer used.
 */
export const PT_BR = {
  'LAN Webcam': 'LAN Webcam',
  '📷 Camera → PC webcam': '📷 Câmera → webcam do PC',
  'Mirror': 'Espelhar',
  'Rotate 90°': 'Girar 90°',
  'Fit': 'Enquadrar',
  'Fit ✓': 'Encaixar ✓',
  'Crop ✓': 'Cortar ✓',
  'Reset': 'Reset',
  '📷 Back': '📷 Traseira',
  '🤳 Front': '🤳 Frontal',
  'Start streaming': 'Iniciar transmissão',
  'Stop': 'Parar',
  'Tap "Start streaming"': 'Toque em "Iniciar transmissão"',
  'On the preview: <b>drag</b> to move • <b>pinch</b> (2 fingers) to zoom. The camera becomes the <b>"LAN Webcam"</b> webcam on the PC. Keep this tab open and the screen on.':
    'No preview: <b>arraste</b> para mover • <b>pinça</b> (2 dedos) para zoom. A câmera vira a webcam <b>"LAN Webcam"</b> no PC. Mantenha a aba aberta e a tela ligada.',
  'camera': 'câmera',
  'Camera {number}': 'Câmera {number}',
  '{count} camera(s) found': '{count} câmera(s) encontrada(s)',
  '{count} camera(s) found - 🟢 streaming': '{count} câmera(s) encontrada(s) - 🟢 transmitindo',
  '🟢 Streaming - {camera}': '🟢 Transmitindo - {camera}',
  '👁️ Previewing - {camera}': '👁️ Pré-visualizando - {camera}',
  'That camera did not open ({reason}). Back to the previous one.': 'Essa câmera não abriu ({reason}). Voltei pra anterior.',
  'That camera did not open ({reason}). None available.': 'Essa câmera não abriu ({reason}). Nenhuma disponível.',
  'Opening camera…': 'Abrindo câmera…',
  'No camera. Allow access and tap Back/Front': 'Sem câmera. Permita o acesso e toque Traseira/Frontal',
  'Connection closed': 'Conexão encerrada',
  'WebSocket connection error': 'Erro de conexão WebSocket',
  'Stopped': 'Parado',
};

const isPortuguese = (language) => /^pt([-_]|$)/i.test(language || '');

export function detectLanguage(search = '', languages = []) {
  const forced = new URLSearchParams(search).get('lang');
  if (forced) {
    return isPortuguese(forced) ? 'pt-BR' : 'en';
  }
  return isPortuguese(languages[0]) ? 'pt-BR' : 'en';
}

export const fill = (text, values = {}) =>
  text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));

export const translator = (language) => (text, values) =>
  fill(language === 'pt-BR' ? (PT_BR[text] ?? text) : text, values);
