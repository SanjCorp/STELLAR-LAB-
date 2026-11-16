"""Motor de alertas de STELLAR (punto 3) y reporte para los médicos en Tierra (punto 4).

Reglas simples y explicables (sin IA que decida). Cada alerta dice:
  * QUÉ cambió y POR QUÉ se dispara (con los números),
  * QUÉ HACER (pasos concretos),
  * QUIÉN actúa, según el nivel:
      Nivel 1 · Lo resuelves tú (descanso, hidratación, respiración, ejercicio).
      Nivel 2 · Avisa al oficial médico de la tripulación.
      Nivel 3 · Consulta con los médicos en Tierra (se incluye en el reporte prioritario).
  * qué peligro del vuelo espacial de NASA está relacionado.

Los rangos de presión, temperatura y glucosa son referencias generales.
Prototipo educativo: NO es un dispositivo médico ni da diagnósticos.
"""

from __future__ import annotations

import json
import time
from math import sqrt

from .analysis import SAFE_DISTANCE_M, TETHER_LIMIT_M, duration_text
from .ctx import tr

def who(level: int) -> str:
    return {2: tr("Oficial médico de la tripulación", "Crew medical officer"),
            3: tr("Médicos en Tierra", "Flight surgeons on Earth")}.get(level, tr("Tú mismo", "Yourself"))


def level_title(level: int) -> str:
    return {
        0: tr("Recordatorio", "Reminder"),
        1: tr("Nivel 1 · Lo resuelves tú", "Level 1 · Self-care"),
        2: tr("Nivel 2 · Avisa al oficial médico", "Level 2 · Tell the medical officer"),
        3: tr("Nivel 3 · Consulta con Tierra", "Level 3 · Consult Earth"),
    }[level]


def hazard(key: str) -> str:
    return {
        "gravity": tr("Campos de gravedad: el corazón y la circulación se adaptan a la microgravedad",
                      "Gravity fields: the heart and circulation adapt to microgravity"),
        "closed": tr("Ambiente cerrado y hostil: CO₂, microbios y calidad del aire de la cabina",
                     "Hostile and closed environment: CO₂, microbes and cabin air quality"),
        "isolation": tr("Aislamiento y confinamiento: sueño, ánimo y carga de trabajo",
                        "Isolation and confinement: sleep, mood and workload"),
        "distance": tr("Distancia a la Tierra: la ayuda médica tarda en llegar",
                       "Distance from Earth: medical help takes time to arrive"),
        "radiation": tr("Radiación espacial", "Space radiation"),
    }[key]


def _alert(id_: str, level: int, title: str, reason: str, actions: list[str], hazard_key: str,
           link: str | None = None, evidence: list[str] | None = None) -> dict:
    return {
        "id": id_, "level": level, "level_title": level_title(level), "who": who(level),
        "title": title, "reason": reason, "actions": actions, "hazard": hazard(hazard_key),
        "link": link, "evidence": evidence or [],
    }


def _is_up(sig: dict) -> bool:
    """¿La señal está alta? Manda el límite de seguridad si lo hay; si no, la línea base."""
    if sig.get("absolute"):
        return sig["absolute"] == "high"
    return (sig.get("delta") or 0) > 0


def _hours_since(iso: str | None, now: float) -> float:
    from .supabase_store import parse_ts
    if not iso:
        return 1e9
    try:
        return (now - parse_ts(iso)) / 3600
    except (TypeError, ValueError):
        return 1e9


def evaluate(base: dict, sample: dict, vitals: dict, checkins: list[dict], now: float | None = None) -> list[dict]:
    """Devuelve las alertas activas, de la más grave a la más leve."""
    now = now or time.time()
    out: list[dict] = []
    hr = base.get("signals", {}).get("heart_rate_bpm", {}) or {}
    rr = base.get("signals", {}).get("respiration_rate_bpm", {}) or {}
    hr_up = hr.get("level") in ("observe", "alert") and _is_up(hr)
    rr_up = rr.get("level") in ("observe", "alert") and _is_up(rr)

    # --- Calidad de señal -------------------------------------------------
    if sample.get("leads_off") or base.get("level") == "unreliable":
        out.append(_alert("signal", 1, tr("Lectura poco confiable", "Unreliable reading"),
                          tr("El ECG indica electrodos sueltos: el pulso y la respiración de este momento no son fiables.",
                             "The ECG reports loose electrodes: heart and breathing values right now are not reliable."),
                          [tr("Revisa que los 3 electrodos estén bien pegados.", "Check that the 3 electrodes are firmly attached."),
                           tr("Quédate quieto 30 s y vuelve a mirar el panel.", "Stay still for 30 s and look at the panel again.")],
                          "closed", None, [tr("leads_off = verdadero", "leads_off = true")]))

    # --- Distancia a la estación durante una EVA ---------------------------
    try:
        x, y, z = (float(sample.get(k) or 0) for k in ("pos_x_m", "pos_y_m", "pos_z_m"))
        distance = sqrt(x * x + y * y + z * z)
    except (TypeError, ValueError):
        distance = 0.0
    if distance > TETHER_LIMIT_M:
        out.append(_alert("eva-far", 2, tr("Lejos de la cápsula", "Far from the capsule"),
                          tr(f"Estás a {distance:.1f} m de la escotilla: más que el cable de seguridad de referencia ({TETHER_LIMIT_M} m).",
                             f"You are {distance:.1f} m from the hatch: beyond the reference safety tether ({TETHER_LIMIT_M} m)."),
                          [tr("Detén el avance y vuelve hacia la cápsula.", "Stop moving out and head back to the capsule."),
                           tr("Confirma tu posición con el oficial de la EVA.", "Confirm your position with the EVA officer."),
                           tr("Revisa el anclaje del cable de seguridad.", "Check the safety tether anchor.")],
                          "distance", "EVA", [tr(f"distancia {distance:.1f} m", f"distance {distance:.1f} m"),
                                              tr(f"zona segura ≤ {SAFE_DISTANCE_M} m", f"safe zone ≤ {SAFE_DISTANCE_M} m")]))

    # --- Pulso y respiración frente a la línea base ------------------------
    if hr_up and rr_up and "alert" in (hr.get("level"), rr.get("level")):
        out.append(_alert("hr-rr", 2, tr("Pulso y respiración elevados a la vez", "Heart rate and breathing both elevated"),
                          f"{hr['message']} {rr['message']} " + tr("Que suban juntos sin ejercicio puede indicar esfuerzo, estrés o mala calidad del aire.",
                                                                    "Both rising without exercise may point to effort, stress or poor air quality."),
                          [tr("Detén la actividad y siéntate.", "Stop the activity and sit down."),
                           tr("Revisa el CO₂ de la cabina en el panel de soporte vital.", "Check cabin CO₂ on the life-support panel."),
                           tr("Avisa al oficial médico si no baja en 10 min.", "Tell the medical officer if it does not drop within 10 min.")],
                          "closed", "Wellness",
                          [tr(f"z pulso = {hr.get('z')}", f"heart z = {hr.get('z')}"), tr(f"z respiración = {rr.get('z')}", f"breathing z = {rr.get('z')}")]))
    else:
        for sig, key, hazard_key in ((hr, "hr", "gravity"), (rr, "rr", "closed")):
            if sig.get("level") not in ("observe", "alert"):
                continue
            up = _is_up(sig)
            absolute = sig.get("absolute")
            # Fuera del límite de seguridad "alert" (p. ej. pulso > 130 en reposo) escala más rápido: 30 s.
            serious = sig["level"] == "alert" and (sig.get("duration_s") or 0) >= (30 if absolute and sig.get("safety_level") == "alert" else 60)
            level = 2 if serious else 1
            actions = ([tr("Haz una pausa de 5 min sentado.", "Take a 5-minute seated break."),
                        tr("Respira lento (ejercicio 4·6 en Bienestar).", "Breathe slowly (4·6 exercise in Wellness)."),
                        tr("Bebe agua y vuelve a mirar en 10 min.", "Drink water and check again in 10 min.")]
                       if up else [tr("Comprueba que el sensor esté bien colocado.", "Make sure the sensor is placed correctly."),
                                   tr("Levántate despacio y observa si hay mareo.", "Stand up slowly and watch for dizziness.")])
            if level == 2:
                actions.append(tr("Si sigue igual, avisa al oficial médico.", "If it stays the same, tell the medical officer."))
            if absolute:
                strong = sig.get("safety_level") == "alert"
                title = (tr(f"{sig['label']} {'muy alto' if strong else 'alto'}", f"{sig['label']} {'very high' if strong else 'high'}") if up
                         else tr(f"{sig['label']} {'muy bajo' if strong else 'bajo'}", f"{sig['label']} {'very low' if strong else 'low'}"))
            else:
                title = (tr(f"{sig['label']} por encima de tu base", f"{sig['label']} above your baseline") if up
                         else tr(f"{sig['label']} por debajo de tu base", f"{sig['label']} below your baseline"))
            evidence = [tr(f"ahora {sig.get('current')} {sig.get('unit')}", f"now {sig.get('current')} {sig.get('unit')}")]
            if absolute:
                evidence.append(tr(f"seguridad {sig.get('safe_low'):.0f}–{sig.get('safe_high'):.0f} {sig.get('unit')}",
                                   f"safety {sig.get('safe_low'):.0f}–{sig.get('safe_high'):.0f} {sig.get('unit')}"))
            if sig.get("z") is not None:
                evidence += [f"z = {sig.get('z')}", tr(f"base {sig.get('center')} {sig.get('unit')}", f"baseline {sig.get('center')} {sig.get('unit')}")]
            evidence.append(tr(f"fuera de rango {duration_text(sig.get('duration_s') or 0)}", f"out of range {duration_text(sig.get('duration_s') or 0)}"))
            out.append(_alert(key, level, title, sig["message"], actions, hazard_key, "Wellness", evidence))

    # --- Temperatura y presión (medición automática simulada o manual) -----
    temp = (vitals.get("latest_temp") or {}).get("temperature_c")
    if temp is not None:
        if temp >= 38 and hr_up:
            out.append(_alert("fever-hr", 3, tr("Fiebre con pulso elevado", "Fever with elevated heart rate"),
                              tr(f"Temperatura {temp} °C y {hr['message'][0].lower() + hr['message'][1:]} Juntas pueden indicar una infección.",
                                 f"Temperature {temp} °C and {hr['message'][0].lower() + hr['message'][1:]} Together they may indicate an infection."),
                              [tr("Descansa y aíslate de la tripulación por precaución.", "Rest and keep away from the crew as a precaution."),
                               tr("Avisa al oficial médico ahora.", "Tell the medical officer now."),
                               tr("Se envía un reporte prioritario a los médicos en Tierra.", "A priority report is sent to the flight surgeons on Earth.")],
                              "distance", "Wellness", [tr(f"temperatura {temp} °C", f"temperature {temp} °C"), tr(f"z pulso = {hr.get('z')}", f"heart z = {hr.get('z')}")]))
        elif temp >= 38:
            out.append(_alert("fever", 2, tr("Fiebre", "Fever"),
                              tr(f"Temperatura {temp} °C (referencia: fiebre desde 38 °C).", f"Temperature {temp} °C (reference: fever from 38 °C)."),
                              [tr("Descansa e hidrátate.", "Rest and hydrate."), tr("Avisa al oficial médico.", "Tell the medical officer."),
                               tr("Vuelve a medir en 1 hora.", "Measure again in 1 hour.")], "closed", "Wellness",
                              [tr(f"temperatura {temp} °C", f"temperature {temp} °C")]))
        elif temp >= 37.3:
            out.append(_alert("temp", 1, tr("Temperatura algo elevada", "Slightly high temperature"),
                              tr(f"Temperatura {temp} °C (normal 36–37,2 °C).", f"Temperature {temp} °C (normal 36–37.2 °C)."),
                              [tr("Hidrátate y evita el ejercicio intenso.", "Hydrate and avoid intense exercise."),
                               tr("Vuelve a medir en 1 hora.", "Measure again in 1 hour.")], "closed", "Wellness",
                              [tr(f"temperatura {temp} °C", f"temperature {temp} °C")]))

    bp = vitals.get("latest_bp") or {}
    sys_, dia = bp.get("systolic_mmhg"), bp.get("diastolic_mmhg")
    if sys_ is not None and dia is not None:
        reading = f"{sys_:.0f}/{dia:.0f} mmHg"
        pa = tr("Presión", "Blood pressure")
        if sys_ >= 180 or dia >= 120:
            out.append(_alert("bp-crisis", 3, tr("Presión muy alta", "Very high blood pressure"), f"{pa} {reading} " + tr("(muy alta: ≥ 180/120).", "(very high: ≥ 180/120)."),
                              [tr("Siéntate y repite la medición en 5 min.", "Sit down and repeat the measurement in 5 min."),
                               tr("Avisa al oficial médico ahora.", "Tell the medical officer now."),
                               tr("Se envía un reporte prioritario a Tierra.", "A priority report is sent to Earth.")], "gravity", None, [reading]))
        elif sys_ >= 140 or dia >= 90:
            out.append(_alert("bp-high", 2, tr("Presión alta", "High blood pressure"), f"{pa} {reading} " + tr("(alta: ≥ 140/90).", "(high: ≥ 140/90)."),
                              [tr("Descansa 10 min y vuelve a medir.", "Rest 10 min and measure again."),
                               tr("Reduce la sal y la cafeína hoy.", "Cut down on salt and caffeine today."),
                               tr("Avisa al oficial médico si se repite.", "Tell the medical officer if it happens again.")],
                              "gravity", "Wellness", [reading]))
        elif sys_ < 90 or dia < 60:
            level = 2 if hr_up else 1
            out.append(_alert("bp-low", level, tr("Presión baja", "Low blood pressure") + (tr(" con pulso elevado", " with elevated heart rate") if hr_up else ""),
                              f"{pa} {reading} " + tr("(baja: < 90/60).", "(low: < 90/60).") + (tr(" Con el pulso alto puede indicar deshidratación.", " With a high heart rate it may indicate dehydration.") if hr_up else ""),
                              [tr("Bebe agua o una solución con sales.", "Drink water or an electrolyte solution."),
                               tr("Levántate despacio.", "Stand up slowly."), tr("Vuelve a medir en 30 min.", "Measure again in 30 min.")],
                              "gravity", "Wellness", [reading]))
        elif sys_ >= 130 or dia >= 80:
            out.append(_alert("bp-elev", 1, tr("Presión elevada", "Elevated blood pressure"), f"{pa} {reading} " + tr("(elevada: ≥ 130/80).", "(elevated: ≥ 130/80)."),
                              [tr("Haz 5 min de respiración lenta.", "Do 5 min of slow breathing."), tr("Vuelve a medir más tarde.", "Measure again later.")],
                              "gravity", "Wellness", [reading]))

    # --- Chequeo diario (manual) -----------------------------------------
    today = [c for c in checkins if _hours_since(c.get("created_at"), now) <= 24]
    last = today[0] if today else None
    glucose = next((c["glucose_mg_dl"] for c in today if c.get("glucose_mg_dl") is not None), None)
    if glucose is not None:
        g = tr(f"Glucosa {glucose:.0f} mg/dL", f"Glucose {glucose:.0f} mg/dL")
        if glucose < 54 or glucose > 250:
            out.append(_alert("glucose-crit", 3, tr("Glucosa fuera de rango seguro", "Glucose outside the safe range"), g + tr(" (referencia segura 54–250).", " (safe reference 54–250)."),
                              [tr("Si es baja: toma 15 g de azúcar rápida y vuelve a medir en 15 min.", "If low: take 15 g of fast sugar and measure again in 15 min."),
                               tr("Avisa al oficial médico ahora.", "Tell the medical officer now."),
                               tr("Se envía un reporte prioritario a Tierra.", "A priority report is sent to Earth.")], "distance", "Wellness", [g]))
        elif glucose < 70 or glucose > 180:
            out.append(_alert("glucose", 2, tr("Glucosa baja", "Low glucose") if glucose < 70 else tr("Glucosa alta", "High glucose"), g + tr(" (referencia 70–140).", " (reference 70–140)."),
                              [tr("Si es baja: come algo con azúcar y vuelve a medir.", "If low: eat something sugary and measure again."),
                               tr("Si es alta: revisa cuándo comiste y vuelve a medir en 2 h.", "If high: check when you last ate and measure again in 2 h."),
                               tr("Avisa al oficial médico.", "Tell the medical officer.")], "distance", "Wellness", [g]))
        elif glucose > 140:
            out.append(_alert("glucose-elev", 1, tr("Glucosa algo alta", "Slightly high glucose"), g + tr(" (referencia 70–140).", " (reference 70–140)."),
                              [tr("Anota cuándo comiste.", "Write down when you ate."), tr("Vuelve a medir antes de la próxima comida.", "Measure again before your next meal.")],
                              "distance", "Wellness"))

    if last:
        sleep, mood, stress = last.get("sleep_hours"), last.get("mood"), last.get("stress")
        low_sleep = sleep is not None and sleep < 6
        low_mood = (mood is not None and mood <= 2) or (stress is not None and stress >= 4)
        ev = [tr(f"sueño {sleep} h", f"sleep {sleep} h"), tr(f"ánimo {mood}/5", f"mood {mood}/5"), tr(f"tensión {stress}/5", f"stress {stress}/5")]
        if low_sleep and low_mood:
            out.append(_alert("isolation", 2, tr("Poco sueño y ánimo bajo", "Little sleep and low mood"),
                              tr(f"Dormiste {sleep} h y registraste ánimo {mood}/5, tensión {stress}/5. Juntos son una señal típica del aislamiento.",
                                 f"You slept {sleep} h and logged mood {mood}/5, stress {stress}/5. Together they are a typical sign of isolation."),
                              [tr("Habla con el oficial médico o con un compañero de confianza.", "Talk to the medical officer or a crewmate you trust."),
                               tr("Programa una pausa sin pantallas antes de dormir.", "Plan a screen-free break before sleeping."),
                               tr("Haz la respiración guiada 4·6.", "Do the guided 4·6 breathing.")], "isolation", "Wellness", ev))
        elif low_sleep and hr_up:
            msg = hr["message"][0].lower() + hr["message"][1:]
            out.append(_alert("fatigue", 1, tr("Fatiga probable", "Likely fatigue"), tr(f"Dormiste {sleep} h y {msg}", f"You slept {sleep} h and {msg}"),
                              [tr("Evita el ejercicio intenso hoy.", "Avoid intense exercise today."),
                               tr("Toma una siesta corta (20 min) si la agenda lo permite.", "Take a short nap (20 min) if the schedule allows.")], "isolation", "Exercise Coach",
                              [ev[0], tr(f"z pulso = {hr.get('z')}", f"heart z = {hr.get('z')}")]))
        elif low_sleep:
            out.append(_alert("sleep", 1, tr("Poco sueño", "Little sleep"), tr(f"Dormiste {sleep} h (lo recomendado es 7–9 h).", f"You slept {sleep} h (7–9 h is recommended)."),
                              [tr("Reduce la luz y las pantallas antes de dormir.", "Reduce light and screens before sleeping."),
                               tr("Mantén el mismo horario de sueño.", "Keep the same sleep schedule.")], "isolation", "Wellness"))
        elif low_mood:
            out.append(_alert("mood", 1, tr("Ánimo bajo o tensión alta", "Low mood or high stress"), tr(f"Registraste ánimo {mood}/5 y tensión {stress}/5.", f"You logged mood {mood}/5 and stress {stress}/5."),
                              [tr("Haz la respiración guiada 4·6.", "Do the guided 4·6 breathing."),
                               tr("Comparte cómo te sientes con la tripulación.", "Share how you feel with the crew.")], "isolation", "Wellness"))
    else:
        out.append({**_alert("checkin", 1, tr("Falta tu chequeo diario", "Daily check-in missing"),
                             tr("Hoy no registraste sueño, ánimo ni glucosa.", "You have not logged sleep, mood or glucose today."),
                             [tr("Completa el chequeo diario en Bienestar (1 minuto).", "Complete the daily check-in in Wellness (1 minute).")], "isolation", "Wellness"),
                    "level": 0, "level_title": level_title(0), "who": who(0)})

    out.sort(key=lambda a: -a["level"])
    return out


# --------------------------------------------------------------------------- #
# Reporte para los médicos en Tierra
# --------------------------------------------------------------------------- #
REPORT_EVERY_S = 6 * 3600


def build_report(astronaut_id: str, base: dict, sample: dict, vitals: dict, checkins: list[dict],
                 alerts: list[dict], raw_samples: list[dict], now: float | None = None) -> dict:
    now = now or time.time()
    max_level = max((a["level"] for a in alerts), default=0)
    if max_level >= 2:
        trigger, generated = tr(f"Automático por alerta de nivel {max_level}", f"Automatic, level {max_level} alert"), now
    else:
        trigger, generated = tr("Programado (cada 6 h)", "Scheduled (every 6 h)"), (now // REPORT_EVERY_S) * REPORT_EVERY_S
    signals = base.get("signals", {})
    last_checkin = next(iter(checkins), None)
    report = {
        "astronaut_id": astronaut_id,
        "generated_ts": generated,
        "trigger": trigger,
        "priority": (tr("Prioritario", "Priority") if max_level >= 3 else tr("Atención", "Attention") if max_level == 2
                     else tr("Rutina", "Routine")),
        "max_level": max_level,
        "data_source": {"ecg": sample.get("source"), "vitals": (vitals.get("latest_bp") or {}).get("source"),
                        "checkin": "manual" if last_checkin else None},
        "summary": {
            key: {"base": s.get("center"), "now": s.get("current") if s.get("current") is not None else sample.get(key),
                  "level": s.get("level"), "z": s.get("z")}
            for key, s in signals.items()
        },
        "vitals": {"bp": vitals.get("latest_bp"), "temp": vitals.get("latest_temp")},
        "checkin": last_checkin,
        "alerts": [{"level": a["level"], "title": a["title"], "reason": a["reason"]} for a in alerts if a["level"] >= 1],
        "recommendation": (alerts[0]["actions"][0] if alerts and alerts[0]["level"] >= 1
                           else tr("Sin cambios relevantes: mantener rutina.", "No relevant changes: keep routine.")),
    }
    # Con conectividad limitada se envía el resumen, no todos los datos crudos.
    report["size_bytes"] = len(json.dumps(report, ensure_ascii=False).encode())
    report["raw_bytes"] = len(json.dumps(raw_samples).encode())
    return report
