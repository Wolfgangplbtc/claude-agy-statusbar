---
name: licznik-tokenow
description: Lokalny licznik i monitor zużycia tokenów w czasie rzeczywistym bez wysyłania zapytań do modeli AI. Działa z Claude, Antigravity (agy) oraz Codex.
---

# Licznik Tokenów (Token Tracker)

Wtyczka do ciągłego, bezkosztowego monitorowania zużycia tokenów i limitów puli w agentach CLI (Claude Code, Antigravity / agy, Codex) bez odpytywania modelu AI.

## Jak to działa (Zero AI Queries)

1. **Claude Code**: Wykorzystuje natywny mechanizm `statusLine`. Środowisko Claude Code podczas każdej interakcji przekazuje do skryptu przez `stdin` pełny obiekt JSON z metrykami sesji:
   - procent zużycia limitu 5-godzinnego (`five_hour`)
   - procent zużycia limitu 7-dniowego (`seven_day`)
   - czas odnowienia (`resets_at`)
   - całkowity koszt sesji (`total_cost_usd`)
   - liczbę tokenów wejściowych i wyjściowych
   Skrypt zapisuje te dane natychmiast do pliku stanu i zwraca zwięzłą belkę do terminala.

2. **Antigravity (agy)**: Wykorzystuje zdarzenia cyklu życia `hooks.json` (`PostToolUse`, `Stop`) oraz lokalną pamięć podręczną limitów. Nie konsumuje żadnych tokenów kontekstu.

3. **Codex / Dowolne CLI**: Zapewnia polecenie `tokeny`, które natychmiast wyświetla stan tokenów z lokalnego pliku cache w czasie poniżej 5 ms.

## Użycie z linii poleceń

```bash
tokeny           # Wyświetla aktualne zużycie tokenów i czas odnowienia
tokeny --json    # Zwraca dane w formacie JSON
```
