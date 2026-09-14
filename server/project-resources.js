import { ApiError } from './errors.js';

export function projectResources(value = '[]') {
  const fail = () => { throw new ApiError(400, 'invalid_resources', 'Add up to five TXT, Markdown, PDF, PNG or JPEG files (150 KB each, 250 KB total; text up to 16,000 characters total).'); };
  let items; try { items = JSON.parse(value); } catch { fail(); }
  if (!Array.isArray(items) || items.length > 5) fail();
  let total = 0, textSize = 0;
  const resources = items.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['name', 'mime', 'text', 'data'].includes(k)) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 180) fail();
    const name = item.name.trim();
    if (['text/plain', 'text/markdown'].includes(item.mime)) {
      if (typeof item.text !== 'string' || item.data !== undefined || !/\.(txt|md)$/i.test(name)) fail();
      textSize += item.text.length; total += Buffer.byteLength(item.text);
      return { name, mime: item.mime, text: item.text, size: Buffer.byteLength(item.text), readable: true };
    }
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(item.mime) || typeof item.data !== 'string' || item.data.length > 210000 || item.text !== undefined || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) fail();
    const bytes = Buffer.from(item.data, 'base64');
    const valid = item.mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : item.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid || bytes.length > 150 * 1024 || bytes.toString('base64') !== item.data) fail();
    total += bytes.length;
    return { name, mime: item.mime, data: item.data, size: bytes.length, readable: false };
  });
  if (total > 250 * 1024 || textSize > 16000) fail();
  return resources;
}
