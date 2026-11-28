"""Native, read-only audit dashboard with a fixed one-hour deadline."""
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
import tkinter as tk

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'docs/allocation-progress/focused-audit-live.json'
REPORT = ROOT / 'docs/allocation-progress/focused-allocation-audit-report.txt'
BG, PANEL, TEXT = '#091321', '#122238', '#e8f2ff'
COLORS = ['#38ddc3', '#65a9ff', '#c596ff', '#ffbd69', '#ff718d', '#f5e878']


def main():
    root = tk.Tk()
    root.title('Duty Rota | Allocation audit • LIVE')
    root.geometry('1120x790')
    root.minsize(900, 680)
    root.configure(bg=BG)
    title = tk.Label(root, text='ALLOCATION ENGINE  /  FOCUSED AUDIT', bg=BG,
                     fg=TEXT, font=('Segoe UI', 22, 'bold'))
    title.pack(anchor='w', padx=26, pady=(22, 0))
    timer = tk.Label(root, bg=BG, fg=COLORS[0], font=('Consolas', 38, 'bold'))
    timer.pack(anchor='w', padx=26)
    phase = tk.Label(root, bg=BG, fg=TEXT, font=('Segoe UI', 13), wraplength=1040, justify='left')
    phase.pack(anchor='w', padx=28, pady=(0, 12))
    report_button = tk.Button(root, text='Open audit report', font=('Segoe UI', 11, 'bold'),
        bg='#243853', fg=TEXT, relief='flat', padx=15, pady=8, state='disabled',
        command=lambda: subprocess.Popen(['notepad.exe', str(REPORT)]))
    report_button.place(relx=1, x=-28, y=78, anchor='ne')
    canvas = tk.Canvas(root, bg=PANEL, highlightthickness=0, height=285)
    canvas.pack(fill='x', padx=26)
    charts = tk.Canvas(root, bg=PANEL, highlightthickness=0, height=145)
    charts.pack(fill='x', padx=26, pady=(12, 0))
    log = tk.Text(root, bg=PANEL, fg=TEXT, font=('Segoe UI', 11), relief='flat',
                  wrap='word', height=10, padx=16, pady=12)
    log.pack(fill='both', expand=True, padx=26, pady=16)
    footer = tk.Label(root, bg=BG, fg='#95aac3', font=('Segoe UI', 10),
                     text='LOCAL • No patient data • Verified results only • Countdown is a deadline, not a completion estimate')
    footer.pack(anchor='w', padx=26, pady=(0, 16))

    def refresh():
        try:
            state = json.loads(STATE.read_text(encoding='utf-8-sig'))
            now = datetime.now(timezone.utc)
            end = datetime.fromisoformat(state['deadline'])
            start = datetime.fromisoformat(state['started_at'])
            left = max(0, int((end-now).total_seconds()))
            timer.config(text=f'{left//60:02d}:{left%60:02d}  REMAINING' if left else '00:00  TIMEBOX CLOSED',
                         fg=COLORS[0] if left > 300 else COLORS[4])
            phase.config(text=state.get('phase', 'Inspecting'))
            report_button.config(state='normal' if REPORT.exists() else 'disabled')
            canvas.delete('all')
            width = max(850, canvas.winfo_width())
            elapsed = min(1, max(0, (now-start).total_seconds()/3600))
            canvas.create_text(20, 22, anchor='w', text='SESSION CLOCK', fill=TEXT, font=('Segoe UI', 11, 'bold'))
            canvas.create_rectangle(20, 43, width-20, 56, fill='#243853', outline='')
            canvas.create_rectangle(20, 43, 20+(width-40)*elapsed, 56, fill=COLORS[1], outline='')
            metrics = state.get('metrics', {})
            for i, (name, value) in enumerate(list(metrics.items())[:6]):
                x = 22 + (i % 3)*(width-44)/3
                y = 88 + (i//3)*85
                canvas.create_text(x, y, anchor='w', text=str(value), fill=COLORS[i], font=('Segoe UI', 25, 'bold'))
                canvas.create_text(x, y+30, anchor='w', text=name.upper(), fill='#adc2dc', font=('Segoe UI', 10))
            loads = state.get('loads', [])
            if loads:
                canvas.create_text(width*.60, 250, text='Latest fixture duties / person: '+', '.join(map(str, loads)),
                                   fill=COLORS[3], font=('Segoe UI', 11))
            charts.delete('all')
            w = max(850, charts.winfo_width())
            before = state.get('before_loads', [])
            if loads and before:
                charts.create_text(18, 18, anchor='w', text='VERIFIED FIXTURE / DUTIES PER MEMBER',
                                   fill=TEXT, font=('Segoe UI', 10, 'bold'))
                for i, (old, new) in enumerate(zip(before, loads)):
                    x = 35+i*100
                    charts.create_rectangle(x, 116-old*9, x+23, 116, fill=COLORS[4], outline='')
                    charts.create_rectangle(x+27, 116-new*9, x+50, 116, fill=COLORS[0], outline='')
                    charts.create_text(x+25, 131, text=f'P{i+1}  {old} → {new}', fill=TEXT, font=('Segoe UI', 9))
                charts.create_text(430, 48, anchor='w', text='Before', fill=COLORS[4], font=('Segoe UI', 10))
                charts.create_text(430, 73, anchor='w', text='After', fill=COLORS[0], font=('Segoe UI', 10))
            else:
                charts.create_text(18, 45, anchor='w', text='Distribution chart awaits verified fixture results', fill=TEXT)
            suites = state.get('suites', [])
            production = state.get('production_levels', [])
            if production:
                charts.delete('all')
                charts.create_text(18, 18, anchor='w', text=state.get('production_chart_title', 'PRODUCTION GAP: ALL / FULLY AVAILABLE POSTED'),
                                   fill=TEXT, font=('Segoe UI', 10, 'bold'))
                scale = min(11, 76 / max(1, max(level['raw_gap'] for level in production)))
                for i, level in enumerate(production):
                    x = 32 + i*90
                    raw, posted = level['raw_gap'], level['posted_gap']
                    charts.create_rectangle(x, 112-raw*scale, x+20, 112, fill=COLORS[4], outline='')
                    charts.create_rectangle(x+23, 112-posted*scale, x+43, 112, fill=COLORS[0], outline='')
                    charts.create_text(x+22, 130, text=f"{level['label']} {raw:g}/{posted:g}", fill=TEXT, font=('Segoe UI', 9))
                charts.create_line(20, 112-2*scale, 480, 112-2*scale, fill=COLORS[3], dash=(4, 3))
                charts.create_text(484, 112-2*scale, anchor='w', text='2', fill=COLORS[3])
            largest_suite = max((s['passed'] for s in suites[:3]), default=1) or 1
            for i, suite in enumerate(suites[:3]):
                x, y = w*.56, 35+i*37
                charts.create_text(x, y, anchor='w', text=suite['name'], fill=TEXT, font=('Segoe UI', 9))
                charts.create_rectangle(x+140, y-8, x+140+140*suite['passed']/largest_suite, y+5,
                                        fill=COLORS[i+1], outline='')
                charts.create_text(x+292, y, anchor='w', text=str(suite['passed']), fill=COLORS[i+1])
            log.config(state='normal')
            log.delete('1.0', 'end')
            log.insert('end', '\n\n'.join(state.get('events', [])[-8:]))
            log.see('end')
            log.config(state='disabled')
        except (OSError, ValueError, KeyError) as exc:
            phase.config(text=f'Waiting for readable audit state: {exc}')
        root.after(1000, refresh)
    refresh()
    root.mainloop()


if __name__ == '__main__':
    main()
