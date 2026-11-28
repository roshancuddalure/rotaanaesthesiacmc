"""Native light-themed dashboard for the bounded equality implementation session."""
import json
import argparse
import os
import tkinter as tk
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--state', default='docs/allocation-progress/equality-hour-live.json')
parser.add_argument('--report', default='docs/allocation-progress/equality-hour-report.txt')
args = parser.parse_args()
STATE = ROOT / args.state
COLORS = ['#087f8c', '#365bd6', '#8044bc', '#bd6600', '#c33567']


def main():
    root = tk.Tk()
    root.title('Duty Rota | Equality laboratory | Allocation audit')
    root.geometry('1150x860')
    root.minsize(950, 800)
    root.configure(bg='#f1f5fc')
    tk.Label(root, text='DUTY ROTA  /  EQUALITY LABORATORY', font=('Segoe UI', 23, 'bold'),
             fg='#18304c', bg='#f1f5fc').pack(anchor='w', padx=28, pady=(12, 6))
    timer = tk.Label(root, font=('Consolas', 36, 'bold'), fg=COLORS[0], bg='#f1f5fc')
    timer.pack(anchor='w', padx=28)
    phase = tk.Label(root, font=('Segoe UI', 12), fg='#334963', bg='#f1f5fc', wraplength=1060, justify='left')
    phase.pack(anchor='w', padx=30, pady=(0, 14))
    report_path = ROOT / args.report
    report_button = tk.Button(root, text='Open audit report', bg='#e2eafb', fg='#365bd6',
        font=('Segoe UI', 11, 'bold'), relief='flat', padx=14, pady=8,
        command=lambda: os.startfile(report_path))
    report_button.place(relx=1, x=-28, y=78, anchor='ne')
    board = tk.Canvas(root, bg='white', highlightthickness=0, height=230)
    board.pack(fill='x', padx=28)
    chart = tk.Canvas(root, bg='white', highlightthickness=0, height=100)
    chart.pack(fill='x', padx=28, pady=8)
    distribution = tk.Canvas(root, bg='white', highlightthickness=0, height=125)
    distribution.pack(fill='x', padx=28, pady=(0, 6))
    controls=tk.Frame(root,bg='#f1f5fc')
    policy=tk.StringVar(value='equal_counts')
    dimension=tk.StringVar(value='duties')
    for variable,choices in [(policy,[('equal_counts','Equal counts'),('availability','Availability')]),
                             (dimension,[('duties','Duty counts'),('hours','Hours'),
                              ('twenty_four_hour','24-hour duties'),('weekend','Weekends'),
                              ('ledger_credits','Extra credits')])]:
        row=tk.Frame(controls,bg='#f1f5fc')
        row.pack(anchor='w')
        for value,label in choices:
            tk.Radiobutton(row,text=label,variable=variable,value=value,indicatoron=False,
                bg='white',fg='#18304c',selectcolor='#cdeee8',font=('Segoe UI',9),
                relief='flat',padx=9,pady=3).pack(side='left',padx=(0,5),pady=2)
    log = tk.Text(root, bg='white', fg='#334963', relief='flat', font=('Segoe UI', 11),
                  padx=18, pady=10, height=3, wrap='word')
    tk.Label(root, text='LOCAL SIMULATIONS  |  No production changes  |  Deadline is not a completion estimate',
             bg='#f1f5fc', fg='#526982', font=('Segoe UI', 10)).pack(side='bottom', anchor='w', padx=28, pady=10)
    log.pack(fill='both', expand=True, padx=28)

    def refresh():
        try:
            data = json.loads(STATE.read_text(encoding='utf-8-sig'))
            now = datetime.now(timezone.utc)
            remaining = max(0, int((datetime.fromisoformat(data['deadline']) - now).total_seconds())) if data.get('deadline') else 0
            timer.config(text=f'{remaining//60:02d}:{remaining%60:02d} REMAINING' if remaining else '00:00 TIMEBOX CLOSED',
                         fg=COLORS[0] if remaining > 300 else COLORS[4])
            if not data.get('deadline'):
                timer.config(text='IMPLEMENTATION & SYSTEM AUDIT', font=('Segoe UI', 26, 'bold'), fg=COLORS[0])
            phase.config(text=data['phase'])
            report_button.config(state='normal' if report_path.exists() else 'disabled')
            board.delete('all')
            width = max(890, board.winfo_width())
            done = sum(t['status'] == 'Verified' for t in data['tasks'])
            board.create_arc(40, 15, 185, 160, start=90, extent=-359.9, style='arc', outline='#e6edf8', width=17)
            if done:
                board.create_arc(40, 15, 185, 160, start=90, extent=-359.9*done/5, style='arc', outline=COLORS[0], width=17)
            board.create_text(112, 80, text=f'{done}/5', fill='#18304c', font=('Segoe UI', 34, 'bold'))
            board.create_text(112, 116, text='VERIFIED', fill='#526982', font=('Segoe UI', 10))
            for i, task in enumerate(data['tasks']):
                y = 25 + i*32
                board.create_oval(235, y-7, 249, y+7, fill=COLORS[i], outline='')
                board.create_text(263, y, anchor='w', text=task['name'], fill='#18304c', font=('Segoe UI', 12, 'bold'))
                board.create_text(width-22, y, anchor='e', text=task['status'], fill=COLORS[i], font=('Segoe UI', 11))
            for i, (name, value) in enumerate(data.get('metrics', {}).items()):
                x = 30+i*(width-60)/4
                board.create_text(x, 190, anchor='w', text=str(value), fill=COLORS[i%5], font=('Segoe UI', 23, 'bold'))
                board.create_text(x, 217, anchor='w', text=name, fill='#526982', font=('Segoe UI', 10))
            chart.delete('all')
            chart.create_text(18, 20, anchor='w', text=data.get('chart_title', 'SIMULATION RESULTS — CURRENT SESSION ONLY'),
                              fill='#18304c', font=('Segoe UI', 11, 'bold'))
            for i, item in enumerate(data.get('charts', [])):
                x = 30+i*190
                chart.create_text(x, 45, anchor='w', text=item['name'], fill='#526982', font=('Segoe UI', 10))
                chart.create_rectangle(x, 61, x+145, 73, fill='#e6edf8', outline='')
                chart.create_rectangle(x, 61, x+145*min(1, item['fraction']), 73, fill=COLORS[i%5], outline='')
                chart.create_text(x, 89, anchor='w', text=item['value'], fill=COLORS[i%5], font=('Segoe UI', 12, 'bold'))
            distribution.delete('all')
            workload=data.get('workload_diagnostics',{}).get(policy.get(),{}).get(dimension.get())
            if data.get('workload_diagnostics') and not controls.winfo_manager():
                controls.pack(before=distribution,fill='x',padx=28,pady=(0,5))
            groups=workload['rows'] if workload else data.get('distribution',[])
            title=workload['title'] if workload else data.get('distribution_title', 'READ-ONLY NOVEMBER REPLAY  |  Raw gap / comparable full-availability gap')
            maximum=max([2]+[max(group['raw'],group.get('comparable',0)) for group in groups])
            scale=70/maximum
            distribution.create_text(18, 17, anchor='w', text=title,
                                     fill='#18304c', font=('Segoe UI', 10, 'bold'))
            if workload:
                distribution.create_text(max(890, distribution.winfo_width())-18, 17,
                    anchor='e', text='COLOR: AFTER  /  GRAY: BEFORE',
                    fill='#526982', font=('Segoe UI', 9))
            for i, group in enumerate(groups):
                x = 28+i*190
                distribution.create_rectangle(x, 100-group['raw']*scale, x+32, 100, fill=COLORS[i%5], outline='')
                if 'comparable' in group:
                    distribution.create_rectangle(x+40, 100-group['comparable']*scale, x+72, 100, fill='#8094af', outline='')
                if not workload or dimension.get()=='duties':
                    distribution.create_line(x-4, 100-2*scale, x+79, 100-2*scale, fill='#c33567', dash=(3, 2))
                label = f"{group['name']}  {group['raw']}" + (f" / {group['comparable']}" if 'comparable' in group else '')
                distribution.create_text(x+38, 118, text=label,
                                         fill='#334963', font=('Segoe UI', 10))
            log.config(state='normal')
            log.delete('1.0', 'end')
            log.insert('end', '\n\n'.join(data.get('events', [])[-5:]))
            log.see('end')
            log.config(state='disabled')
            (ROOT / 'docs/allocation-progress/equality-hour-window-health.json').write_text(json.dumps({
                'updated_at': now.isoformat(), 'viewable': bool(root.winfo_viewable()),
                'window_id': root.winfo_id(), 'geometry': root.geometry(), 'light_theme': True,
                'deadline': data.get('deadline'), 'completed_requirements': done,
            }), encoding='utf-8')
        except (ValueError, KeyError, OSError) as exc:
            phase.config(text=f'Waiting for session state: {type(exc).__name__}')
        root.after(1000, refresh)

    refresh()
    root.mainloop()


if __name__ == '__main__':
    main()
