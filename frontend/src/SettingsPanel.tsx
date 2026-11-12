import type { CrewProfile } from './profiles'

export default function SettingsPanel({ profile }: { profile: CrewProfile }) {
  const nasa = profile.access === 'nasa'
  return <section className="settings-page">
    <div className="settings-heading"><span>{nasa ? 'NASA TECHNICAL PROFILE' : 'PERSONAL PROFILE SETTINGS'}</span><h2>{nasa ? 'System configuration' : 'My preferences'}</h2><p>{nasa ? 'Technical configuration of the local STELLAR interface. Password protection is planned but disabled in this prototype.' : `These settings apply only to ${profile.name}'s local profile.`}</p></div>
    <div className="settings-grid">
      <article><span>PROFILE</span><div className="settings-identity"><div>{profile.initials}</div><h3>{profile.name}</h3><p>{profile.role} · {profile.agency}</p></div><label>Display language<select defaultValue="en"><option value="en">English</option><option value="es">Español</option><option value="it">Italiano</option></select></label><label>Interface contrast<select defaultValue="mission"><option value="mission">Mission dark</option><option value="high">High contrast</option></select></label></article>
      <article><span>{nasa ? 'SYSTEM' : 'HEALTH DISPLAY'}</span>{nasa ? <><label>Telemetry refresh<select defaultValue="1"><option value="1">Every second</option><option value="5">Every 5 seconds</option></select></label><label>Default mission<select><option>Artemis III</option></select></label><label className="setting-switch"><input type="checkbox" defaultChecked/>Enable simulated telemetry</label><label className="setting-switch"><input type="checkbox" defaultChecked/>Show technical diagnostics</label></> : <><label className="setting-switch"><input type="checkbox" defaultChecked/>Exercise reminders</label><label className="setting-switch"><input type="checkbox" defaultChecked/>Respiration guidance</label><label className="setting-switch"><input type="checkbox"/>Audio cues</label><label>Units<select><option>Metric</option></select></label></>}</article>
      {nasa && <article className="access-config"><span>ACCESS STATUS</span><h3>Password not configured</h3><p>The NASA profile is open during prototype development. Authentication and credential recovery will be added before operational testing.</p><button disabled>Configure password later</button><div><i/>LOCAL PROTOTYPE ACCESS</div></article>}
    </div>
  </section>
}
