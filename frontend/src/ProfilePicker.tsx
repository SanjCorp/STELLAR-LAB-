import type { CrewProfile } from './profiles'
import { LangSwitch, roleLabel, t } from './i18n'

export default function ProfilePicker({ profiles, onSelect }: { profiles: CrewProfile[]; onSelect: (profile: CrewProfile) => void }) {
  return <main className="profile-gate">
    <div className="gate-stars"/><div className="gate-orbit orbit-a"/><div className="gate-orbit orbit-b"/>
    <header className="gate-brand"><img className="gate-logo" src="/brand/logo-cian.svg" alt="" /><div><b>STELLAR <em>Health</em></b><span>{t('MISIÓN STELLAR-01 · SALUD DE LA TRIPULACIÓN', 'STELLAR-01 MISSION · CREW HEALTH')}</span></div><LangSwitch /></header>
    <section className="profile-picker">
      <span>{t('ACCESO A PERFILES A BORDO', 'ONBOARD PROFILE ACCESS')}</span><h1>{t('¿Quién está ingresando?', 'Who is signing in?')}</h1><p>{t('Selecciona un perfil local.', 'Select a local profile.')}</p>
      <div className="profile-cards">
        {profiles.map((profile, index) => <button key={profile.id} className={`profile-card profile-${profile.access}`} onClick={() => onSelect(profile)} style={{'--profile-accent': profile.accent} as React.CSSProperties}>
          <div className="profile-portrait">{profile.photo ? <img src={profile.photo} alt={t(`Retrato oficial de ${profile.name}`, `Official portrait of ${profile.name}`)} /> : <><div className="portrait-head"><i/><b>{profile.initials}</b></div><div className="portrait-suit"><i>S</i><span/></div></>}{profile.access === 'captain' && <em>{t('MANDO', 'COMMAND')}</em>}{profile.access === 'nasa' && <em>{t('TIERRA', 'EARTH')}</em>}</div>
          <strong>{profile.name}</strong><span>{roleLabel(profile.role)}</span><small>{profile.agency}</small>
          <i className="profile-number">0{index + 1}</i>
        </button>)}
      </div>
      <div className="gate-note"><i/> {t('Los perfiles funcionan dentro de la nave y no sustituyen una autenticación de seguridad. Datos de salud simulados con fines de demostración.', 'Profiles work inside the spacecraft and do not replace security authentication. Health data is simulated for demonstration.')}</div>
    </section>
  </main>
}
