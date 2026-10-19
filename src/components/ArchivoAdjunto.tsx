import { esImagen, extensionDe, pesoLegible } from '../lib/archivos'

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
      <a href={urlDescarga} className="archivo-adjunto__descargar" aria-label={`Descargar ${nombre}`} title="Descargar">
        <IconoDescarga />
      </a>
    </div>
  )
}
