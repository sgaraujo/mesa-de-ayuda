import { useNavigate } from 'react-router-dom'
import { TicketForm } from '../components/TicketForm'

export function NewTicketPage() {
  const navigate = useNavigate()

  return (
    <div className="page-form">
      <h1>Nueva solicitud</h1>
      <p className="page-form__subtitulo">
        Cuéntanos qué necesitas y a qué área se lo pides. La solicitud llega a la bandeja
        general de esa área y puedes seguirla en Mis solicitudes.
      </p>
      <TicketForm elegirArea onCreado={() => navigate('/mis-solicitudes')} />
    </div>
  )
}
