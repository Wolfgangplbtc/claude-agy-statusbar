#!/usr/bin/env python3
"""Lokalny raport i licznik tokenow bez zapytan do modeli AI.
Obsluguje wejscie ze statusLine Claude Code, hooki agy oraz wywolania CLI.
"""
import sys
import os
import json
import time
import socket
import re

# Pamiec podreczna odczytu "agy --print /usage" (limity Gemini serwera). Domyslnie /tmp;
# test (testy/test_licznik_tokenow.py) podaje wlasny katalog, zeby nie ruszac danych serwera.
KAT_PODRECZNY = os.environ.get("TOKENY_KATALOG") or "/tmp"
CACHE_AGY = os.path.join(KAT_PODRECZNY, "tokeny-statusline.cache")
LOCK_AGY = os.path.join(KAT_PODRECZNY, "tokeny-refresh.lock")
HDIR_HOST = os.environ.get("AGENT_HUB_DIR") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

def znajdz_katalog_stanu():
    # Sprawdz najpierw sciezke z wewnatrz kontenera (/narzedzia/stan)
    if os.path.isdir("/narzedzia/stan") and os.access("/narzedzia/stan", os.W_OK):
        return "/narzedzia/stan"
    # Sprawdz katalog na hoscie
    for h in [os.path.join(HDIR_HOST, "stan"), os.path.expanduser("~/agent-hub/stan")]:
        if os.path.isdir(h) and os.access(h, os.W_OK):
            return h
    # Awaryjnie /tmp
    return "/tmp"

def ustal_nazwe_agenta():
    env_name = os.environ.get("AGENT_NAME") or os.environ.get("AGENT")
    if env_name:
        return env_name
    for sciezka in ["/root/.agent_name", os.path.expanduser("~/.agent_name")]:
        if os.path.isfile(sciezka):
            try:
                with open(sciezka) as f:
                    n = f.read().strip()
                if n:
                    return n
            except Exception:
                pass
    host = socket.gethostname()
    if re.fullmatch(r"agent[0-9]+", host):
        return host
    return "claude-host" if not host.startswith("agent") else host

def parsuj_claude_stdin(dane_raw):
    try:
        d = json.loads(dane_raw)
    except Exception:
        return None

    # Claude Code statusline payload
    model = d.get("model", "")
    cost = 0.0
    if isinstance(d.get("cost"), dict):
        cost = float(d["cost"].get("total_cost_usd", 0.0))
    elif isinstance(d.get("cost"), (int, float)):
        cost = float(d["cost"])

    # Rate limits
    limits = d.get("rate_limits") or {}
    fh = limits.get("five_hour") or {}
    sd = limits.get("seven_day") or {}

    fh_used = fh.get("used_percentage")
    if fh_used is None and "used_percentage" in d:
        fh_used = d.get("used_percentage")
    sd_used = sd.get("used_percentage")

    fh_reset = fh.get("resets_at") or ""
    sd_reset = sd.get("resets_at") or ""

    # Oblicz ile pozostalo
    fh_left = round(100.0 - float(fh_used), 1) if fh_used is not None else None
    sd_left = round(100.0 - float(sd_used), 1) if sd_used is not None else None

    # Context window & tokens
    cw = d.get("context_window") or {}
    tok_in = d.get("usage", {}).get("input_tokens") or cw.get("input_tokens", 0)
    tok_out = d.get("usage", {}).get("output_tokens") or cw.get("output_tokens", 0)

    return {
        "model": model,
        "koszt_usd": cost,
        "pula_5h_zostalo": fh_left,
        "pula_7d_zostalo": sd_left,
        "pula_5h_zuzyte": fh_used,
        "pula_7d_zuzyte": sd_used,
        "odnowa_5h": str(fh_reset),
        "odnowa_7d": str(sd_reset),
        "tokeny_wejscie": tok_in,
        "tokeny_wyjscie": tok_out,
        "czas": int(time.time()),
        "zrodlo": "claude-statusline"
    }

def zapisz_stan(agent, dane, kat_stanu):
    plik = os.path.join(kat_stanu, f"tokeny-{agent}.json")
    plik_tmp = plik + ".tmp"
    try:
        with open(plik_tmp, "w", encoding="utf-8") as f:
            json.dump(dane, f, indent=2, ensure_ascii=False)
        os.replace(plik_tmp, plik)
    except Exception as e:
        pass

    # W kontenerze zapisz rowniez do /root/.stan-tokenow.json
    for root_sciezka in ["/root/.stan-tokenow.json", os.path.expanduser("~/.stan-tokenow.json")]:
        try:
            with open(root_sciezka + ".tmp", "w", encoding="utf-8") as f:
                json.dump(dane, f, indent=2, ensure_ascii=False)
            os.replace(root_sciezka + ".tmp", root_sciezka)
        except Exception:
            pass

    # Jesli to Claude, zaktualizuj limity-claude.cache
    if dane.get("zrodlo") == "claude-statusline":
        cache_cl = os.path.join(kat_stanu, "limity-claude.cache")
        tmp_cl = cache_cl + ".tmp"
        p5 = dane.get("pula_5h_zostalo")
        pt = dane.get("pula_7d_zostalo")
        o5 = dane.get("odnowa_5h", "")
        ot = dane.get("odnowa_7d", "")
        try:
            with open(tmp_cl, "w", encoding="utf-8") as f:
                f.write(f"sesja|{p5 if p5 is not None else ''}|{o5}\n")
                f.write(f"tydzien|{pt if pt is not None else ''}|{ot}\n")
            os.replace(tmp_cl, cache_cl)
        except Exception:
            pass

def formatuj_statusline(dane):
    cz = []
    p5 = dane.get("pula_5h_zostalo")
    pt = dane.get("pula_7d_zostalo")
    k = dane.get("koszt_usd", 0.0)

    if p5 is not None:
        cz.append(f"5h:{int(p5)}%")
    if pt is not None:
        cz.append(f"7d:{int(pt)}%")
    if k > 0:
        cz.append(f"${k:.2f}")

    if not cz:
        return "⚡ tokeny: aktywne"
    return "⚡ " + " | ".join(cz)

def pobierz_oauth_mtime():
    for p in [
        os.path.expanduser("~/.gemini/antigravity-cli/antigravity-oauth-token"),
        "/root/.gemini/antigravity-cli/antigravity-oauth-token"
    ]:
        if os.path.exists(p):
            try:
                return os.path.getmtime(p)
            except Exception:
                pass
    return 0

def odswiez_host_agy_synchronicznie():
    data = {"timestamp": time.time(), "token_mtime": pobierz_oauth_mtime()}
    try:
        import subprocess, shutil
        agy_cmd = shutil.which("agy") or os.path.expanduser("~/.local/bin/agy")
        u = subprocess.run([agy_cmd, "--print", "/usage"], capture_output=True, text=True, timeout=12).stdout
        g_week, g_five, c_week, c_five = None, None, None, None
        for l in u.splitlines():
            low = l.lower()
            if "gemini" in low:
                m = re.search(r"(\d+)%", l)
                if m:
                    if "five" in low or "5h" in low or "5 hour" in low:
                        g_five = int(m.group(1))
                    elif "week" in low or "7d" in low:
                        g_week = int(m.group(1))
            elif "claude" in low or "gpt" in low:
                m = re.search(r"(\d+)%", l)
                if m:
                    if "five" in low or "5h" in low or "5 hour" in low:
                        c_five = int(m.group(1))
                    elif "week" in low or "7d" in low:
                        c_week = int(m.group(1))

        if g_week is not None:
            data["gem_7d"] = g_week
            data["gem_5h"] = g_five if g_five is not None else 100
        if c_week is not None:
            data["cl_7d"] = c_week
            data["cl_5h"] = c_five if c_five is not None else 100
    except Exception as e:
        data["error"] = str(e)

    try:
        with open(CACHE_AGY + ".tmp", "w") as f:
            json.dump(data, f)
        os.replace(CACHE_AGY + ".tmp", CACHE_AGY)
    except Exception:
        pass
    return data

def pobierz_quota_agy():
    try:
        import subprocess, shutil
        agy_cmd = shutil.which("agy") or os.path.expanduser("~/.local/bin/agy")
        u = subprocess.run([agy_cmd, "--print", "/usage"], capture_output=True, text=True, timeout=8).stdout
        def szukaj(grupa, okres):
            for l in u.splitlines():
                if grupa.lower() in l.lower() and okres.lower() in l.lower():
                    m = re.search(r"(\d+)%", l)
                    odn = ""
                    mo = re.search(r"\d+%\s+(\S+)", l)
                    if mo: odn = mo.group(1)
                    if m:
                        return int(m.group(1)), odn
            return None, ""
        gw, gwo = szukaj("Gemini", "Weekly")
        g5, g5o = szukaj("Gemini", "Five")
        cw, cwo = szukaj("Claude", "Weekly")
        c5, c5o = szukaj("Claude", "Five")
        if gw is not None or g5 is not None or cw is not None:
            if g5 is None and gw is not None:
                g5 = 100
            if c5 is None and cw is not None:
                c5 = 100
            return {
                "typ": "agy",
                "gemini_5h_zostalo": g5,
                "gemini_5h_odnowa": g5o,
                "gemini_7d_zostalo": gw,
                "gemini_7d_odnowa": gwo,
                "claude_5h_zostalo": c5,
                "claude_5h_odnowa": c5o,
                "claude_7d_zostalo": cw,
                "claude_7d_odnowa": cwo,
                "czas": int(time.time()),
                "zrodlo": "agy-cli-usage"
            }
    except Exception:
        pass
    return None

def czy_sesja_to_claude(nazwa):
    if not nazwa:
        return False
    if "claude" in nazwa.lower():
        return True
    try:
        import subprocess
        r = subprocess.run(["tmux", "list-panes", "-t", nazwa, "-F", "#{pane_current_command}"],
                           capture_output=True, text=True, timeout=1)
        if r.returncode == 0 and "claude" in r.stdout.lower():
            return True
    except Exception:
        pass
    return False

def pobierz_limity_dla_sesji_lub_agenta(nazwa=""):
    import subprocess
    nazwa = (nazwa or "").strip()
    agent = None
    if re.fullmatch(r"agent[0-9]+", nazwa):
        agent = nazwa
    else:
        m = re.search(r"agent([0-9]+)", nazwa)
        if m:
            agent = f"agent{m.group(1)}"
        elif nazwa:
            try:
                for pl in [os.path.join(HDIR_HOST, "projects.list"), os.path.expanduser("~/agent-hub/projects.list")]:
                    if os.path.isfile(pl):
                        with open(pl) as f:
                            for l in f:
                                parts = l.strip().split("|")
                                if len(parts) >= 2 and parts[0] == nazwa:
                                    agent = parts[1]
                                    break
                        if agent: break
            except Exception:
                pass

    if not agent:
        cur = ustal_nazwe_agenta()
        if cur and cur.startswith("agent"):
            agent = cur
        elif czy_sesja_to_claude(nazwa):
            agent = "host_claude"
        else:
            agent = "host_agy"

    if agent.startswith("agent"):
        # 1. Odczytaj limity.cache
        try:
            lim_plik = next((p for p in [os.path.join(HDIR_HOST, "stan", "limity.cache"), os.path.expanduser("~/agent-hub/stan/limity.cache")] if os.path.isfile(p)), None)
            if lim_plik:
                with open(lim_plik) as f:
                    for l in f:
                        cz = l.strip().split("|")
                        if len(cz) >= 3 and cz[0] == agent:
                            def val(idx):
                                try:
                                    v = float(cz[idx])
                                    return int(v) if v.is_integer() else v
                                except Exception:
                                    return cz[idx] if len(cz) > idx else "—"
                            g7 = val(1)
                            g5 = val(3) if len(cz) > 3 and cz[3] else g7
                            c7 = val(5) if len(cz) > 5 and cz[5] else g7
                            c5 = val(7) if len(cz) > 7 and cz[7] else g5
                            return {
                                "agent": agent,
                                "typ": "agy",
                                "gem_5h": g5,
                                "gem_7d": g7,
                                "cl_5h": c5,
                                "cl_7d": c7,
                                "zrodlo": "limity.cache"
                            }
        except Exception:
            pass

        # 2. Fallback z kontenera
        try:
            r = subprocess.run(["docker", "exec", agent, "cat", "/root/.stan-tokenow.json"],
                               capture_output=True, text=True, timeout=3)
            if r.returncode == 0 and r.stdout.strip():
                d = json.loads(r.stdout)
                p5 = d.get("pula_5h_zostalo")
                pt = d.get("pula_7d_zostalo")
                return {
                    "agent": agent,
                    "typ": "agy",
                    "gem_5h": p5,
                    "gem_7d": pt,
                    "cl_5h": p5,
                    "cl_7d": pt,
                    "zrodlo": "docker-stan-tokenow"
                }
        except Exception:
            pass

    if agent == "host_claude":
        cl_5h, cl_7d = 100, 0
        try:
            cl_plik = next((p for p in [os.path.join(HDIR_HOST, "stan", "limity-claude.cache"), os.path.expanduser("~/agent-hub/stan/limity-claude.cache")] if os.path.isfile(p)), None)
            if cl_plik:
                with open(cl_plik) as f:
                    for l in f:
                        cz = l.strip().split("|")
                        if len(cz) >= 2:
                            if cz[0] == "sesja": cl_5h = cz[1]
                            elif cz[0] == "tydzien": cl_7d = cz[1]
        except Exception:
            pass
        return {
            "agent": "host_claude",
            "typ": "claude",
            "gem_5h": "—",
            "gem_7d": "—",
            "cl_5h": cl_5h,
            "cl_7d": cl_7d,
            "zrodlo": "limity-claude.cache"
        }

    # Host agy
    cache_file = CACHE_AGY
    data = {}
    last_update = 0
    token_mtime = 0
    if os.path.exists(cache_file):
        try:
            with open(cache_file) as f:
                data = json.load(f)
            last_update = data.get("timestamp", 0)
            token_mtime = data.get("token_mtime", 0)
        except Exception:
            pass

    cur_token_mtime = pobierz_oauth_mtime()
    now = time.time()
    relog_wykryty = bool(cur_token_mtime) and cur_token_mtime > token_mtime
    # 01.10: nieudany odczyt (w cache brak "gem_7d") ponawialismy przy KAZDYM
    # zapytaniu i na czekajaco. Na serwerze bez zalogowanego agy "agy --print
    # /usage" wisi do limitu 12 s — kazde /api/tokeny trwalo 12 s, a czat pyta
    # co 5 s. Teraz ponawiamy w tle; bez tokenu agy (niezalogowany) co 5 min.
    nieudany = bool(data) and "gem_7d" not in data
    stary_cache = (now - last_update > (300 if (nieudany and not cur_token_mtime) else 25))

    # Przelogowanie (albo pierwsze logowanie) lub brak cache przy zalogowanym agy -> odswiez natychmiast
    if relog_wykryty or (not data and cur_token_mtime):
        data = odswiez_host_agy_synchronicznie()
    elif stary_cache or not data:
        # Odswiez w tle bez blokowania terminala
        lock_file = LOCK_AGY
        if not os.path.exists(lock_file) or (now - os.path.getmtime(lock_file) > 20):
            try:
                with open(lock_file, "w") as f:
                    f.write(str(os.getpid()))
                skrypt_path = os.path.abspath(__file__)
                subprocess.Popen(
                    [sys.executable, skrypt_path, "--refresh"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    stdin=subprocess.DEVNULL,
                    start_new_session=True
                )
            except Exception:
                pass

    return {
        "agent": "host",
        "typ": "agy",
        "gem_5h": data.get("gem_5h", 100),
        "gem_7d": data.get("gem_7d", "—"),
        "cl_5h": data.get("cl_5h", 100),
        "cl_7d": data.get("cl_7d", 100),
        "zrodlo": "host-agy-cache"
    }

def generuj_pasek(for_tmux=False, kontekst=""):
    d = pobierz_limity_dla_sesji_lub_agenta(kontekst)
    agent = d.get("agent", "tokeny")
    # Wlasciciel 28.09: pasek pokazuje ZUZYTE (jak aplikacje Claude i Gemini),
    # a dane (limity.cache, sztafeta) dalej licza "zostalo" — odwracamy tylko tu.
    def zuzyte(val):
        try: return str(max(0, min(100, round(100 - float(val)))))
        except (TypeError, ValueError): return "—"
    gem_5h = zuzyte(d.get("gem_5h", "—"))
    gem_7d = zuzyte(d.get("gem_7d", "—"))
    cl_5h = zuzyte(d.get("cl_5h", "—"))
    cl_7d = zuzyte(d.get("cl_7d", "—"))

    def color(val):
        if not for_tmux: return ""
        try: v = float(val)
        except: return "#[fg=colour244]"
        if v >= 85: return "#[fg=colour196,bold]"
        if v >= 65: return "#[fg=colour220,bold]"
        return "#[fg=colour82]"

    if for_tmux:
        g5_col = color(gem_5h)
        gt_col = color(gem_7d)
        c5_col = color(cl_5h)
        ct_col = color(cl_7d)
        rst = "#[default]"
        dim = "#[fg=colour244]"
        lbl = "#[fg=colour222,bold]"

        if agent.startswith("agent"):
            return f"{lbl}⚡ {agent} zużyte:{rst} {g5_col}5h:{gem_5h}%{rst} {gt_col}7d:{gem_7d}%{rst}"
        elif agent == "host_claude":
            return f"{lbl}⚡ claude zużyte:{rst} {c5_col}5h:{cl_5h}%{rst} {ct_col}7d:{cl_7d}%{rst}"
        else:
            return f"{lbl}⚡ agy zużyte:{rst} {g5_col}5h:{gem_5h}%{rst} {gt_col}7d:{gem_7d}%{rst}"
    else:
        if agent.startswith("agent"):
            return f"⚡ {agent} zużyte: 5h:{gem_5h}% 7d:{gem_7d}%"
        elif agent == "host_claude":
            return f"⚡ claude zużyte: 5h:{cl_5h}% 7d:{cl_7d}%"
        else:
            return f"⚡ agy zużyte: 5h:{gem_5h}% 7d:{gem_7d}%"

def main():
    agent = ustal_nazwe_agenta()
    kat_stanu = znajdz_katalog_stanu()

    # Wyciągnij kontekst (np. sesja lub agent przekazany jako argument)
    kontekst = ""
    for i, arg in enumerate(sys.argv[1:], 1):
        if not arg.startswith("--"):
            kontekst = arg
            break

    # Wymuszenie odswiezenia (np. po zalogowaniu na inne konto)
    if "--refresh" in sys.argv or "--odswiez" in sys.argv:
        odswiez_host_agy_synchronicznie()
        if not ("--statusline" in sys.argv or "--json" in sys.argv):
            print("✓ Pamięć podręczna limitów odświeżona.")
        return

    # Pasek stanu do tmux (pod spodem ekranu)
    if "--tmux" in sys.argv:
        print(generuj_pasek(for_tmux=True, kontekst=kontekst))
        return

    # Pasek statusline (jedna linia)
    if "--statusline" in sys.argv or "--short" in sys.argv or "--bar" in sys.argv:
        print(generuj_pasek(for_tmux=False, kontekst=kontekst))
        return

    # Sprawdz czy mamy dane ze stdin (statusLine)
    dane_raw = ""
    if not sys.stdin.isatty():
        try:
            dane_raw = sys.stdin.read().strip()
        except Exception:
            pass

    if dane_raw:
        wynik = parsuj_claude_stdin(dane_raw)
        if wynik:
            zapisz_stan(agent, wynik, kat_stanu)
            # 28.09 (wlasciciel): pod Claude'em nic nie wyswietlamy — procenty sa juz
            # na pasku tmux, a kwota "$976" (koszt po stawkach API, nie pobierany przy
            # subskrypcji) tylko myli. Dane dalej sie zapisuja (limity-claude.cache).
            return

    # Jesli flaga --json, zwroc pelny slownik
    if "--json" in sys.argv:
        wyniki = {}
        plik = os.path.join(kat_stanu, f"tokeny-{agent}.json")
        if os.path.isfile(plik):
            try:
                with open(plik, encoding="utf-8") as f:
                    wyniki["agent_cache"] = json.load(f)
            except Exception:
                pass
        quota = pobierz_quota_agy()
        if quota:
            wyniki["agy_quota"] = quota
        print(json.dumps(wyniki, indent=2, ensure_ascii=False))
        return

    # Wywolanie interaktywne CLI:
    print(f"=== Licznik Tokenów [{agent}] ===")

    # 1. Antigravity / Gemini Quota (jesli agy dostepny w sesji)
    quota = pobierz_quota_agy()
    if quota:
        g5 = quota.get('gemini_5h_zostalo')
        g7 = quota.get('gemini_7d_zostalo')
        c5 = quota.get('claude_5h_zostalo')
        c7 = quota.get('claude_7d_zostalo')
        print("• Antigravity (Gemini):")
        print(f"    Limit 5h: {g5}% pozostalo (odnowa: {quota.get('gemini_5h_odnowa')})")
        print(f"    Limit 7d: {g7}% pozostalo (odnowa: {quota.get('gemini_7d_odnowa')})")
        print(f"    Modele Claude/GPT: 5h: {c5}% | 7d: {c7}%")

    # 2. Stan z cache / statusline (Claude Code lub biezacy agent)
    plik = os.path.join(kat_stanu, f"tokeny-{agent}.json")
    if os.path.isfile(plik):
        try:
            with open(plik, encoding="utf-8") as f:
                d = json.load(f)
            p5 = d.get('pula_5h_zostalo')
            p5_str = f"{p5}%" if p5 is not None else "—"
            pt = d.get('pula_7d_zostalo')
            pt_str = f"{pt}%" if pt is not None else "—"
            o5 = d.get('odnowa_5h') or "—"
            ot = d.get('odnowa_7d') or "—"
            print("• Claude Code / Status:")
            print(f"    Limit 5h: {p5_str} pozostalo (odnowa: {o5})")
            print(f"    Limit 7d: {pt_str} pozostalo (odnowa: {ot})")
            if d.get("koszt_usd") is not None and d.get("koszt_usd") > 0:
                print(f"    Koszt sesji: ${d.get('koszt_usd'):.2f}")
        except Exception:
            pass
    elif not quota:
        print("⚡ Monitor tokenów aktywny (brak zarejestrowanych zużyć w tej sesji)")

if __name__ == "__main__":
    main()
