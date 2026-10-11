import { validateDocument, type EditDocument, type Photo } from './model'
import { canvas, context } from './masks'

const MAX_BYTES = 200 * 1024 * 1024
export async function decodePhoto(blob: Blob, name: string): Promise<Photo> {
  if (blob.size > MAX_BYTES) throw new Error('Choose a photo under 200 MB.')
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
  const brand = new TextDecoder().decode(header.slice(8))
  const heic =
    /hei[cfx]|hev[cx]|mif1|msf1/.test(brand) ||
    /\.hei[cf]$/i.test(name) ||
    /hei[cf]/.test(blob.type)
  const jpeg = header[0] === 255 && header[1] === 216
  const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71
  if (!jpeg && !png && !heic)
    throw new Error('Open a JPEG, PNG, or HEIC photo. RAW support is coming later.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      colorSpaceConversion: 'default',
    })
  } catch {
    if (!heic)
      throw new Error(
        'This photo could not be decoded. It may be damaged or use an unsupported encoding.',
      )
    try {
      const { heicTo } = await import('heic-to/csp')
      bitmap = await heicTo({ blob, type: 'bitmap' })
    } catch {
      throw new Error(
        'This HEIC could not be decoded. Try exporting it from Photos as a JPEG, or use another HEIC file.',
      )
    }
  }
  if (bitmap.width * bitmap.height > 50_000_000 || Math.max(bitmap.width, bitmap.height) > 20000) {
    bitmap.close()
    throw new Error(
      'This first version supports photos up to 50 megapixels and 20,000 pixels per side.',
    )
  }
  const thumbnail = canvas(320, Math.max(1, Math.round((320 * bitmap.height) / bitmap.width)))
  context(thumbnail).drawImage(bitmap, 0, 0, thumbnail.width, thumbnail.height)
  return {
    name,
    type: heic ? 'HEIC' : jpeg ? 'JPEG' : 'PNG',
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
    blob,
    url: thumbnail.toDataURL('image/jpeg', 0.8),
  }
}
export function canvasBlob(c: HTMLCanvasElement, type: string, quality = 0.94): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('The browser could not encode this image. Try a smaller export.')),
      type,
      quality,
    ),
  )
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[\\/:*?"<>|]/g, '-')
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
export function packProject(photo: Pick<Photo, 'name' | 'blob'>, edits: EditDocument): Blob {
  const meta = new TextEncoder().encode(
    JSON.stringify({
      app: 'Photo Studio',
      version: 1,
      name: photo.name,
      mime: photo.blob.type,
      edits,
    }),
  )
  const header = new Uint8Array(12)
  header.set(new TextEncoder().encode('PHST0001'))
  new DataView(header.buffer).setUint32(8, meta.length, true)
  return new Blob([header, meta, photo.blob], { type: 'application/x-photostudio' })
}
export async function unpackProject(
  file: Blob,
): Promise<{ blob: Blob; name: string; edits: EditDocument }> {
  if (file.size > MAX_BYTES + 16 * 1024 * 1024)
    throw new Error('This project is too large to open.')
  const header = await file.slice(0, 12).arrayBuffer()
  if (header.byteLength !== 12 || new TextDecoder().decode(header.slice(0, 8)) !== 'PHST0001')
    throw new Error('This is not a valid Photo Studio project.')
  const length = new DataView(header).getUint32(8, true)
  if (length > 16 * 1024 * 1024 || length + 12 >= file.size)
    throw new Error('This project has an invalid header.')
  const meta = JSON.parse(await file.slice(12, 12 + length).text())
  if (
    meta.app !== 'Photo Studio' ||
    meta.version !== 1 ||
    typeof meta.name !== 'string' ||
    meta.name.length > 500 ||
    typeof meta.mime !== 'string'
  )
    throw new Error('This project version is not supported.')
  return {
    blob: file.slice(12 + length, file.size, meta.mime),
    name: meta.name,
    edits: validateDocument(meta.edits),
  }
}
type Draft = { name: string; blob: Blob; edits: EditDocument; savedAt: number }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('photo-studio', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function saveDraft(photo: Photo, edits: EditDocument) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      transaction
        .objectStore('drafts')
        .put(
          { name: photo.name, blob: photo.blob, edits, savedAt: Date.now() } satisfies Draft,
          'latest',
        )
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
export async function loadDraft(): Promise<Draft | undefined> {
  const db = await database()
  try {
    return await new Promise<Draft | undefined>((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get('latest')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
