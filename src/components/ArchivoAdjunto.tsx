import { useState, type MouseEvent } from 'react'
import { descargarConNombre, esImagen, extensionDe, pesoLegible } from '../lib/archivos'

interface ArchivoAdjuntoProps {
  nombre: string
  // URL para abrir el archivo en otra pestaña y para la miniatura.
  url: string
  // URL que fuerza la descarga con el nombre original.
  urlDescarga: string
  tamano?: number | null
}

export function IconoArchivo({ nombre }: { nombre: string }) {
  return (
    <span className="archivo-adjunto__icono" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v5h5" />
      </svg>
      <span>{extensionDe(nombre).slice(0, 4) || 'file'}</span>
    </span>
  )
}

export function IconoDescarga() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  )
}

// Botón de descarga que guarda el archivo con su nombre original. El href
// (con ?download=) queda de respaldo: si la descarga por la app falla, o se
// abre con clic medio o "guardar enlace como", el navegador usa ese.
export function EnlaceDescarga({ url, urlDescarga, nombre }: { url: string; urlDescarga: string; nombre: string }) {
  const [descargando, setDescargando] = useState(false)

  async function descargar(e: MouseEvent<HTMLAnchorElement>) {
    // Ctrl/Cmd/Shift + clic: se respeta lo que el navegador haga con el enlace.
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (descargando) return
    setDescargando(true)
    try {
      await descargarConNombre(url, nombre)
    } catch (error) {
      console.error('No se pudo descargar con el nombre original:', (error as Error).message)
      window.location.href = urlDescarga
    } finally {
      setDescargando(false)
    }
  }

  return (
    <a
      href={urlDescarga}
      download={nombre}
      onClick={(e) => void descargar(e)}
      className={`archivo-adjunto__descargar${descargando ? ' archivo-adjunto__descargar--cargando' : ''}`}
      aria-label={`Descargar ${nombre}`}
      aria-busy={descargando}
      title={descargando ? 'Descargando…' : 'Descargar'}
    >
      <IconoDescarga />
    </a>
  )
}

export function ArchivoAdjunto({ nombre, url, urlDescarga, tamano }: ArchivoAdjuntoProps) {
  return (
    <div className="archivo-adjunto">
      <a href={url} target="_blank" rel="noreferrer" className="archivo-adjunto__abrir" title={`Abrir ${nombre}`}>
        {esImagen(nombre)
          ? <img src={url} alt="" className="archivo-adjunto__miniatura" loading="lazy" />
          : <IconoArchivo nombre={nombre} />}
        <span className="archivo-adjunto__datos">
          <strong>{nombre}</strong>
          {tamano ? <span>{pesoLegible(tamano)}</span> : null}
        </span>
      </a>
      <EnlaceDescarga url={url} urlDescarga={urlDescarga} nombre={nombre} />
    </div>
  )
}
