import { useMemo } from 'react'
import { t } from './i18n'

export type Sample = {
  astronaut_id: string; device_id?: string; source: 'simulation' | 'hardware'; received_at: string; ecg_raw: number; leads_off: boolean
  resp_raw: number | null; respiration_rate_bpm: number | null
  heart_rate_bpm: number | null; ax: number | null; ay: number | null; az: number | null; gx: number | null; gy: number | null; gz: number | null
  pos_x_m: number | null; pos_y_m: number | null; pos_z_m?: number | null; area_m2: number | null; steps: number | null; battery_pct: number | null
  scenario?: string
}

/** Gráfico de línea. `band` dibuja la franja "normal" de la línea base personal. */
export function Line({ values, color = '#58e6c2', band, className = '' }: { values: (number | null)[]; color?: string; band?: { low: number | null; high: number | null }; className?: string }) {
  const view = useMemo(() => {
    const valid = values.filter((v): v is number => typeof v === 'number')
    if (!valid.length) return null
    const bandValues = band && band.low != null && band.high != null ? [band.low, band.high] : []
    const min = Math.min(...valid, ...bandValues), max = Math.max(...valid, ...bandValues)
    const pad = (max - min) * 0.08 || 1
    const lo = min - pad, span = max + pad - lo
    const y = (v: number) => 40 - ((v - lo) / span) * 36
    // Sin lectura (null) = hueco en la línea, para no inventar un tramo.
    let path = '', pen = false
    values.forEach((v, i) => {
      if (v == null) { pen = false; return }
      path += `${pen ? 'L' : 'M'}${(i / Math.max(1, values.length - 1)) * 100},${y(v)} `; pen = true
    })
    const rect = bandValues.length ? { y: y(bandValues[1]), h: y(bandValues[0]) - y(bandValues[1]) } : null
    return { path, rect }
  }, [values, band?.low, band?.high])
  return <svg className={`spark ${className}`} viewBox="0 0 100 42" preserveAspectRatio="none" aria-label={t('Gráfico en tiempo real', 'Live chart')}>
    {view?.rect && <rect x="0" width="100" y={view.rect.y} height={view.rect.h} fill={color} opacity="0.12" />}
    {view && <path d={view.path} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
  </svg>
}
