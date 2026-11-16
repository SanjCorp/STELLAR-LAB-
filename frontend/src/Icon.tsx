// Íconos del sistema de diseño de STELLAR (diseño: Choy). Usan currentColor.
export type IconName = 'inicio' | 'monitorizacion' | 'bienestar' | 'entrenamiento' | 'perfil' | 'analisis' | 'alertas' | 'configuracion'
  | 'tripulacion' | 'control-mision' | 'cohete' | 'reloj' | 'chevron-abajo' | 'corazon' | 'gota' | 'termometro' | 'pulmones' | 'luna'
  | 'corredor' | 'destello-ia' | 'barras' | 'foco' | 'chip' | 'corazon-check' | 'flecha-derecha' | 'check-circulo' | 'senal'

export default function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <svg className={`icon ${className}`} width={size} height={size} aria-hidden="true"><use href={`/icons/sprite.svg#${name}`} /></svg>
}
