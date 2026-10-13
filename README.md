# claude-agy-statusbar

Two status bars for AI coding CLIs: **Claude Code** and **Antigravity (`agy`)**.
See your 5-hour and weekly limits, context fill, prompt cache and handoff state without asking the model anything: zero AI queries, zero tokens.

🇬🇧 [English](#english) · 🇵🇱 [Polski](#polski)

```
👤 user@example.com │ 📁 my-project (⎇ main) │ ⏳ 5h [██░░░░░░] 24% (↻4h24) │ 📅 Tydzień 63% (↻3d4h) │ 🧠 claude-opus-5-5
🟢 Cache: aktywny (~55m) │ 📊 Ctx [██░░░░░░░░] 21% (210k/1.0M) │ 🐾 Krok: 42 │ 📝 Handoff: OK (~2h05) 🤖 auto
```
<sub>cache-bar above the Claude Code prompt</sub>

```
[my-session] ⚡ claude zużyte: 5h:24% 7d:63%   │ 14:05
[agy-session] ⚡ agy zużyte: 5h:12% 7d:40%     │ 14:05
```
<sub>licznik-tokenow in the tmux status line, for Claude and agy sessions</sub>

---

## English

The repository holds two independent tools. Use either one, or both.

| Folder | What it is | Works with |
| --- | --- | --- |
| [`cache-bar/`](cache-bar) | A Claude Code plugin: a two-line bar above the prompt | Claude Code |
| [`licznik-tokenow/`](licznik-tokenow) | A token counter: a tmux status line plus the `tokeny` command | Claude Code, agy, any CLI in tmux |

The UI labels are in Polish. The glossary below explains them.

### cache-bar: Claude Code bar

**Line 1:** account, project folder with git branch, 5-hour limit with reset time, weekly limit, model. On an API key without a subscription, the bar shows the cost in $ instead of the limits.

**Line 2:**
- **Cache:** `aktywny` (warm) → `chłodzenie` (cooling, under 15 min left) → `zimny` (cold). The time is an estimate counted from the last model reply; the subscription cache lives about 1 hour.
- **Ctx:** how full the context window is. Green, yellow from 25%, red from 35%.
- **Krok:** number of your messages in the session.
- **Handoff:** `zapisano` (saved: a file in `session-logs/` younger than 20 min), `zalecany` (advised), `wymagany!` (required). When advised or required, a **[ Handoff ]** button appears.

**Automatic handoff (`🤖 auto`):** past the "required" threshold, the bar asks Claude to save a handoff to `session-logs/`, waits for the file, then runs `/clear` and `pickup`. It gives up after 3 replies with no file. It skips the cycle if you saved a handoff by hand less than 20 minutes ago.
`/handoff-auto off` switches it off and keeps the button; `/handoff-auto on` switches it back on. The setting is remembered.

The handoff prompts expect skills named `session-handoff` and `pickup`. Without them, the button still sends the request, but Claude has no ready recipe to follow.

**Install:**
```bash
claude plugin marketplace add Wolfgangplbtc/claude-agy-statusbar
claude plugin install cache-bar@claude-agy-statusbar
```

**Settings** at the top of [`cache-bar/hooks/register.tsx`](cache-bar/hooks/register.tsx): `CACHE_TTL_MS` (60 min), `CACHE_COOLING_MIN` (15), `DOMYSLNE_PROGI` (handoff 35%, advise 25%), `FRESH_HANDOFF_MIN` (20), `MAX_WAIT_TURNS` (3), `HANDOFF_PROMPT`.

**Side effect:** after each reply, the plugin writes `~/.claude/stan-sesji/<session-id>.json` (context, cache, limits, handoff state) so other tools can read it. It reads your account e-mail from `~/.claude.json` only to display it on your own screen; nothing leaves your machine.

### licznik-tokenow: tmux bar for Claude and agy

A Python 3 and bash script, with no dependencies.
- **Claude Code:** registered as a `statusLine` command. Claude Code passes the session JSON on stdin; the script saves the 5h and weekly limits to a local cache. It prints nothing under the prompt, because the numbers go to the tmux bar.
- **agy:** reads `agy --print /usage` in the background, at most every 25 s, and never blocks the terminal. It checks only the modification time of the agy login file to notice a re-login; it never reads the token itself.
- **tmux:** `tokeny --tmux '<session>'` prints a coloured line: green under 65%, yellow from 65%, red from 85%. The bar shows **used** percentages, like the official apps.

**Install:**
```bash
git clone https://github.com/Wolfgangplbtc/claude-agy-statusbar.git ~/claude-agy-statusbar
mkdir -p ~/.local/bin
ln -s ~/claude-agy-statusbar/licznik-tokenow/bin/tokeny ~/.local/bin/tokeny
```
1. **Claude Code:** in `~/.claude/settings.json`:
   ```json
   "statusLine": { "type": "command", "command": "~/claude-agy-statusbar/licznik-tokenow/skrypty/claude-statusline.sh" }
   ```
   If you also use cache-bar, both run together: cache-bar draws above the prompt and this script feeds the tmux bar.
2. **tmux:** copy the lines from [`licznik-tokenow/tmux.conf.przyklad`](licznik-tokenow/tmux.conf.przyklad) into `~/.tmux.conf`, then run `tmux source-file ~/.tmux.conf`.
3. **Command line:** `tokeny` prints a report, `tokeny --json` prints JSON, and `tokeny --refresh` refreshes after you log into another account.

The bar picks Claude or agy by the tmux session: a session whose name contains `claude`, or whose pane runs `claude`, shows Claude limits; anything else shows agy limits.

**Where data goes:** `$AGENT_HUB_DIR/stan/` (default `~/agent-hub/stan/`, the author's Agent Hub layout) when that folder exists and is writable, otherwise `/tmp`. To keep the data elsewhere, create a `stan/` folder and point `AGENT_HUB_DIR` at its parent.

### Glossary of bar labels
`zużyte` used · `Tydzień` week · `aktywny / chłodzenie / zimny` warm / cooling / cold · `Krok` turn · `zapisano / zalecany / wymagany` saved / advised / required · `ręcznie` manual

### Requirements
- cache-bar: a Claude Code version with plugin UI hooks (`ui.render`).
- licznik-tokenow: Linux or macOS, `python3`, `bash`, `tmux`; optionally `agy`.

License: [MIT](LICENSE).

---

## Polski

W repozytorium są dwa niezależne narzędzia. Możesz używać jednego albo obu.

| Folder | Co to jest | Działa z |
| --- | --- | --- |
| [`cache-bar/`](cache-bar) | Wtyczka Claude Code: pasek w dwóch liniach nad polem wpisywania | Claude Code |
| [`licznik-tokenow/`](licznik-tokenow) | Licznik tokenów: pasek na dole tmux i polecenie `tokeny` | Claude Code, agy, każde CLI w tmux |

Żadne z nich nie wysyła zapytań do modelu i nie zużywa tokenów.

### cache-bar: pasek w Claude Code

**Linia 1:** konto, folder projektu z gałęzią git, limit 5-godzinny z czasem do odnowienia, limit tygodniowy, model. Na kluczu API bez subskrypcji zamiast limitów widać koszt w $.

**Linia 2:**
- **Cache:** 🟢 aktywny → 🟡 chłodzenie (zostało mniej niż 15 min) → ❄ zimny. Czas to szacunek liczony od ostatniej odpowiedzi modelu; przy subskrypcji cache żyje około godziny.
- **Ctx:** zapełnienie okna kontekstu. Zielony, żółty od 25%, czerwony od 35%.
- **Krok:** liczba twoich wiadomości w sesji.
- **Handoff:** `zapisano` (w `session-logs/` jest plik młodszy niż 20 min), `zalecany`, `wymagany!`. Przy dwóch ostatnich pojawia się przycisk **[ Handoff ]**.

**Automatyczny handoff (`🤖 auto`):** po przekroczeniu progu „wymagany” pasek sam prosi Claude'a o zapis przekazania do `session-logs/`. Czeka na plik, potem robi `/clear` i `pickup`. Jeśli plik nie powstanie po 3 odpowiedziach, odpuszcza i wyświetla komunikat. Nie startuje, jeśli przekazanie zapisałeś ręcznie mniej niż 20 minut temu.
`/handoff-auto off` wyłącza automat i zostawia przycisk, a `/handoff-auto on` włącza go z powrotem. Ustawienie jest zapamiętywane.

Teksty wysyłane do Claude'a zakładają, że masz skille `session-handoff` i `pickup`. Bez nich przycisk dalej wysyła prośbę, ale Claude nie ma gotowego przepisu, jak ją wykonać.

**Instalacja:**
```bash
claude plugin marketplace add Wolfgangplbtc/claude-agy-statusbar
claude plugin install cache-bar@claude-agy-statusbar
```

**Ustawienia** są na początku pliku [`cache-bar/hooks/register.tsx`](cache-bar/hooks/register.tsx):
- `CACHE_TTL_MS`: czas życia cache'u, 60 min;
- `CACHE_COOLING_MIN`: od kiedy cache „się chłodzi”, 15 min;
- `DOMYSLNE_PROGI`: handoff przy 35%, zalecenie przy 25%;
- `FRESH_HANDOFF_MIN`: wiek pliku, który liczy się jako „zapisano”, 20 min;
- `MAX_WAIT_TURNS`: ile odpowiedzi automat czeka na plik, 3;
- `HANDOFF_PROMPT`: treść prośby o przekazanie.

Jeśli masz Agent Hub, progi bierze z `nadzor.conf` (`PROG_PRZEKAZANIA`, `PROG_OSTRZEZENIA`).

**Skutek uboczny:** po każdej odpowiedzi wtyczka zapisuje `~/.claude/stan-sesji/<id-sesji>.json` (kontekst, cache, limity, stan handoffu), żeby mogły go czytać inne narzędzia. Adres e-mail konta czyta z `~/.claude.json` tylko po to, żeby pokazać go na twoim ekranie. Nic nie wychodzi z komputera.

### licznik-tokenow: pasek tmux dla Claude i agy

Skrypt w Pythonie 3 i bashu, bez dodatkowych bibliotek.
- **Claude Code:** działa jako polecenie `statusLine`. Claude Code przekazuje na stdin JSON sesji, a skrypt zapisuje limity 5h i tygodniowy w lokalnej pamięci podręcznej. Pod promptem nic nie wypisuje, bo liczby trafiają na pasek tmux.
- **agy:** odczytuje `agy --print /usage` w tle, najwyżej co 25 s, i nigdy nie blokuje terminala. Z pliku logowania agy sprawdza tylko datę zmiany, żeby zauważyć przelogowanie. Samego tokenu nie czyta.
- **tmux:** `tokeny --tmux '<sesja>'` wypisuje kolorową linię: zielony poniżej 65%, żółty od 65%, czerwony od 85%. Pasek pokazuje procent **zużyty**, tak jak aplikacje Claude i Gemini.

**Instalacja:**
```bash
git clone https://github.com/Wolfgangplbtc/claude-agy-statusbar.git ~/claude-agy-statusbar
mkdir -p ~/.local/bin
ln -s ~/claude-agy-statusbar/licznik-tokenow/bin/tokeny ~/.local/bin/tokeny
```
1. **Claude Code:** dopisz w `~/.claude/settings.json`:
   ```json
   "statusLine": { "type": "command", "command": "~/claude-agy-statusbar/licznik-tokenow/skrypty/claude-statusline.sh" }
   ```
   Z cache-barem działa równolegle: cache-bar rysuje pasek nad promptem, a ten skrypt zasila pasek tmux.
2. **tmux:** przepisz linie z [`licznik-tokenow/tmux.conf.przyklad`](licznik-tokenow/tmux.conf.przyklad) do `~/.tmux.conf`, potem uruchom `tmux source-file ~/.tmux.conf`.
3. **Wiersz poleceń:**
   - `tokeny`: raport;
   - `tokeny --json`: dane w JSON;
   - `tokeny --refresh`: odświeżenie po zalogowaniu na inne konto.

Pasek sam rozpoznaje, czy pokazać Claude, czy agy, po sesji tmux. Sesja, która ma `claude` w nazwie albo w której działa `claude`, pokazuje limity Claude. Każda inna pokazuje limity agy.

**Gdzie trafiają dane:** do `$AGENT_HUB_DIR/stan/` (domyślnie `~/agent-hub/stan/`, układ z Agent Hub autora), jeśli taki folder istnieje i można do niego pisać. W przeciwnym razie trafiają do `/tmp`. Żeby trzymać dane gdzie indziej, załóż folder `stan/` i ustaw `AGENT_HUB_DIR` na folder nad nim.

### Wymagania
- cache-bar: wersja Claude Code z obsługą wtyczek interfejsu (`ui.render`).
- licznik-tokenow: Linux albo macOS, `python3`, `bash`, `tmux`; opcjonalnie `agy`.

Licencja: [MIT](LICENSE).
